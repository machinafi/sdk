import { ensureUTxOBigInt, type Amount, type Box } from "@fleet-sdk/common";
import type { PriceRange } from "./types";
import { SColl, SConstant, SGroupElement, SLong, SSigmaProp } from "@fleet-sdk/serializer";
import {
  type ErgoAddress,
  OutputBuilder,
  SAFE_MIN_BOX_VALUE,
  type FleetPlugin,
  type R4ToR6Registers
} from "@fleet-sdk/core";

export class GridOrder {
  #box: Box<bigint, R4ToR6Registers>;

  #prices: PriceRange;
  #limits: PriceRange;

  constructor(box: Box<Amount>) {
    if (!GridOrder.validateBox(box)) throw new Error("Invalid box for GridOrder");

    const r5 = box.additionalRegisters.R5;
    const r6 = box.additionalRegisters.R6;
    const [buyPrice, sellPrice] = SConstant.from<[bigint, bigint]>(r5).data;
    const [buyMax, sellMax] = SConstant.from<[bigint, bigint]>(r6).data;

    this.#prices = { buy: buyPrice, sell: sellPrice };
    this.#limits = { buy: buyMax, sell: sellMax };
    this.#box = ensureUTxOBigInt(box) as Box<bigint, R4ToR6Registers>;
  }

  get price(): PriceRange {
    return this.#prices;
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

  static validateBox<T extends string | bigint>(box: Box<T>): box is Box<T, R4ToR6Registers> {
    // todo: validate contract
    if (!box.additionalRegisters.R4) return false;
    if (!box.additionalRegisters.R5) return false;
    if (!box.additionalRegisters.R6) return false;

    return true;
  }
}

export interface ErgTokenAmounts {
  nanoergs?: bigint;
  tokens?: bigint;
}

export class GridOrderBuilder {
  readonly tokenId: string;
  readonly owner: ErgoAddress;

  price?: PriceRange;
  available?: ErgTokenAmounts;
  max?: PriceRange;

  constructor(owner: ErgoAddress, tokenId: string) {
    this.owner = owner;
    this.tokenId = tokenId;
  }

  get contract(): string {
    return `01cafe${this.tokenId}`; // Example ErgoTree, replace with actual contract ErgoTree
  }

  exchange(amounts: ErgTokenAmounts): GridOrderBuilder {
    this.available = amounts;
    return this;
  }

  at(prices: PriceRange): GridOrderBuilder {
    this.price = prices;
    return this;
  }

  limitedTo(limits: PriceRange): GridOrderBuilder {
    this.max = limits;
    return this;
  }

  build(): OutputBuilder {
    if (!this.available?.nanoergs && !this.available?.tokens) {
      throw new Error("At least one of nanoergs or tokens must be specified");
    }
    if (!this.price?.buy || !this.price?.sell) {
      throw new Error("Price must be specified for both buy and sell");
    }

    return new OutputBuilder(this.available.nanoergs ?? SAFE_MIN_BOX_VALUE, this.contract)
      .addTokens({ tokenId: this.tokenId, amount: this.available.tokens ?? 0n })
      .setAdditionalRegisters({
        R4: SSigmaProp(SGroupElement(this.owner.getPublicKeys()[0] as Uint8Array)),
        R5: SColl(SLong, [this.price.buy, this.price.sell]),
        R6: SColl(SLong, [this.max?.buy ?? 0n, this.max?.sell ?? 0n])
      });
  }
}
