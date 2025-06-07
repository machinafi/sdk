import type {
  Box,
  ErgoUnsignedInput,
  FleetPlugin,
  OutputBuilder,
  R4ToR6Registers,
  TokenAmount
} from "@fleet-sdk/core";

export type AssetId = "nanoerg" | (string & {});

export interface Asset {
  tokenId: AssetId;
  amount: bigint;
}

export interface Assets {
  base: Asset;
  quote: Asset;
}

export interface Order<T = bigint> {
  price: T;
  box: Box<bigint, R4ToR6Registers>;
  // assets: Assets;

  /**
   * Cancels the order by allowing the owner to reclaim the funds.
   */
  cancel: () => FleetPlugin;
}

export interface BuyOrder<T = bigint> extends Order<T> {
  buy: (amount: bigint, handler?: ActionHandler) => FleetPlugin;
}

export interface SellOrder<T = bigint> extends Order<T> {
  sell: (amount: bigint, handler?: ActionHandler) => FleetPlugin;
}

export interface PriceRange {
  buy: bigint;
  sell: bigint;
}

export interface ExchangeableAssets {
  nanoerg: bigint;
  token: TokenAmount<bigint>;
}

/**
 * Action handler for modifying the output of an order action.
 * This allows for custom modifications to the action.
 *
 * @param output - The output builder to modify.
 * @param input - The unsigned input that is being processed.
 */
export type ActionHandler = (output: OutputBuilder, input: ErgoUnsignedInput) => void;
