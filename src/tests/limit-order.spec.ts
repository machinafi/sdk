import type { Box } from "@fleet-sdk/common";
import { first } from "@fleet-sdk/common";

import { OutputBuilder, SAFE_MIN_BOX_VALUE, type R4ToR6Registers } from "@fleet-sdk/core";
import { SBool, SGroupElement, SInt, SLong, SSigmaProp } from "@fleet-sdk/serializer";
import { MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { describe, expect, it } from "vitest";

import { GridOrder } from "../grid-order";
import { LimitOrder } from "../limit-order";
import { SIGUSD_TOKEN_ID, RSN_TOKEN_ID, ONE_ERG } from "./utils";

const chain = new MockChain();
const owner = chain.newParty("Owner");

function makeBuyOrder(quoteAmount: bigint, price: bigint): LimitOrder {
  const candidate = LimitOrder.create({
    owner: owner.address,
    type: "buy",
    assets: {
      base: { tokenId: "ERG", amount: 0n },
      quote: { tokenId: SIGUSD_TOKEN_ID, amount: quoteAmount },
    },
    price,
  })
    .setCreationHeight(1)
    .build();

  return new LimitOrder(mockUTxO(candidate) as Box<bigint, R4ToR6Registers>);
}

function makeSellOrder(baseAmount: bigint, price: bigint): LimitOrder {
  const candidate = LimitOrder.create({
    owner: owner.address,
    type: "sell",
    assets: {
      base: { tokenId: "ERG", amount: baseAmount },
      quote: { tokenId: SIGUSD_TOKEN_ID, amount: 0n },
    },
    price,
  })
    .setCreationHeight(1)
    .build();

  return new LimitOrder(mockUTxO(candidate) as Box<bigint, R4ToR6Registers>);
}

describe("LimitOrder", () => {
  describe("constructor", () => {
    it("parses an E2T buy order", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(order.price).toBe(5n);
      expect(order.assets.quote.amount).toBe(100n);
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.base.tokenId).toBe("ERG");
    });

    it("parses an E2T sell order", () => {
      const order = makeSellOrder(ONE_ERG, 10n);
      expect(order.price).toBe(10n);
      expect(order.assets.base.tokenId).toBe("ERG");
      expect(order.assets.base.amount).toBe(ONE_ERG);
    });

    it("exposes the contract and box", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(order.contract).toBeDefined();
      expect(order.contract.type).toBe("E2T");
      expect(order.box).toBeDefined();
    });

    it("throws for an invalid ergoTree (GridOrder box used as LimitOrder)", () => {
      const gridCandidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: "ERG", amount: SAFE_MIN_BOX_VALUE },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        prices: { buy: 5n, sell: 10n },
      })
        .setCreationHeight(1)
        .build();

      const box = mockUTxO(gridCandidate) as Box<bigint, R4ToR6Registers>;
      expect(() => new LimitOrder(box)).toThrow("Invalid Limit Order contract");
    });

    it("throws for an invalid price register (non-SLong)", () => {
      const ergoTree = LimitOrder.create({
        owner: owner.address,
        type: "buy",
        assets: {
          base: { tokenId: "ERG", amount: 0n },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        price: 5n,
      })
        .setCreationHeight(1)
        .build().ergoTree;

      // build with SInt instead of SLong for R5
      const candidate = new OutputBuilder(SAFE_MIN_BOX_VALUE, ergoTree)
        .addTokens([{ tokenId: SIGUSD_TOKEN_ID, amount: 100n }])
        .setAdditionalRegisters({
          R4: SSigmaProp(SGroupElement(first(owner.address.getPublicKeys()))),
          R5: SInt(5),
          R6: SBool(true),
        })
        .setCreationHeight(1)
        .build();

      const box = mockUTxO(candidate) as Box<bigint, R4ToR6Registers>;
      expect(() => new LimitOrder(box)).toThrow("Invalid price register");
    });

    it("throws for an invalid order type register (non-SBool)", () => {
      const ergoTree = LimitOrder.create({
        owner: owner.address,
        type: "buy",
        assets: {
          base: { tokenId: "ERG", amount: 0n },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        price: 5n,
      })
        .setCreationHeight(1)
        .build().ergoTree;

      // build with SLong instead of SBool for R6
      const candidate = new OutputBuilder(SAFE_MIN_BOX_VALUE, ergoTree)
        .addTokens([{ tokenId: SIGUSD_TOKEN_ID, amount: 100n }])
        .setAdditionalRegisters({
          R4: SSigmaProp(SGroupElement(first(owner.address.getPublicKeys()))),
          R5: SLong(5n),
          R6: SLong(0n),
        })
        .setCreationHeight(1)
        .build();

      const box = mockUTxO(candidate) as Box<bigint, R4ToR6Registers>;
      expect(() => new LimitOrder(box)).toThrow("Invalid order type register");
    });

    it("throws for an invalid quote token", () => {
      const candidate = LimitOrder.create({
        owner: owner.address,
        type: "buy",
        assets: {
          base: { tokenId: "ERG", amount: 0n },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        price: 5n,
      })
        .setCreationHeight(1)
        .build();

      // swap the token ID in the box assets to a different token
      const box = mockUTxO({
        ...candidate,
        assets: [{ tokenId: RSN_TOKEN_ID, amount: 100n }],
      }) as Box<bigint, R4ToR6Registers>;

      expect(() => new LimitOrder(box)).toThrow("Invalid quote token for the contract");
    });
  });

  describe("buy", () => {
    it("throws when called on a sell order", () => {
      const order = makeSellOrder(ONE_ERG, 10n);
      expect(() => order.buy(1n)).toThrow("Buy action is not allowed in this contract");
    });

    it("throws when amount is zero", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(() => order.buy(0n)).toThrow("Amount must be greater than zero");
    });

    it("throws when amount is negative", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(() => order.buy(-1n)).toThrow("Amount must be greater than zero");
    });

    it("throws when amount exceeds available quote tokens", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(() => order.buy(101n)).toThrow("Amount exceeds the available quote tokens");
    });

    it("returns a plugin for the exact available amount", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(order.buy(100n)).toBeTypeOf("function");
    });

    it("returns a plugin for a partial amount", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(order.buy(1n)).toBeTypeOf("function");
    });
  });

  describe("sell", () => {
    it("throws when called on a buy order", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(() => order.sell(1n)).toThrow("Sell action is not allowed in this contract");
    });

    it("throws when amount is zero", () => {
      const order = makeSellOrder(ONE_ERG, 10n);
      expect(() => order.sell(0n)).toThrow("Amount must be greater than zero");
    });

    it("throws when amount is negative", () => {
      const order = makeSellOrder(ONE_ERG, 10n);
      expect(() => order.sell(-1n)).toThrow("Amount must be greater than zero");
    });

    it("throws when payout would exceed available base (ERG)", () => {
      // base = 100n, price = 10n > max sellable = 10 tokens (10 * 10 = 100)
      const order = makeSellOrder(100n, 10n);
      expect(() => order.sell(11n)).toThrow("Insufficient base amount to cover the payout");
    });

    it("returns a plugin for the maximum payable amount", () => {
      const order = makeSellOrder(100n, 10n);
      expect(order.sell(10n)).toBeTypeOf("function");
    });

    it("returns a plugin for a partial amount", () => {
      const order = makeSellOrder(ONE_ERG, 10n);
      expect(order.sell(1n)).toBeTypeOf("function");
    });
  });

  describe("close", () => {
    it("returns a plugin for buy orders", () => {
      expect(makeBuyOrder(100n, 5n).close()).toBeTypeOf("function");
    });

    it("returns a plugin for sell orders", () => {
      expect(makeSellOrder(ONE_ERG, 10n).close()).toBeTypeOf("function");
    });
  });

  describe("create", () => {
    it("throws when quote asset is ERG", () => {
      expect(() =>
        LimitOrder.create({
          owner: owner.address,
          type: "buy",
          assets: {
            base: { tokenId: "ERG", amount: 0n },
            quote: { tokenId: "ERG", amount: 100n },
          },
          price: 5n,
        }),
      ).toThrow("Quote asset cannot be ERG");
    });

    it("throws when price is zero", () => {
      expect(() =>
        LimitOrder.create({
          owner: owner.address,
          type: "buy",
          assets: {
            base: { tokenId: "ERG", amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          price: 0n,
        }),
      ).toThrow("Quote token price must be specified");
    });

    it("throws for a buy order without quote amount", () => {
      expect(() =>
        LimitOrder.create({
          owner: owner.address,
          type: "buy",
          assets: {
            base: { tokenId: "ERG", amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 0n },
          },
          price: 5n,
        }),
      ).toThrow("Quote amount must be specified for buy orders");
    });

    it("throws for a sell order without base amount", () => {
      expect(() =>
        LimitOrder.create({
          owner: owner.address,
          type: "sell",
          assets: {
            base: { tokenId: "ERG", amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 0n },
          },
          price: 5n,
        }),
      ).toThrow("Base amount must be specified for sell orders");
    });

    it("creates an E2T buy order with correct properties", () => {
      const order = makeBuyOrder(100n, 5n);
      expect(order.price).toBe(5n);
      expect(order.assets.quote.amount).toBe(100n);
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.base.tokenId).toBe("ERG");
      expect(order.contract.type).toBe("E2T");
    });

    it("creates an E2T sell order with correct properties", () => {
      const order = makeSellOrder(ONE_ERG, 10n);
      expect(order.price).toBe(10n);
      expect(order.assets.base.tokenId).toBe("ERG");
      expect(order.assets.base.amount).toBe(ONE_ERG);
      expect(order.contract.type).toBe("E2T");
    });
  });
});
