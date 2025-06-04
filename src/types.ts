import type { Box, ErgoAddress, FleetPlugin, R4ToR6Registers, TokenAmount } from "@fleet-sdk/core";

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
  buy: (amount: bigint) => FleetPlugin;
}

export interface SellOrder<T = bigint> extends Order<T> {
  sell: (amount: bigint) => FleetPlugin;
}

export interface GridOrderCreationParams {
  owner: ErgoAddress;
  assets: ExchangeableAssets;
  prices: PriceRange;
  max?: PriceRange;
}

export interface PriceRange {
  buy: bigint;
  sell: bigint;
}

export interface ExchangeableAssets {
  nanoerg: bigint;
  token: TokenAmount<bigint>;
}
