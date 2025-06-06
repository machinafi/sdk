import { ensureUTxOBigInt, first, type Amount, type Box } from "@fleet-sdk/common";
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
  type R4ToR6Registers,
  ErgoUnsignedInput,
  ErgoTree
} from "@fleet-sdk/core";
import type { Assets, BuyOrder, ExchangeableAssets, PriceRange, SellOrder } from "./types";

const TOKEN_ID_CONST_INDEX = 0;
export const ERG_TOKEN_GRID_CONTRACT =
  "1aa7020d0e200000000000000000000000000000000000000000000000000000000000000000040004000500040004000500050004000400040005000402d803d601e30104d602e4c6a70408d603730095e67201d804d604b2a5e4720100d605e4c6a70511d606db6308a7d6079591b1720673018cb27206730200027303d1edededed93c27204c2a793e4c672040408720293e4c672040511720593e4c67204060ec5a795e4e30001d803d60899c17204c1a7d609db63087204d60a9972079591b1720973048cb27209730500027306eded91720873079272089c720ab27205730800ec937207720a938cb27209730900017203d802d60899c1a7c17204d609b2db63087204730a00eded917208730b929c998c7209027207b27205730c007208938c72090172037202";
const ERG_TOKEN_GRID_TEMPLATE = "929c998c7209027207b27205730c007208938c72090172037202";

export class GridOrder implements BuyOrder<PriceRange>, SellOrder<PriceRange> {
  readonly #box: Box<bigint, R4ToR6Registers>;

  readonly #price: PriceRange;
  readonly #assets: Assets;

  constructor(box: Box<Amount, R4ToR6Registers>) {
    if (!validateErgoTree(box.ergoTree)) throw new Error("Invalid Grid Order contract");

    const quoteTokenId = box.ergoTree.substring(12, 12 + 64);
    if (!validateToken(quoteTokenId, box, 0)) throw new Error("Invalid token for the contract");

    const prices = SConstant.from<[bigint, bigint]>(box.additionalRegisters.R5);
    if (prices.type.toString() !== "SColl[SLong]") throw new Error("Invalid order box");

    this.#price = { buy: prices.data[0], sell: prices.data[1] };
    this.#box = ensureUTxOBigInt(box) as Box<bigint, R4ToR6Registers>;
    this.#assets = {
      base: { tokenId: "nanoerg", amount: this.#box.value },
      quote: { tokenId: quoteTokenId, amount: this.#box.assets[0]?.amount ?? 0n }
    };
  }

  get price(): PriceRange {
    return this.#price;
  }

  get box(): Box<bigint, R4ToR6Registers> {
    return this.#box;
  }

  get assets(): Assets {
    return this.#assets;
  }

  cancel(): FleetPlugin {
    return ({ addInputs }) => addInputs(this.#box);
  }

  /**
   * Buys tokens with nanoergs at the price specified in the order.
   * @param amount - The amount of token units to buy.
   */
  buy(amount: bigint): FleetPlugin {
    if (amount <= 0n) throw new Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const requiredNanoergs = amount * this.#price.buy;

      const outputsLength = addOutputs(
        OutputBuilder.from(box)
          .setValue(box.value + requiredNanoergs)
          .addTokens({ tokenId: this.assets.quote.tokenId, amount: amount * -1n }) // fleet will deduct the amount from the existing tokens
          .setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }) // bind the output to the input box
      );

      addInputs(
        new ErgoUnsignedInput(box).setContextExtension({
          0: SBool(true), // action, true == buy
          1: SInt(outputsLength - 1) // index of the recreated output index
        })
      );
    };
  }

  /**
   * Sell tokens for nanoergs at the price specified in the order.
   * @param amount - The amount of token units to sell.
   */
  sell(amount: bigint): FleetPlugin {
    if (amount <= 0n) throw new Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const nanoergsPayout = amount * this.#price.sell;

      const outputsLength = addOutputs(
        OutputBuilder.from(box)
          .setValue(box.value - nanoergsPayout)
          .addTokens({ tokenId: this.assets.quote.tokenId, amount }) // fleet will sum the amount to the existing tokens
          .setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }) // bind the output to the input box
      );

      addInputs(
        new ErgoUnsignedInput(box).setContextExtension({
          0: SBool(false), // action, false == sell
          1: SInt(outputsLength - 1) // index of the recreated output index
        })
      );
    };
  }

  static create(options: GridOrderCreationParams): OutputBuilder {
    if (!options.assets?.nanoerg && !options.assets?.token.amount) {
      throw new Error("At least one of base or target assets must be specified");
    }

    if (!options.prices.buy || !options.prices.sell) {
      throw new Error("Prices must be specified for both buy and sell");
    }

    const tokenId = SColl(SByte, options.assets.token.tokenId);
    const contract = new ErgoTree(ERG_TOKEN_GRID_CONTRACT)
      .replaceConstant(TOKEN_ID_CONST_INDEX, tokenId)
      .toAddress();

    const order = new OutputBuilder(
      options.assets.nanoerg || estimateMinBoxValue(),
      contract
    ).setAdditionalRegisters({
      R4: SSigmaProp(SGroupElement(first(options.owner.getPublicKeys()))),
      R5: SColl(SLong, [options.prices.buy, options.prices.sell])
    });

    if (options.assets.token.amount > 0n) {
      order.addTokens(options.assets.token);
    }

    return order;
  }
}

function validateErgoTree(ergoTree: string): boolean {
  return (
    ergoTree?.length === ERG_TOKEN_GRID_CONTRACT.length &&
    ergoTree.endsWith(ERG_TOKEN_GRID_TEMPLATE)
  );
}

function validateToken(tokenId: string, box: Box, index: number): boolean {
  const token = box.assets[index];
  return !token || token.tokenId === tokenId;
}

export interface ErgTokenAmounts {
  nanoerg?: bigint;
  token?: bigint;
}

export interface GridOrderCreationParams {
  owner: ErgoAddress;
  assets: ExchangeableAssets;
  prices: PriceRange;
  max?: PriceRange;
}
