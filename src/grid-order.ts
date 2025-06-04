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
import type { BuyOrder, ExchangeableAssets, PriceRange, SellOrder } from "./types";

export const ERG_TOKEN_GRID_CONTRACT =
  "1af1020f04000e2000000000000000000000000000000000000000000000000000000000000000000400040005000400050004000500040004000402050004020500d806d601e30104d602e4c6a70408d603db6308a7d604b27203730000d6058c720402d606730195e67201d805d607b2a5e4720100d608e4c6a70511d609e4c6a70611d60a7203d60b7204d1ed9683050193c27207c2a793e4c672070408720293e4c672070511720893e4c672070611720993e4c67207070ec5a795e4e30001d804d60c99c17207c1a7d60ddb63087207d60e9972059591b1720d73028cb2720d730300027304d60fb272097305009683040191720c730692720c9c720eb27208730700929591720f7308720f7205720eec937205720e938cb2720d730900017206d804d60c99c1a7c17207d60db2db63087207730a00d60e998c720d027205d60fb27209730b009683040191720c730c929c720eb27208730d00720c929591720f730e720f7205720e938c720d0172067202";

export class GridOrder implements BuyOrder<PriceRange>, SellOrder<PriceRange> {
  readonly #box: Box<bigint, R4ToR6Registers>;

  readonly #price: PriceRange;
  readonly #limits: PriceRange;

  constructor(box: Box<Amount>) {
    if (!GridOrder.validateBox(box)) throw new Error("Invalid box for GridOrder");

    const r5 = box.additionalRegisters.R5;
    const r6 = box.additionalRegisters.R6;
    const [buyPrice, sellPrice] = SConstant.from<[bigint, bigint]>(r5).data;
    const [buyMax, sellMax] = SConstant.from<[bigint, bigint]>(r6).data;

    this.#price = { buy: buyPrice, sell: sellPrice };
    this.#limits = { buy: buyMax, sell: sellMax };
    this.#box = ensureUTxOBigInt(box) as Box<bigint, R4ToR6Registers>;
  }

  get price(): PriceRange {
    return this.#price;
  }

  get max(): PriceRange {
    return this.#limits;
  }

  get box(): Box<bigint, R4ToR6Registers> {
    return this.#box;
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
          .addTokens([{ tokenId: first(box.assets).tokenId, amount: amount * -1n }]) // fleet will deduct the amount from the tokens
          .setAdditionalRegisters({ R7: SColl(SByte, box.boxId) }) // bind the output to the input box
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
    throw new Error("Sell operation is not implemented yet");
  }

  static create(options: GridOrderCreationParams): OutputBuilder {
    if (!options.assets?.nanoerg && !options.assets?.token.amount) {
      throw new Error("At least one of base or target assets must be specified");
    }

    if (!options.prices.buy || !options.prices.sell) {
      throw new Error("Prices must be specified for both buy and sell");
    }

    const tokenId = SColl(SByte, options.assets.token.tokenId);
    const contract = new ErgoTree(ERG_TOKEN_GRID_CONTRACT).replaceConstant(1, tokenId);

    return new OutputBuilder(options.assets.nanoerg || estimateMinBoxValue(), contract)
      .addTokens(options.assets.token)
      .setAdditionalRegisters({
        R4: SSigmaProp(SGroupElement(first(options.owner.getPublicKeys()))),
        R5: SColl(SLong, [options.prices.buy, options.prices.sell]),
        R6: SColl(SLong, [options.max?.buy ?? 0n, options.max?.sell ?? 0n])
      });
  }

  static validateBox<T extends string | bigint>(box: Box<T>): box is Box<T, R4ToR6Registers> {
    const registers = box.additionalRegisters;
    const areRegistersPresent = registers.R4 && registers.R5 && registers.R6;

    if (!areRegistersPresent) return false;
    return true;
  }
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
