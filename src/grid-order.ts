import { ensureUTxOBigInt, type Amount, type Box } from "@fleet-sdk/common";
import { SConstant, SInt } from "@fleet-sdk/serializer";
import type { FleetPlugin, OutputBuilder, R4ToR6Registers } from "@fleet-sdk/core";
import type { BuyOrder, GridOrderCreationParams, PriceRange, SellOrder } from "./types";
import { ergTokenGridOrderFactory } from "./contracts/grid/erg-token-grid-order.factory";

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
    return ({ addInputs }) => addInputs(ergTokenGridOrderFactory.cancel(this.#box));
  }

  /**
   * Buys tokens with nanoergs at the price specified in the order.
   * @param amount - The amount of token units to buy.
   */
  buy(amount: bigint): FleetPlugin {
    if (amount <= 0n) throw new Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const [input, output] = ergTokenGridOrderFactory.buy(this.#box, amount, this.#price.buy);

      const outputsLength = addOutputs(output);
      addInputs(input.setContextExtension({ 1: SInt(outputsLength - 1) }));
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

    return ergTokenGridOrderFactory.create(options);
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
