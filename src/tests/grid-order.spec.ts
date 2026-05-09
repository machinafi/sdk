import type { Box } from "@fleet-sdk/common";
import { first } from "@fleet-sdk/common";

import { OutputBuilder, SAFE_MIN_BOX_VALUE, type R4ToR5Registers } from "@fleet-sdk/core";
import { SGroupElement, SLong, SSigmaProp } from "@fleet-sdk/serializer";
import { MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { describe, expect, it } from "vitest";

import { GridOrder } from "../grid-order";
import { LimitOrder } from "../limit-order";
import { SIGUSD_TOKEN_ID, RSN_TOKEN_ID, FAKE_TOKEN_ID, ONE_ERG } from "./utils";

const chain = new MockChain();
const owner = chain.newParty("Owner");

function makeE2TOrder(baseAmount: bigint, quoteAmount: bigint, prices = { buy: 5n, sell: 10n }): GridOrder {
  const candidate = GridOrder.create({
    owner: owner.address,
    assets: {
      base: { tokenId: "ERG", amount: baseAmount },
      quote: { tokenId: SIGUSD_TOKEN_ID, amount: quoteAmount },
    },
    prices,
  })
    .setCreationHeight(1)
    .build();

  return new GridOrder(mockUTxO(candidate) as Box<bigint, R4ToR5Registers>);
}

function makeT2TOrder(baseAmount: bigint, quoteAmount: bigint, prices = { buy: 5n, sell: 10n }): GridOrder {
  const candidate = GridOrder.create({
    owner: owner.address,
    assets: {
      base: { tokenId: SIGUSD_TOKEN_ID, amount: baseAmount },
      quote: { tokenId: RSN_TOKEN_ID, amount: quoteAmount },
    },
    prices,
  })
    .setCreationHeight(1)
    .build();

  return new GridOrder(mockUTxO(candidate) as Box<bigint, R4ToR5Registers>);
}

describe("GridOrder", () => {
  describe("constructor", () => {
    it("parses an E2T order", () => {
      const order = makeE2TOrder(ONE_ERG, 100n, { buy: 5n, sell: 10n });
      expect(order.price.buy).toBe(5n);
      expect(order.price.sell).toBe(10n);
      expect(order.assets.base.tokenId).toBe("ERG");
      expect(order.assets.base.amount).toBe(ONE_ERG);
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.quote.amount).toBe(100n);
      expect(order.contract.type).toBe("E2T");
    });

    it("parses a T2T order", () => {
      const order = makeT2TOrder(200n, 100n, { buy: 5n, sell: 10n });
      expect(order.price.buy).toBe(5n);
      expect(order.price.sell).toBe(10n);
      expect(order.assets.base.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.base.amount).toBe(200n);
      expect(order.assets.quote.tokenId).toBe(RSN_TOKEN_ID);
      expect(order.assets.quote.amount).toBe(100n);
      expect(order.contract.type).toBe("T2T");
    });

    it("exposes the contract and box", () => {
      const order = makeE2TOrder(ONE_ERG, 100n);
      expect(order.contract).toBeDefined();
      expect(order.box).toBeDefined();
    });

    it("throws for an invalid ergoTree (LimitOrder box used as GridOrder)", () => {
      const limitCandidate = LimitOrder.create({
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

      const box = mockUTxO(limitCandidate) as Box<bigint, R4ToR5Registers>;
      expect(() => new GridOrder(box)).toThrow("Invalid Grid Order contract");
    });

    it("throws for an invalid price register (non-SColl[SLong])", () => {
      const ergoTree = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: "ERG", amount: SAFE_MIN_BOX_VALUE },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        prices: { buy: 5n, sell: 10n },
      })
        .setCreationHeight(1)
        .build().ergoTree;

      // build with a plain SLong instead of SColl(SLong, [...]) for R5
      const candidate = new OutputBuilder(SAFE_MIN_BOX_VALUE, ergoTree)
        .addTokens([{ tokenId: SIGUSD_TOKEN_ID, amount: 100n }])
        .setAdditionalRegisters({
          R4: SSigmaProp(SGroupElement(first(owner.address.getPublicKeys()))),
          R5: SLong(5n),
        })
        .setCreationHeight(1)
        .build();

      const box = mockUTxO(candidate) as Box<bigint, R4ToR5Registers>;
      expect(() => new GridOrder(box)).toThrow("Invalid price register");
    });

    it("throws for an invalid quote token", () => {
      const candidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: "ERG", amount: SAFE_MIN_BOX_VALUE },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        prices: { buy: 5n, sell: 10n },
      })
        .setCreationHeight(1)
        .build();

      // swap quote token ID in box assets to a different token
      const box = mockUTxO({
        ...candidate,
        assets: [{ tokenId: RSN_TOKEN_ID, amount: 100n }],
      }) as Box<bigint, R4ToR5Registers>;

      expect(() => new GridOrder(box)).toThrow("Invalid quote token for the contract");
    });

    it("throws when T2T box has no base token", () => {
      const candidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: SIGUSD_TOKEN_ID, amount: 200n },
          quote: { tokenId: RSN_TOKEN_ID, amount: 100n },
        },
        prices: { buy: 5n, sell: 10n },
      })
        .setCreationHeight(1)
        .build();

      const box = mockUTxO({ ...candidate, assets: [] }) as Box<bigint, R4ToR5Registers>;

      expect(() => new GridOrder(box)).toThrow("The base token is not specified in the box");
    });

    it("throws for an invalid quote token (T2T)", () => {
      const candidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: SIGUSD_TOKEN_ID, amount: 200n },
          quote: { tokenId: RSN_TOKEN_ID, amount: 100n },
        },
        prices: { buy: 5n, sell: 10n },
      })
        .setCreationHeight(1)
        .build();

      const box = mockUTxO({
        ...candidate,
        assets: [
          { tokenId: SIGUSD_TOKEN_ID, amount: 200n },
          { tokenId: FAKE_TOKEN_ID, amount: 100n },
        ],
      }) as Box<bigint, R4ToR5Registers>;

      expect(() => new GridOrder(box)).toThrow("Invalid quote token for the contract");
    });
  });

  describe("buy", () => {
    it("throws when amount is zero", () => {
      const order = makeE2TOrder(ONE_ERG, 100n);
      expect(() => order.buy(0n)).toThrow("Amount must be greater than zero");
    });

    it("throws when amount is negative", () => {
      const order = makeE2TOrder(ONE_ERG, 100n);
      expect(() => order.buy(-1n)).toThrow("Amount must be greater than zero");
    });

    it("throws when amount exceeds available quote tokens (E2T)", () => {
      const order = makeE2TOrder(ONE_ERG, 100n);
      expect(() => order.buy(101n)).toThrow("Amount exceeds the available quote tokens");
    });

    it("throws when amount exceeds available quote tokens (T2T)", () => {
      const order = makeT2TOrder(200n, 100n);
      expect(() => order.buy(101n)).toThrow("Amount exceeds the available quote tokens");
    });

    it("returns a plugin for the exact available amount (E2T)", () => {
      const order = makeE2TOrder(ONE_ERG, 100n);
      expect(order.buy(100n)).toBeTypeOf("function");
    });

    it("returns a plugin for a partial amount (E2T)", () => {
      const order = makeE2TOrder(ONE_ERG, 100n);
      expect(order.buy(1n)).toBeTypeOf("function");
    });

    it("returns a plugin for a partial amount (T2T)", () => {
      const order = makeT2TOrder(200n, 100n);
      expect(order.buy(50n)).toBeTypeOf("function");
    });
  });

  describe("sell", () => {
    it("throws when amount is zero", () => {
      const order = makeE2TOrder(ONE_ERG, 0n);
      expect(() => order.sell(0n)).toThrow("Amount must be greater than zero");
    });

    it("throws when amount is negative", () => {
      const order = makeE2TOrder(ONE_ERG, 0n);
      expect(() => order.sell(-1n)).toThrow("Amount must be greater than zero");
    });

    it("throws when payout would exceed available base ERG (E2T)", () => {
      // base = 100n, sell price = 10n → max sellable = 10 tokens (10 * 10 = 100)
      const order = makeE2TOrder(100n, 0n, { buy: 5n, sell: 10n });
      expect(() => order.sell(11n)).toThrow("Insufficient base amount to cover the payout");
    });

    it("throws when payout would exceed available base tokens (T2T)", () => {
      // base = 100n sigusd, sell price = 10n → max sellable = 10 rsn tokens (10 * 10 = 100)
      const order = makeT2TOrder(100n, 0n, { buy: 5n, sell: 10n });
      expect(() => order.sell(11n)).toThrow("Insufficient base amount to cover the payout");
    });

    it("returns a plugin for the maximum payable amount (E2T)", () => {
      const order = makeE2TOrder(100n, 0n, { buy: 5n, sell: 10n });
      expect(order.sell(10n)).toBeTypeOf("function");
    });

    it("returns a plugin for a partial amount (E2T)", () => {
      const order = makeE2TOrder(ONE_ERG, 0n);
      expect(order.sell(1n)).toBeTypeOf("function");
    });

    it("returns a plugin for a partial amount (T2T)", () => {
      const order = makeT2TOrder(200n, 0n);
      expect(order.sell(1n)).toBeTypeOf("function");
    });
  });

  describe("close", () => {
    it("returns a plugin for E2T orders", () => {
      expect(makeE2TOrder(ONE_ERG, 100n).close()).toBeTypeOf("function");
    });

    it("returns a plugin for T2T orders", () => {
      expect(makeT2TOrder(200n, 100n).close()).toBeTypeOf("function");
    });
  });

  describe("create", () => {
    it("throws when quote asset is ERG", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: "ERG", amount: 100n },
          },
          prices: { buy: 5n, sell: 10n },
        }),
      ).toThrow("Quote asset cannot be ERG");
    });

    it("throws when neither base nor quote amount is specified", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 0n },
          },
          prices: { buy: 5n, sell: 10n },
        }),
      ).toThrow("At least one of base or quote assets must be specified");
    });

    it("throws when buy price is zero", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { buy: 0n, sell: 10n },
        }),
      ).toThrow("Prices must be specified for both buy and sell");
    });

    it("throws when sell price is zero", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { buy: 5n, sell: 0n },
        }),
      ).toThrow("Prices must be specified for both buy and sell");
    });

    it("creates an E2T order when base is ERG", () => {
      const order = makeE2TOrder(ONE_ERG, 100n, { buy: 5n, sell: 10n });
      expect(order.contract.type).toBe("E2T");
      expect(order.assets.base.tokenId).toBe("ERG");
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
    });

    it("creates a T2T order when base is a token", () => {
      const order = makeT2TOrder(200n, 100n, { buy: 5n, sell: 10n });
      expect(order.contract.type).toBe("T2T");
      expect(order.assets.base.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.quote.tokenId).toBe(RSN_TOKEN_ID);
    });

    it("uses estimateMinBoxValue for E2T when no base amount provided", () => {
      const candidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: "ERG", amount: 0n },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        prices: { buy: 5n, sell: 10n },
      })
        .setCreationHeight(1)
        .build();

      const order = new GridOrder(mockUTxO(candidate) as Box<bigint, R4ToR5Registers>);
      expect(order.assets.base.amount).toBeGreaterThan(0n);
    });

    it("stores prices correctly in registers", () => {
      const order = makeE2TOrder(ONE_ERG, 100n, { buy: 7n, sell: 13n });
      expect(order.price.buy).toBe(7n);
      expect(order.price.sell).toBe(13n);
    });
  });
});
