import type { Box } from "@fleet-sdk/common";
import { first } from "@fleet-sdk/common";
import { OutputBuilder, SAFE_MIN_BOX_VALUE, type R4ToR6Registers } from "@fleet-sdk/core";
import { MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { SBool, SGroupElement, SInt, SLong, SSigmaProp } from "@fleet-sdk/serializer";
import { describe, expect, it } from "vitest";

import { GridOrder } from "../grid-order";
import { LimitOrder } from "../limit-order";
import { OrderContract } from "../order-contract";
import { SIGUSD_TOKEN_ID, RSN_TOKEN_ID, FAKE_TOKEN_ID, ONE_ERG } from "./utils";

// E2T limit order proposition with placeholder token id
const E2T_LIMIT_PROPOSITION =
  "1a9d02080e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e05000400040005000580897a05000500d806d601e30004d6027300d603860272027301d604e4c6a70601d605e4c6a70408d606e4c6a7050595e67201d804d607b2a5e4720100d608b2db630872077302017203d6098c720802d60a8cb2db6308a7730301720302d1ed95957204917209730492c172077305ededededed93c27207c2a7938c720801720293e4c672070408720593e4c672070505720693e4c672070601720493e4c67207070ec5a7ed93c27207d0720593e4c67207040ec5a7957204d801d60b99c17207c1a7ed91720b730692720b9c99720a72097206d801d60b997209720aed91720b7307929c720b720699c1a7c172077205";

// Fake T2T contract using E2T proposition — lets us exercise T2T code paths without a real T2T contract
const fakeT2TContract = new OrderContract(E2T_LIMIT_PROPOSITION, "T2T");

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

function makeT2TBuyOrder(quoteAmount: bigint, price: bigint): LimitOrder {
  const candidate = LimitOrder.create(
    {
      owner: owner.address,
      type: "buy",
      // Use non-zero base amount so RSN is included in the box (FleetSDK strips zero-amount tokens)
      assets: {
        base: { tokenId: RSN_TOKEN_ID, amount: 1n },
        quote: { tokenId: SIGUSD_TOKEN_ID, amount: quoteAmount },
      },
      price,
    },
    fakeT2TContract,
  )
    .setCreationHeight(1)
    .build();

  return new LimitOrder(mockUTxO(candidate) as Box<bigint, R4ToR6Registers>, fakeT2TContract);
}

function makeT2TSellOrder(baseAmount: bigint, price: bigint): LimitOrder {
  const candidate = LimitOrder.create(
    {
      owner: owner.address,
      type: "sell",
      // Use non-zero quote amount so SIGUSD is included in the box (FleetSDK strips zero-amount tokens)
      assets: {
        base: { tokenId: RSN_TOKEN_ID, amount: baseAmount },
        quote: { tokenId: SIGUSD_TOKEN_ID, amount: 1n },
      },
      price,
    },
    fakeT2TContract,
  )
    .setCreationHeight(1)
    .build();

  return new LimitOrder(mockUTxO(candidate) as Box<bigint, R4ToR6Registers>, fakeT2TContract);
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

    it("auto-detects the T2T contract when ergoTree matches '0000'", () => {
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

      // ergoTree "0000" matches CONTRACTS.T2T (its proposition and template are both "0000")
      const box = mockUTxO({ ...candidate, ergoTree: "0000", assets: [] }) as Box<
        bigint,
        R4ToR6Registers
      >;

      // Line 56 is reached; T2T path throws because there are no assets
      expect(() => new LimitOrder(box)).toThrow("The base token is not specified in the box");
    });

    it("throws when provided contract does not match box", () => {
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

      const box = mockUTxO(candidate) as Box<bigint, R4ToR6Registers>;
      // fakeT2TContract expects E2T_LIMIT_PROPOSITION, not the default E2T contract
      const mismatchedContract = new OrderContract("deadbeef", "E2T");
      expect(() => new LimitOrder(box, mismatchedContract)).toThrow(
        "The box does not match the provided contract",
      );
    });

    it("parses a T2T buy order", () => {
      const order = makeT2TBuyOrder(100n, 5n);
      expect(order.price).toBe(5n);
      expect(order.assets.base.tokenId).toBe(RSN_TOKEN_ID);
      expect(order.assets.quote.tokenId).toBe(SIGUSD_TOKEN_ID);
      expect(order.assets.quote.amount).toBe(100n);
      expect(order.contract.type).toBe("T2T");
    });

    it("throws when T2T box has no base token", () => {
      const candidate = LimitOrder.create(
        {
          owner: owner.address,
          type: "buy",
          assets: {
            base: { tokenId: RSN_TOKEN_ID, amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          price: 5n,
        },
        fakeT2TContract,
      )
        .setCreationHeight(1)
        .build();

      const box = mockUTxO({ ...candidate, assets: [] }) as Box<bigint, R4ToR6Registers>;
      expect(() => new LimitOrder(box, fakeT2TContract)).toThrow(
        "The base token is not specified in the box",
      );
    });

    it("throws for an invalid quote token (T2T)", () => {
      const candidate = LimitOrder.create(
        {
          owner: owner.address,
          type: "buy",
          assets: {
            base: { tokenId: RSN_TOKEN_ID, amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          price: 5n,
        },
        fakeT2TContract,
      )
        .setCreationHeight(1)
        .build();

      const box = mockUTxO({
        ...candidate,
        assets: [
          { tokenId: RSN_TOKEN_ID, amount: 1n },
          { tokenId: FAKE_TOKEN_ID, amount: 100n },
        ],
      }) as Box<bigint, R4ToR6Registers>;

      expect(() => new LimitOrder(box, fakeT2TContract)).toThrow(
        "Invalid quote token for the contract",
      );
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

    it("throws 'Invalid owner register' for a fulfilling buy when R4 is not SSigmaProp", () => {
      const candidate = new OutputBuilder(SAFE_MIN_BOX_VALUE, fakeT2TContract.new(SIGUSD_TOKEN_ID))
        .addTokens([
          { tokenId: RSN_TOKEN_ID, amount: 1n },
          { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
        ])
        .setAdditionalRegisters({
          R4: SLong(0n), // not SSigmaProp
          R5: SLong(5n),
          R6: SBool(true),
        })
        .setCreationHeight(1)
        .build();

      const order = new LimitOrder(
        mockUTxO(candidate) as Box<bigint, R4ToR6Registers>,
        fakeT2TContract,
      );
      const ctx: any = { addInputs: () => {}, addOutputs: () => 0 };
      expect(() => order.buy(100n)(ctx)).toThrow("Invalid owner register");
    });

    it("throws 'Not supported' for a T2T fulfilling buy inside the plugin", () => {
      const order = makeT2TBuyOrder(100n, 5n);
      const ctx: any = { addInputs: () => {}, addOutputs: () => 0 };
      expect(() => order.buy(100n)(ctx)).toThrow("Not supported");
    });

    it("throws 'Not supported' for a T2T partial buy inside the plugin", () => {
      const order = makeT2TBuyOrder(100n, 5n);
      const ctx: any = { addInputs: () => {}, addOutputs: () => 0 };
      expect(() => order.buy(50n)(ctx)).toThrow("Not supported");
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

    it("throws 'Invalid owner register' for a fulfilling sell when R4 is not SSigmaProp", () => {
      // fulfilling: SAFE_MIN_BOX_VALUE >= base-payout → base=1000n, price=1n, amount=999n → remainder=1n
      const candidate = new OutputBuilder(SAFE_MIN_BOX_VALUE, fakeT2TContract.new(SIGUSD_TOKEN_ID))
        .addTokens([
          { tokenId: RSN_TOKEN_ID, amount: 1000n },
          { tokenId: SIGUSD_TOKEN_ID, amount: 1n },
        ])
        .setAdditionalRegisters({
          R4: SLong(0n), // not SSigmaProp
          R5: SLong(1n),
          R6: SBool(false), // sell
        })
        .setCreationHeight(1)
        .build();

      const order = new LimitOrder(
        mockUTxO(candidate) as Box<bigint, R4ToR6Registers>,
        fakeT2TContract,
      );
      const ctx: any = { addInputs: () => {}, addOutputs: () => 0 };
      expect(() => order.sell(999n)(ctx)).toThrow("Invalid owner register");
    });

    it("throws 'Not supported' for a T2T fulfilling sell inside the plugin", () => {
      // baseAmount=1000n tokens, price=1n, amount=999n → basePayout=999n → base-payout=1n ≤ SAFE_MIN_BOX_VALUE
      const order = makeT2TSellOrder(1000n, 1n);
      const ctx: any = { addInputs: () => {}, addOutputs: () => 0 };
      expect(() => order.sell(999n)(ctx)).toThrow("Not supported");
    });

    it("throws 'Not supported' for a T2T partial sell inside the plugin", () => {
      // baseAmount=ONE_ERG tokens, price=1n, amount=1n → base-payout >> SAFE_MIN_BOX_VALUE
      const order = makeT2TSellOrder(ONE_ERG, 1n);
      const ctx: any = { addInputs: () => {}, addOutputs: () => 0 };
      expect(() => order.sell(1n)(ctx)).toThrow("Not supported");
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

    it("creates an E2T order using a custom contract when base is ERG", () => {
      const builder = LimitOrder.create(
        {
          owner: owner.address,
          type: "buy",
          assets: {
            base: { tokenId: "ERG", amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          price: 5n,
        },
        fakeT2TContract,
      );
      expect(builder).toBeDefined();
    });

    it("creates a T2T order using the default CONTRACTS.T2T when base is not ERG", () => {
      const builder = LimitOrder.create({
        owner: owner.address,
        type: "sell",
        assets: {
          base: { tokenId: RSN_TOKEN_ID, amount: ONE_ERG },
          quote: { tokenId: SIGUSD_TOKEN_ID, amount: 0n },
        },
        price: 5n,
      });
      expect(builder).toBeDefined();
    });

    it("creates a T2T order using a custom contract when base is not ERG", () => {
      const builder = LimitOrder.create(
        {
          owner: owner.address,
          type: "buy",
          assets: {
            base: { tokenId: RSN_TOKEN_ID, amount: 0n },
            quote: { tokenId: SIGUSD_TOKEN_ID, amount: 100n },
          },
          price: 5n,
        },
        fakeT2TContract,
      );
      expect(builder).toBeDefined();
    });
  });
});
