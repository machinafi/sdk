import { ensureUTxOBigInt, first, type Box, type BoxCandidate } from "@fleet-sdk/common";
import {
  ErgoAddress,
  ErgoUnsignedInput,
  estimateMinBoxValue,
  OutputBuilder,
  type Amount,
  type FleetPlugin,
  type R4ToR6Registers,
} from "@fleet-sdk/core";
import {
  SBool,
  SByte,
  SColl,
  SConstant,
  SGroupElement,
  SInt,
  SLong,
  SSigmaProp,
} from "@fleet-sdk/serializer";

import type { ActionHandler, BuySellOrder, ExchangeableAssets } from "./types";

import { OrderContract } from "./order-contract";
import { validateToken } from "./tokens";

export const CONTRACTS = {
  E2T: new OrderContract(
    "1a8b02070e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e050004000400050005000500d806d601e30004d6027300d603860272027301d604e4c6a70601d605e4c6a70408d606e4c6a7050595e67201d804d607b2a5e4720100d608b2db630872077302017203d6098c720802d60a8cb2db6308a7730301720302d1ed95919572047209720a7304ededededed93c27207c2a7938c720801720293e4c672070408720593e4c672070505720693e4c672070601720493e4c67207070ec5a793c27207d07205957204d801d60b99c17207c1a7ed91720b730592720b9c99720a72097206d801d60b997209720aed91720b7306929c720b720699c1a7c172077205",
    "E2T",
  ),
  T2T: new OrderContract("0000", "T2T"),
};

export type LimitOrderType = "buy" | "sell";

export class LimitOrder implements BuySellOrder {
  #box: Box<bigint, R4ToR6Registers>;
  #price: bigint;
  #assets: ExchangeableAssets;
  #contract: OrderContract;
  #type: LimitOrderType;

  constructor(box: Box<Amount, R4ToR6Registers> | BoxCandidate<Amount, R4ToR6Registers>) {
    if (CONTRACTS.E2T.validate(box.ergoTree)) {
      this.#contract = CONTRACTS.E2T;
    } else if (CONTRACTS.T2T.validate(box.ergoTree)) {
      this.#contract = CONTRACTS.T2T;
    } else {
      throw Error("Invalid Grid Order contract");
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
        base: { tokenId: baseId, amount: this.#box.assets[0]?.amount ?? 0n },
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
    // TODO: add amounts validation
    if (this.#type !== "buy") throw Error("Cannot buy from a sell order");
    if (amount <= 0n) throw Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const requiredBase = amount * this.#price;
      const newOutputValue = box.value + requiredBase;

      const input = new ErgoUnsignedInput(box);
      let output: OutputBuilder;

      const fulfilling = amount >= this.#assets.quote.amount;
      if (fulfilling) {
        // TODO: here we are considering R4 is a public key, but it's not always the case, let's handle SigmaProp properly
        const owner = SConstant.from<Uint8Array>(box.additionalRegisters.R4);
        if (owner.type.toString() !== "SSigmaProp") throw Error("Invalid owner register");

        output = new OutputBuilder(newOutputValue, ErgoAddress.fromPublicKey(owner.data));
      } else {
        output = OutputBuilder.from(box);

        if (this.#contract.type === "E2T") {
          output
            .setValue(newOutputValue)
            .addTokens({ tokenId: this.#assets.quote.tokenId, amount: amount * -1n }); // fleet will deduct the amount from the existing tokens
        } else {
          throw Error("Not implemented");
          // output
          //   .addTokens({ tokenId: this.#assets.base.tokenId, amount: requiredBase }) // fleet will sum the amount to the existing tokens
          //   .addTokens({ tokenId: this.#assets.quote.tokenId, amount: amount * -1n }); // fleet will sum the amount to the existing tokens
        }

        output.setAdditionalRegisters({ R7: SColl(SByte, box.boxId) }); // bind the output to the input
      }

      const outputsLength = addOutputs(output);

      // bind input to the recreated output
      addInputs(input.setContextExtension({ 0: SInt(outputsLength - 1) }));

      if (handler) handler(output, input);
    };
  }

  sell(_amount: bigint, _handler?: ActionHandler): FleetPlugin {
    if (this.#type !== "sell") throw Error("Cannot sell to a buy order");
    throw Error("not implemented");
  }

  close(): FleetPlugin {
    return ({ addInputs }) => addInputs(this.#box);
  }

  static create(options: LimitOrderCreationParams): OutputBuilder {
    const assets = options.assets;
    const buy = options.type === "buy";

    if (assets.quote.tokenId === "ERG") throw Error("Quote asset cannot be ERG");
    if (!options.price) throw Error("Quote token price must be specified");
    if (buy) {
      if (!assets.quote.amount) throw Error("Quote amount must be specified for buy orders");
    } else {
      if (!assets.base.amount) throw Error("Base amount must be specified for sell orders");
    }

    let builder: OutputBuilder;
    if (assets.base.tokenId === "ERG") {
      const contract = CONTRACTS.E2T.new(assets.quote.tokenId);
      const baseAmount = assets.base.amount || estimateMinBoxValue();
      builder = new OutputBuilder(baseAmount, contract).addTokens(assets.quote);
    } else {
      const contract = CONTRACTS.T2T.new(assets.quote.tokenId);
      builder = new OutputBuilder(estimateMinBoxValue(), contract)
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

export interface LimitOrderCreationParams {
  owner: ErgoAddress;
  type: LimitOrderType;
  assets: ExchangeableAssets;
  price: bigint;
}
