import type {
  Box,
  ErgoUnsignedInput,
  FleetPlugin,
  OutputBuilder,
  R4ToR5Registers,
} from "@fleet-sdk/core";

import type { OrderContract } from "../order-contract";

export type AssetId = "ERG" | (string & {});

export interface Asset {
  tokenId: AssetId;
  amount: bigint;
}

export interface ExchangeableAssets {
  base: Asset;
  quote: Asset;
}

export interface Order<T = bigint> {
  get price(): T;
  get box(): Box<bigint, R4ToR5Registers>;
  get contract(): OrderContract;
  get assets(): ExchangeableAssets;

  /**
   * Cancels the order by allowing the owner to reclaim the funds.
   */
  close: () => FleetPlugin;
}

export interface BuyOrder<T = bigint> extends Order<T> {
  buy: (amount: bigint, handler?: ActionHandler) => FleetPlugin;
}

export interface SellOrder<T = bigint> extends Order<T> {
  sell: (amount: bigint, handler?: ActionHandler) => FleetPlugin;
}

export interface BuySellOrder<T = bigint> extends BuyOrder<T>, SellOrder<T> {}

export interface PriceRange {
  buy: bigint;
  sell: bigint;
}

/**
 * Action handler for modifying the output of an order action.
 * This allows for custom modifications to the action.
 *
 * @param output - The output builder to modify.
 * @param input - The unsigned input that is being processed.
 */
export type ActionHandler = (output: OutputBuilder, input: ErgoUnsignedInput) => void;
