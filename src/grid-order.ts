import {
  ensureUTxOBigInt,
  first,
  type Amount,
  type Box,
  type BoxCandidate
} from "@fleet-sdk/common";
import {
  SBool,
  SByte,
  SColl,
  SConstant,
  SGroupElement,
  SInt,
  SLong,
  SSigmaProp
} from "@fleet-sdk/serializer";
import {
  type ErgoAddress,
  estimateMinBoxValue,
  OutputBuilder,
  type FleetPlugin,
  ErgoUnsignedInput,
  type R4ToR5Registers
} from "@fleet-sdk/core";
import type {
  ActionHandler,
  AssetId,
  BuyOrder,
  ExchangeableAssets,
  PriceRange,
  SellOrder
} from "./types";
import { OrderContract } from "./order-contract";

export const CONTRACTS = {
  E2T: new OrderContract(
    "1a95020e040004000400050004000e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e01010500040005000400040005000402d802d601e30104d602e4c6a7040895e67201d806d603b2a5e4720100d604db63087203d60591b172047300d606e4c6a70511d607db6308a7d6089591b1720773018cb27207730200027303d1ededededed93c27203c2a7957205938cb27204730400017305730693e4c672030408720293e4c672030511720693e4c67203060ec5a795e4e30001d801d60999c17203c1a7ed91720973079272099c9972089572058cb27204730800027309b27206730a00d801d609998cb27204730b00027208ed917209730c929c7209b27206730d0099c1a7c172037202",
    "E2T"
  ),
  T2T: new OrderContract(
    "1ab7020b040004000e000500040204020e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e0500040005000402d802d601e30104d602e4c6a7040895e67201d80ed603b2a5e4720100d604db6308a7d605b27204730000d606db63087203d607b27206730100d6087302d609860272087303d60ab272067304017209d60b8c720a01d60ce4c6a70511d60d8c720702d60e8c720502d60f8cb27204730501720902d6108c720a02d1ededededededed93c27203c2a793c17203c1a7938c7205018c720701ec93720b730693720b720893e4c672030408720293e4c672030511720c93e4c67203060ec5a795e4e30001d801d61199720d720eed91721173079272119c99720f7210b2720c730800d801d611997210720fed9172117309929c7211b2720c730a0099720e720d7202",
    "T2T"
  )
};

export class GridOrder implements BuyOrder<PriceRange>, SellOrder<PriceRange> {
  readonly box: Box<bigint, R4ToR5Registers>;

  readonly price: PriceRange;
  readonly assets: ExchangeableAssets;
  readonly contract: OrderContract;

  constructor(box: Box<Amount, R4ToR5Registers> | BoxCandidate<Amount, R4ToR5Registers>) {
    if (CONTRACTS.E2T.validate(box.ergoTree)) {
      this.contract = CONTRACTS.E2T;
    } else if (CONTRACTS.T2T.validate(box.ergoTree)) {
      this.contract = CONTRACTS.T2T;
    } else {
      throw new Error("Invalid Grid Order contract");
    }

    this.box = ensureUTxOBigInt(box) as Box<bigint, R4ToR5Registers>;
    const quoteId = this.contract.getQuoteId(box.ergoTree);

    if (this.contract.type === "E2T") {
      if (!validateToken(quoteId, box, 0)) throw new Error("Invalid quote token for the contract");
      this.assets = {
        base: { tokenId: "ERG", amount: this.box.value },
        quote: { tokenId: quoteId, amount: this.box.assets[0]?.amount ?? 0n }
      };
    } else {
      const baseId = this.box.assets[0]?.tokenId;
      if (!baseId) throw new Error("The base token is not specified in the box");
      if (!validateToken(quoteId, box, 1)) throw new Error("Invalid quote token for the contract");

      this.assets = {
        base: { tokenId: baseId, amount: this.box.assets[0]?.amount ?? 0n },
        quote: { tokenId: quoteId, amount: this.box.assets[1]?.amount ?? 0n }
      };
    }

    const prices = SConstant.from<[bigint, bigint]>(box.additionalRegisters.R5);
    if (prices.type.toString() !== "SColl[SLong]") throw new Error("Invalid order box");
    this.price = { buy: prices.data[0], sell: prices.data[1] };
  }

  close(): FleetPlugin {
    return ({ addInputs }) => addInputs(this.box);
  }

  /**
   * Buys tokens with nanoergs at the price specified in the order.
   * @param amount - The amount of token units to buy.
   */
  buy(amount: bigint, hander?: ActionHandler): FleetPlugin {
    // TODO: add amounts validation
    if (amount <= 0n) throw new Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const box = this.box;
      const requiredBase = amount * this.price.buy;

      const input = new ErgoUnsignedInput(box);
      const output = OutputBuilder.from(box); // bind the output to the input box

      if (this.contract.type === "E2T") {
        output
          .setValue(box.value + requiredBase)
          .addTokens({ tokenId: this.assets.quote.tokenId, amount: amount * -1n }); // fleet will deduct the amount from the existing tokens
      } else {
        output
          .addTokens({ tokenId: this.assets.base.tokenId, amount: requiredBase }) // fleet will sum the amount to the existing tokens
          .addTokens({ tokenId: this.assets.quote.tokenId, amount: amount * -1n }); // fleet will sum the amount to the existing tokens
      }

      const outputsLength = addOutputs(
        output.setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }) // bind the output to the input box
      );

      addInputs(
        input.setContextExtension({
          0: SBool(true), // action, true == buy
          1: SInt(outputsLength - 1) // index of the child output
        })
      );

      if (hander) hander(output, input);
    };
  }

  /**
   * Sell tokens for nanoergs at the price specified in the order.
   * @param amount - The amount of token units to sell.
   */
  sell(amount: bigint, hander?: ActionHandler): FleetPlugin {
    // TODO: add amounts validation
    if (amount <= 0n) throw new Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const box = this.box;
      const basePayout = amount * this.price.sell;

      const input = new ErgoUnsignedInput(box);
      const output = OutputBuilder.from(box);

      if (this.contract.type === "E2T") {
        output
          .setValue(box.value - basePayout)
          .addTokens({ tokenId: this.assets.quote.tokenId, amount }); // fleet will sum the amount to the existing tokens
      } else {
        output
          .addTokens({ tokenId: this.assets.base.tokenId, amount: basePayout * -1n }) // fleet will deduct the amount from the existing tokens
          .addTokens({ tokenId: this.assets.quote.tokenId, amount }); // fleet will sum the amount to the existing tokens
      }

      const outputsLength = addOutputs(
        output.setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }) // bind the output to the input box
      );

      addInputs(
        input.setContextExtension({
          0: SBool(false), // action, false == sell
          1: SInt(outputsLength - 1) // index of the child output
        })
      );

      if (hander) hander(output, input);
    };
  }

  static create(options: GridOrderCreationParams): OutputBuilder {
    const assets = options.assets;
    if (assets.quote.tokenId === "ERG") throw new Error("Quote asset cannot be ERG");
    if (!assets?.base.amount && !assets?.quote.amount)
      throw new Error("At least one of base or quote assets must be specified");
    if (!options.prices.buy || !options.prices.sell)
      throw new Error("Prices must be specified for both buy and sell");

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
      R5: SColl(SLong, [options.prices.buy, options.prices.sell])
    });
  }
}

function validateToken(tokenId: AssetId, box: BoxCandidate<Amount>, index: number): boolean {
  const token = box.assets[index];
  return !token || token.tokenId === tokenId;
}

export interface GridOrderCreationParams {
  owner: ErgoAddress;
  assets: ExchangeableAssets;
  prices: PriceRange;
}
