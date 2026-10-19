import type { Box } from "@fleet-sdk/common";
import { first } from "@fleet-sdk/common";
import { OutputBuilder, SAFE_MIN_BOX_VALUE, type R4ToR5Registers } from "@fleet-sdk/core";
import { MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { SConstant, SGroupElement, SLong, SSigmaProp } from "@fleet-sdk/serializer";
import { describe, expect, it } from "vitest";

import { GridOrder } from "../grid-order";
import { LimitOrder } from "../limit-order";
import { OrderContract } from "../order-contract";
import { SIGUSD_TOKEN_ID, RSN_TOKEN_ID, FAKE_TOKEN_ID, ONE_ERG } from "./utils";

const chain = new MockChain();
const owner = chain.newParty("Owner");

function makeE2TOrder(
  baseAmount: bigint,
  quoteAmount: bigint,
  prices = { bid: 5n, ask: 10n },
): GridOrder {
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

function makeT2TOrder(
  baseAmount: bigint,
  quoteAmount: bigint,
  prices = { bid: 5n, ask: 10n },
): GridOrder {
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
      const order = makeE2TOrder(ONE_ERG, 100n, { bid: 5n, ask: 10n });
      expect(order.price.buy).toBe(10n);
      expect(order.price.sell).toBe(5n);
      expect(order.assets.base.tokenId).toBe("ERG");
      expect(order.assets.base.amount).toBe(ONE_ERG);
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.quote.amount).toBe(100n);
      expect(order.contract.type).toBe("E2T");
    });

    it("parses a T2T order", () => {
      const order = makeT2TOrder(200n, 100n, { bid: 5n, ask: 10n });
      expect(order.price.buy).toBe(10n);
      expect(order.price.sell).toBe(5n);
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

    it("uses the provided contract when it matches the box", () => {
      const { box, contract } = makeE2TOrder(ONE_ERG, 100n);
      const custom = new OrderContract(contract.proposition, "E2T");

      const order = new GridOrder(box, custom);
      expect(order.contract).toBe(custom);
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
    });

    it("throws when the provided contract does not match the box", () => {
      const { box } = makeE2TOrder(ONE_ERG, 100n);
      const t2t = makeT2TOrder(200n, 100n).contract;

      expect(() => new GridOrder(box, t2t)).toThrow("The box does not match the provided contract");
    });

    it("throws for an invalid price register (non-SColl[SLong])", () => {
      const ergoTree = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: "ERG", amount: SAFE_MIN_BOX_VALUE },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        prices: { bid: 5n, ask: 10n },
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
        prices: { bid: 5n, ask: 10n },
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
        prices: { bid: 5n, ask: 10n },
      })
        .setCreationHeight(1)
        .build();

      const box = mockUTxO({ ...candidate, assets: [] }) as Box<bigint, R4ToR5Registers>;

      expect(() => new GridOrder(box)).toThrow("The base token is not specified in the box");
    });

    it("throws when T2T box holds only the quote token", () => {
      const candidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: SIGUSD_TOKEN_ID, amount: 200n },
          quote: { tokenId: RSN_TOKEN_ID, amount: 100n },
        },
        prices: { bid: 5n, ask: 10n },
      })
        .setCreationHeight(1)
        .build();

      // the quote token sits at the base index, so base and quote resolve to the same token
      const box = mockUTxO({
        ...candidate,
        assets: [{ tokenId: RSN_TOKEN_ID, amount: 100n }],
      }) as Box<bigint, R4ToR5Registers>;

      expect(() => new GridOrder(box)).toThrow("Base and quote tokens must be different");
    });

    it("throws for an invalid quote token (T2T)", () => {
      const candidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: SIGUSD_TOKEN_ID, amount: 200n },
          quote: { tokenId: RSN_TOKEN_ID, amount: 100n },
        },
        prices: { bid: 5n, ask: 10n },
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
      const order = makeE2TOrder(100n, 0n, { bid: 10n, ask: 10n });
      expect(() => order.sell(11n)).toThrow("Insufficient base amount to cover the payout");
    });

    it("throws when payout would exceed available base tokens (T2T)", () => {
      // base = 100n sigusd, sell price = 10n → max sellable = 10 rsn tokens (10 * 10 = 100)
      const order = makeT2TOrder(100n, 0n, { bid: 10n, ask: 10n });
      expect(() => order.sell(11n)).toThrow("Insufficient base amount to cover the payout");
    });

    it("returns a plugin for the maximum payable amount (E2T)", () => {
      const order = makeE2TOrder(100n, 0n, { bid: 10n, ask: 10n });
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

  it("rejects a box whose contract has tampered constants", () => {
    const box = makeE2TOrder(ONE_ERG, 100n).box;
    // swap the BUY and SELL price index constants: same length and template, inverted prices
    const ergoTree = box.ergoTree.replace(
      "0500040004000500040005000402",
      "0500040004000500040205000400",
    );

    expect(ergoTree).not.toBe(box.ergoTree);
    expect(() => new GridOrder({ ...box, ergoTree })).toThrow("Invalid Grid Order contract");
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
          prices: { bid: 5n, ask: 10n },
        }),
      ).toThrow("Quote asset cannot be ERG");
    });

    it("throws when base and quote assets are the same token", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 5n, ask: 10n },
        }),
      ).toThrow("Base and quote assets must be different");
    });

    it("throws when base amount is negative", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: -1n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 5n, ask: 10n },
        }),
      ).toThrow("Asset amounts cannot be negative");
    });

    it("throws when quote amount is negative", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: 1_000_000_000n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: -100n },
          },
          prices: { bid: 5n, ask: 10n },
        }),
      ).toThrow("Asset amounts cannot be negative");
    });

    it("throws for a malformed quote token ID", () => {
      // with no quote tokens in the box, nothing else would reject the corrupted, unspendable tree
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID.slice(0, 62), amount: 0n },
          },
          prices: { bid: 5n, ask: 10n },
        }),
      ).toThrow("Invalid quote token ID");
    });

    it("throws when T2T base amount is zero", () => {
      // without a base token at index 0, the quote token would take its place
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: SIGUSD_TOKEN_ID, amount: 0n },
            quote: { tokenId: RSN_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 5n, ask: 10n },
        }),
      ).toThrow("Base amount must be specified for T2T orders");
    });

    it("throws when neither base nor quote amount is specified", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 0n },
          },
          prices: { bid: 5n, ask: 10n },
        }),
      ).toThrow("At least one of base or quote assets must be specified");
    });

    it("throws when ask price is zero", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 5n, ask: 0n },
        }),
      ).toThrow("Bid and ask prices must be greater than zero");
    });

    it("throws when bid price is zero", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 0n, ask: 5n },
        }),
      ).toThrow("Bid and ask prices must be greater than zero");
    });

    it("throws when ask price is negative", () => {
      // a negative ask would let takers buy all quote tokens for a single nanoerg
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: -10n, ask: -5n },
        }),
      ).toThrow("Bid and ask prices must be greater than zero");
    });

    it("throws when bid price is negative", () => {
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: -5n, ask: 10n },
        }),
      ).toThrow("Bid and ask prices must be greater than zero");
    });

    it("throws when bid price is higher than ask price", () => {
      // takers could buy low and sell high in a loop, draining the order
      expect(() =>
        GridOrder.create({
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 10n, ask: 5n },
        }),
      ).toThrow("Bid price must be lower than or equal to the ask price");
    });

    it("allows equal bid and ask prices", () => {
      const order = makeE2TOrder(ONE_ERG, 100n, { bid: 7n, ask: 7n });
      expect(order.price).toEqual({ buy: 7n, sell: 7n });
    });

    it("creates an E2T order when base is ERG", () => {
      const order = makeE2TOrder(ONE_ERG, 100n, { bid: 5n, ask: 10n });
      expect(order.contract.type).toBe("E2T");
      expect(order.assets.base.tokenId).toBe("ERG");
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
    });

    it("creates a T2T order when base is a token", () => {
      const order = makeT2TOrder(200n, 100n, { bid: 5n, ask: 10n });
      expect(order.contract.type).toBe("T2T");
      expect(order.assets.base.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.quote.tokenId).toBe(RSN_TOKEN_ID);
    });

    it("creates an E2T order using a custom contract", () => {
      const e2t = makeE2TOrder(ONE_ERG, 100n).contract;
      const custom = new OrderContract(e2t.proposition, "E2T");
      const candidate = GridOrder.create(
        {
          owner: owner.address,
          assets: {
            base: { tokenId: "ERG", amount: ONE_ERG },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 5n, ask: 10n },
        },
        custom,
      );

      expect(candidate.ergoTree).toBe(custom.new(SIGUSD_TOKEN_ID));
    });

    it("creates a T2T order using a custom contract", () => {
      const t2t = makeT2TOrder(200n, 100n).contract;
      const custom = new OrderContract(t2t.proposition, "T2T");
      const candidate = GridOrder.create(
        {
          owner: owner.address,
          assets: {
            base: { tokenId: SIGUSD_TOKEN_ID, amount: 200n },
            quote: { tokenId: RSN_TOKEN_ID, amount: 100n },
          },
          prices: { bid: 5n, ask: 10n },
        },
        custom,
      );

      expect(candidate.ergoTree).toBe(custom.new(RSN_TOKEN_ID));
    });

    it("throws when a custom E2T contract is provided and base is not ERG", () => {
      const e2t = makeE2TOrder(ONE_ERG, 100n).contract;
      expect(() =>
        GridOrder.create(
          {
            owner: owner.address,
            assets: {
              base: { tokenId: SIGUSD_TOKEN_ID, amount: 200n },
              quote: { tokenId: RSN_TOKEN_ID, amount: 100n },
            },
            prices: { bid: 5n, ask: 10n },
          },
          e2t,
        ),
      ).toThrow("Base asset does not match the E2T contract");
    });

    it("throws when a custom T2T contract is provided and base is ERG", () => {
      const t2t = makeT2TOrder(200n, 100n).contract;
      expect(() =>
        GridOrder.create(
          {
            owner: owner.address,
            assets: {
              base: { tokenId: "ERG", amount: ONE_ERG },
              quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
            },
            prices: { bid: 5n, ask: 10n },
          },
          t2t,
        ),
      ).toThrow("Base asset does not match the T2T contract");
    });

    it("uses estimateMinBoxValue for E2T when no base amount provided", () => {
      const candidate = GridOrder.create({
        owner: owner.address,
        assets: {
          base: { tokenId: "ERG", amount: 0n },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        },
        prices: { bid: 5n, ask: 10n },
      })
        .setCreationHeight(1)
        .build();

      const order = new GridOrder(mockUTxO(candidate) as Box<bigint, R4ToR5Registers>);
      expect(order.assets.base.amount).toBeGreaterThan(0n);
    });

    it("stores owner prices as taker prices in registers", () => {
      // takers buy at the owner's ask and sell at the owner's bid
      const order = makeE2TOrder(ONE_ERG, 100n, { bid: 7n, ask: 13n });
      expect(order.price.buy).toBe(13n);
      expect(order.price.sell).toBe(7n);
      expect(SConstant.from(order.box.additionalRegisters.R5).data).toEqual([13n, 7n]);
    });
  });
});
