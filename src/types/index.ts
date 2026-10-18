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
  close(): FleetPlugin;
}

export interface BuyOrder<T = bigint> extends Order<T> {
  buy(amount: bigint, handler?: ActionHandler): FleetPlugin;
}

export interface SellOrder<T = bigint> extends Order<T> {
  sell(amount: bigint, handler?: ActionHandler): FleetPlugin;
}

export interface BuySellOrder<T = bigint> extends BuyOrder<T>, SellOrder<T> {}

/**
 * Grid order prices, from the taker's side, as used when filling an order.
 */
export interface PriceRange {
  /** Price takers pay per quote token unit when buying from the order. */
  buy: bigint;
  /** Price takers receive per quote token unit when selling to the order. */
  sell: bigint;
}

/**
 * Grid order prices, from the owner's side, as used when creating an order.
 * `bid` must be lower than or equal to `ask`, otherwise takers can buy and sell
 * back in a loop to drain the order.
 */
export interface BidAskPrices {
  /** Price the owner buys quote tokens at, i.e. what takers receive when selling. */
  bid: bigint;
  /** Price the owner sells quote tokens at, i.e. what takers pay when buying. */
  ask: bigint;
}

/**
 * Action handler for modifying the output of an order action.
 * This allows for custom modifications to the action.
 *
 * @param output - The output builder to modify.
 * @param input - The unsigned input that is being processed.
 */
export type ActionHandler = (output: OutputBuilder, input: ErgoUnsignedInput) => void;
