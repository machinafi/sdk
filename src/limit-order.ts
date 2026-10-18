import { ensureUTxOBigInt, first, type Box, type BoxCandidate } from "@fleet-sdk/common";
import {
  BOX_VALUE_PER_BYTE,
  ErgoAddress,
  ErgoUnsignedInput,
  estimateMinBoxValue,
  OutputBuilder,
  SAFE_MIN_BOX_VALUE,
  type Amount,
  type FleetPlugin,
  type R4ToR6Registers,
} from "@fleet-sdk/core";
import {
  estimateBoxSize,
  SBool,
  SByte,
  SColl,
  SConstant,
  SGroupElement,
  SInt,
  SLong,
  SSigmaProp,
} from "@fleet-sdk/serializer";

import { OrderContract } from "./order-contract";
import { validateToken } from "./tokens";
import type { ActionHandler, BuySellOrder, ExchangeableAssets } from "./types";

const CONTRACTS = {
  E2T: new OrderContract(
    "1ab302080e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e05000400040005000580897a05000500d804d601e30004d6027300d603860272027301d604e4c6a7040895e67201d807d605e4c6a70601d606b2a5e4720100d607b2db630872067302017203d6088c720702d609e4c6a70505d60a8c720701d60b8cb2db6308a7730301720302d1ed959572059172087304d801d60cc17206ed91720c730592720c7209ededededed93c27206c2a793720a720293e4c672060408720493e4c672060505720993e4c672060601720593e4c67206070ec5a7eded93c27206d0720493720a720293e4c67206040ec5a7957205d801d60c99c17206c1a7ed91720c730692720c9c99720b72087209d801d60c997208720bed91720c7307929c720c720999c1a7c172067204",
    "E2T",
  ),
  T2T: new OrderContract("0000", "T2T"),
};

// The transaction height is unknown at this point, so use the largest possible creation height
const MAX_CREATION_HEIGHT = 2 ** 31 - 1;

export type LimitOrderType = "buy" | "sell";

export class LimitOrder implements BuySellOrder {
  #box: Box<bigint, R4ToR6Registers>;
  #price: bigint;
  #assets: ExchangeableAssets;
  #contract: OrderContract;
  #type: LimitOrderType;

