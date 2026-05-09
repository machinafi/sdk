import {
  ensureUTxOBigInt,
  first,
  type Amount,
  type Box,
  type BoxCandidate,
} from "@fleet-sdk/common";
import {
  type ErgoAddress,
  estimateMinBoxValue,
  OutputBuilder,
  type FleetPlugin,
  ErgoUnsignedInput,
  type R4ToR5Registers,
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

import type { ActionHandler, BuySellOrder, ExchangeableAssets, PriceRange } from "./types";

import { OrderContract } from "./order-contract";
import { validateToken } from "./tokens";

const CONTRACTS = {
  E2T: new OrderContract(
    "1af401080e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e0500040004000500040005000402d804d601e30104d6027300d603860272027301d604e4c6a7040895e67201d805d605b2a5e4720100d606b2db630872057302017203d607e4c6a70511d6088cb2db6308a7730301720302d6098c720602d1ededededed93c27205c2a7938c720601720293e4c672050408720493e4c672050511720793e4c67205060ec5a795e4e30001d801d60a99c17205c1a7ed91720a730492720a9c9972087209b27207730500d801d60a9972097208ed91720a7306929c720ab2720773070099c1a7c172057204",
    "E2T",
  ),
  T2T: new OrderContract(
    "1aab020a0e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e050004000400040204020500040005000402d804d601e30104d6027300d603860272027301d604e4c6a7040895e67201d80bd605b2a5e4720100d606db6308a7d607b27206730200d608db63087205d609b27208730300d60ab272087304017203d60be4c6a70511d60c8c720902d60d8c720702d60e8cb27206730501720302d60f8c720a02d1ededededededed93c27205c2a793c17205c1a7938c7207018c720901938c720a01720293e4c672050408720493e4c672050511720b93e4c67205060ec5a795e4e30001d801d61099720c720ded91721073069272109c99720e720fb2720b730700d801d61099720f720eed9172107308929c7210b2720b73090099720d720c7204",
    "T2T",
  ),
};

export class GridOrder implements BuySellOrder<PriceRange> {
  #box: Box<bigint, R4ToR5Registers>;
  #price: PriceRange;
  #assets: ExchangeableAssets;
  #contract: OrderContract;

  constructor(box: Box<Amount, R4ToR5Registers> | BoxCandidate<Amount, R4ToR5Registers>) {
    if (CONTRACTS.E2T.validate(box.ergoTree)) {
      this.#contract = CONTRACTS.E2T;
    } else if (CONTRACTS.T2T.validate(box.ergoTree)) {
      this.#contract = CONTRACTS.T2T;
    } else {
      throw Error("Invalid Grid Order contract");
    }

    this.#box = ensureUTxOBigInt(box) as Box<bigint, R4ToR5Registers>;
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
        /* c8 ignore next 2 -- assets[0/1] always exist here: guarded by !baseId and validateToken above */
        base: { tokenId: baseId, amount: this.#box.assets[0]?.amount ?? 0n },
        quote: { tokenId: quoteId, amount: this.#box.assets[1]?.amount ?? 0n },
      };
    }

    const prices = SConstant.from<[bigint, bigint]>(box.additionalRegisters.R5);
    if (prices.type.toString() !== "SColl[SLong]") throw Error("Invalid price register");
    this.#price = { buy: prices.data[0], sell: prices.data[1] };
  }

  get box(): Box<bigint, R4ToR5Registers> {
    return this.#box;
  }

  get price(): PriceRange {
    return this.#price;
  }

  get assets(): ExchangeableAssets {
    return this.#assets;
  }

  get contract(): OrderContract {
    return this.#contract;
  }

  /**
   * Buys tokens with nanoergs at the price specified in the order.
   * @param amount - The amount of token units to buy.
   */
  buy(amount: bigint, handler?: ActionHandler): FleetPlugin {
    if (amount <= 0n) throw Error("Amount must be greater than zero");
    if (amount > this.#assets.quote.amount) throw Error("Amount exceeds the available quote tokens");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const requiredBase = amount * this.#price.buy;

      const input = new ErgoUnsignedInput(box);
      const output = OutputBuilder.from(box);

      if (this.#contract.type === "E2T") {
        output
          .setValue(box.value + requiredBase)
          .addTokens({ tokenId: this.#assets.quote.tokenId, amount: amount * -1n }); // fleet will deduct the amount from the existing tokens
      } else {
        output
          .addTokens({ tokenId: this.#assets.base.tokenId, amount: requiredBase }) // fleet will sum the amount to the existing tokens
          .addTokens({ tokenId: this.#assets.quote.tokenId, amount: amount * -1n }); // fleet will sum the amount to the existing tokens
      }

      const outputsLength = addOutputs(
        output.setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }), // bind the output to the input
      );

      addInputs(
        input.setContextExtension({
          0: SBool(true), // action, true == buy
          1: SInt(outputsLength - 1), // index of the child output
        }),
      );

      if (handler) handler(output, input);
    };
  }

  /**
   * Sell tokens for nanoergs at the price specified in the order.
   * @param amount - The amount of token units to sell.
   */
  sell(amount: bigint, handler?: ActionHandler): FleetPlugin {
    if (amount <= 0n) throw Error("Amount must be greater than zero");
    if (amount * this.#price.sell > this.#assets.base.amount) throw Error("Insufficient base amount to cover the payout");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const basePayout = amount * this.#price.sell;

      const input = new ErgoUnsignedInput(box);
      const output = OutputBuilder.from(box);

      if (this.#contract.type === "E2T") {
        output
          .setValue(box.value - basePayout)
          .addTokens({ tokenId: this.#assets.quote.tokenId, amount }); // fleet will sum the amount to the existing tokens
      } else {
        output
          .addTokens({ tokenId: this.#assets.base.tokenId, amount: basePayout * -1n }) // fleet will deduct the amount from the existing tokens
          .addTokens({ tokenId: this.#assets.quote.tokenId, amount }); // fleet will sum the amount to the existing tokens
      }

      const outputsLength = addOutputs(
        output.setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }), // bind the output to the input box
      );

      addInputs(
        input.setContextExtension({
          0: SBool(false), // action, false == sell
          1: SInt(outputsLength - 1), // index of the child output
        }),
      );

      if (handler) handler(output, input);
    };
  }

  close(): FleetPlugin {
    return ({ addInputs }) => addInputs(this.#box);
  }

  static create(options: GridOrderCreationParams): OutputBuilder {
    const assets = options.assets;
    if (assets.quote.tokenId === "ERG") throw Error("Quote asset cannot be ERG");
    if (!assets?.base.amount && !assets?.quote.amount)
      throw Error("At least one of base or quote assets must be specified");
    if (!options.prices.buy || !options.prices.sell)
      throw Error("Prices must be specified for both buy and sell");

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
      R5: SColl(SLong, [options.prices.buy, options.prices.sell]),
    });
  }
}

export interface GridOrderCreationParams {
  owner: ErgoAddress;
  assets: ExchangeableAssets;
  prices: PriceRange;
}
