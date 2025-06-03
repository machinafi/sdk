import type { Box, FleetPlugin, R4ToR6Registers } from "@fleet-sdk/core";

export interface Order<T = bigint> {
  price: T;
  box: Box<bigint, R4ToR6Registers>;

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