  constructor(
    box: Box<Amount, R4ToR6Registers> | BoxCandidate<Amount, R4ToR6Registers>,
    contract?: OrderContract,
  ) {
    if (contract) {
      if (!contract.validate(box.ergoTree))
        throw Error("The box does not match the provided contract");
      this.#contract = contract;
    } else if (CONTRACTS.E2T.validate(box.ergoTree)) {
      this.#contract = CONTRACTS.E2T;
    } else if (CONTRACTS.T2T.validate(box.ergoTree)) {
      this.#contract = CONTRACTS.T2T;
    } else {
      throw Error("Invalid Limit Order contract");
    }

    this.#box = ensureUTxOBigInt(box) as Box<bigint, R4ToR6Registers>;
    const quoteId = this.#contract.getQuoteId(box.ergoTree);

    if (this.#contract.type === "E2T") {
      if (!validateToken(quoteId, box, 0)) throw Error("Invalid quote token for the contract");
      this.#assets = {
        base: { tokenId: "ERG", amount: this.#box.value },
        quote: { tokenId: quoteId, amount: this.#box.assets[0]?.amount ?? 0n },
      };
    } else {
      const baseId = this.#box.assets[0]?.tokenId;
      if (!baseId) throw Error("The base token is not specified in the box");
      if (!validateToken(quoteId, box, 1)) throw Error("Invalid quote token for the contract");

      this.#assets = {
        /* c8 ignore next -- assets[0] always exist here: guarded by !baseId above */
        base: { tokenId: baseId, amount: this.#box.assets[0]?.amount ?? 0n },
        /* c8 ignore next -- assets[1] always exist here: guarded by validateToken above */
        quote: { tokenId: quoteId, amount: this.#box.assets[1]?.amount ?? 0n },
      };
    }

    let price = SConstant.from<bigint>(box.additionalRegisters.R5);
    if (price.type.toString() !== "SLong") throw Error("Invalid price register");
    this.#price = price.data;

    let type = SConstant.from<boolean>(box.additionalRegisters.R6);
    if (type.type.toString() !== "SBool") throw Error("Invalid order type register");
    this.#type = type.data ? "buy" : "sell";
  }

  get price(): bigint {
    return this.#price;
  }

  get box(): Box<bigint, R4ToR6Registers> {
    return this.#box;
  }

  get contract(): OrderContract {
    return this.#contract;
  }

  get assets(): ExchangeableAssets {
    return this.#assets;
  }

  buy(amount: bigint, handler?: ActionHandler): FleetPlugin {
    if (this.#type !== "buy") throw Error("Buy action is not allowed in this contract");
    if (amount <= 0n) throw Error("Amount must be greater than zero");
    if (amount > this.#assets.quote.amount)
      throw Error("Amount exceeds the available quote tokens");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const requiredBase = amount * this.#price;
      const newOutputValue = box.value + requiredBase;

      const input = new ErgoUnsignedInput(box);
      let output: OutputBuilder;

      const fulfilling = amount >= this.#assets.quote.amount;
      if (fulfilling) {
        const owner = SConstant.from<Uint8Array>(box.additionalRegisters.R4);
        if (owner.type.toString() !== "SSigmaProp") throw Error("Invalid owner register");

        let ownerAddress = ErgoAddress.fromPublicKey(owner.data);

        if (this.#contract.type === "E2T") {
          output = new OutputBuilder(newOutputValue, ownerAddress).setAdditionalRegisters({
            R4: SColl(SByte, box.boxId),
          });
        } else {
          throw Error("Not supported");
        }
      } else {
        output = OutputBuilder.from(box);

        if (this.#contract.type === "E2T") {
          output
            .setValue(newOutputValue)
            .addTokens({ tokenId: this.#assets.quote.tokenId, amount: amount * -1n }); // fleet will deduct the amount from the existing tokens
        } else {
          throw Error("Not supported");
        }

        output.setAdditionalRegisters({ R7: SColl(SByte, box.boxId) }); // bind the output to the input
      }

      const outputsLength = addOutputs(output);

      // bind input to the recreated output
      addInputs(input.setContextExtension({ 0: SInt(outputsLength - 1) }));

      if (handler) handler(output, input);
    };
  }

  sell(amount: bigint, handler?: ActionHandler): FleetPlugin {
    if (this.#type !== "sell") throw Error("Sell action is not allowed in this contract");
    if (amount <= 0n) throw Error("Amount must be greater than zero");
    if (amount * this.#price > this.#assets.base.amount)
      throw Error("Insufficient base amount to cover the payout");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const basePayout = amount * this.#price;

      const input = new ErgoUnsignedInput(box);
      let output: OutputBuilder;

      const remaining = this.#assets.base.amount - basePayout;
      const fulfilling = SAFE_MIN_BOX_VALUE >= remaining || this.#price > remaining;
      if (fulfilling) {
        const owner = SConstant.from<Uint8Array>(box.additionalRegisters.R4);
        if (owner.type.toString() !== "SSigmaProp") throw Error("Invalid owner register");

        let ownerAddress = ErgoAddress.fromPublicKey(owner.data);

        if (this.#contract.type === "E2T") {
          output = new OutputBuilder(box.value - basePayout, ownerAddress)
            .addTokens(this.#assets.quote)
            .addTokens({ tokenId: this.#assets.quote.tokenId, amount })
            .setAdditionalRegisters({ R4: SColl(SByte, box.boxId) });

          const minBoxValue = estimateMinValue(output);
          if (output.value < minBoxValue)
            throw Error(
              `Remaining base amount is not enough to cover the minimum box value of ${minBoxValue} nanoergs`,
            );
        } else {
          throw Error("Not supported");
        }
      } else {
        output = OutputBuilder.from(box);

        if (this.#contract.type === "E2T") {
          output
            .setValue(box.value - basePayout)
            .addTokens({ tokenId: this.#assets.quote.tokenId, amount }); // fleet will add the tokens from the seller
        } else {
          throw Error("Not supported");
        }

        output.setAdditionalRegisters({ R7: SColl(SByte, box.boxId) }); // bind the output to the input
      }

      const outputsLength = addOutputs(output);

      // bind input to the recreated output
      addInputs(input.setContextExtension({ 0: SInt(outputsLength - 1) }));

      if (handler) handler(output, input);
    };
  }

  close(): FleetPlugin {
    return ({ addInputs }) => addInputs(this.#box);
  }

  static create(options: LimitOrderCreationParams, contract?: OrderContract): OutputBuilder {
    const assets = options.assets;
    const buy = options.type === "buy";

    if (assets.quote.tokenId === "ERG") throw Error("Quote asset cannot be ERG");
    if (assets.base.tokenId === assets.quote.tokenId)
      throw Error("Base and quote assets must be different");
    if (assets.base.amount < 0n || assets.quote.amount < 0n)
      throw Error("Asset amounts cannot be negative");
    if (options.price <= 0n) throw Error("Quote token price must be greater than zero");
    if (buy) {
      if (!assets.quote.amount) throw Error("Quote amount must be specified for buy orders");
    } else {
      if (!assets.base.amount) throw Error("Base amount must be specified for sell orders");
    }

    const isE2T = assets.base.tokenId === "ERG";
    if (!contract && !isE2T) throw Error("T2T limit orders are not supported");
    if (contract && (contract.type === "E2T") !== isE2T)
      throw Error(`Base asset does not match the ${contract.type} contract`);

    const tree = (contract ?? CONTRACTS.E2T).new(assets.quote.tokenId);

    let builder: OutputBuilder;
    if (isE2T) {
      const baseAmount = assets.base.amount || estimateMinBoxValue();
      builder = new OutputBuilder(baseAmount, tree).addTokens(assets.quote);
    } else {
      builder = new OutputBuilder(estimateMinBoxValue(), tree)
        .addTokens(assets.base)
        .addTokens(assets.quote);
    }

    return builder.setAdditionalRegisters({
      R4: SSigmaProp(SGroupElement(first(options.owner.getPublicKeys()))),
      R5: SLong(options.price),
      R6: SBool(buy),
    });
  }
}

function estimateMinValue(output: OutputBuilder): bigint {
  const size = estimateBoxSize({
    value: output.value,
    ergoTree: output.ergoTree,
    creationHeight: output.creationHeight ?? MAX_CREATION_HEIGHT,
    assets: output.assets.toArray(),
    additionalRegisters: output.additionalRegisters,
  });

  return BigInt(size) * BOX_VALUE_PER_BYTE;
}

export interface LimitOrderCreationParams {
  owner: ErgoAddress;
  type: LimitOrderType;
  assets: ExchangeableAssets;
  price: bigint;
}
