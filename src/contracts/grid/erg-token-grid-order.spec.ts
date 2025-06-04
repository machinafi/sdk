import { compile } from "@fleet-sdk/compiler";
import {
  SAFE_MIN_BOX_VALUE,
  TransactionBuilder,
  type R4ToR6Registers,
  type TokenAmount
} from "@fleet-sdk/core";
import { type KeyedMockChainParty, MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "bun:test";
import { first, type Box } from "@fleet-sdk/common";
import type { PriceRange } from "../../types";
import { GridOrder } from "../../grid-order";

const r = (filename: string) => `./src/contracts/grid/${filename}`;
const script = await Bun.file(r("erg-token-grid-order.es")).text();

const DEFAULT_TOKEN_ID = "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40";
const ONE_ERG = 1_000_000_000n; // 1 erg = 1 billion nanoergs

const token = (amount: bigint): TokenAmount<bigint> => ({ tokenId: DEFAULT_TOKEN_ID, amount });

describe("ERG <-> Token grid order", () => {
  const tree = process.env.RECOMPILE === "true" ? compile(script).toHex() : undefined;
  const chain = new MockChain();

  const mockOrderBox = orderBuilder(tree, DEFAULT_TOKEN_ID);

  afterEach(() => {
    chain.reset();
    chain.parties.length = 0; // reset parties
  });

  it("Should cancel order", () => {
    // arrange

    const bob = chain.newParty("Bob");
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { nanoergs: ONE_ERG, tokens: 100n } })
    );
    const contract = chain.addParty(order.box.ergoTree, "Grid contract");

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.cancel()) // cancel the order
      .sendChangeTo(bob.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [bob] });

    // assert
    expect(success).toBe(true);
    expect(contract.utxos.length).toBe(0);
    expect(bob.balance).toEqual({ nanoergs: ONE_ERG, tokens: [token(100n)] });
    expect(contract.balance).toEqual({ nanoergs: 0n, tokens: [] });
  });

  it("Should partially buy tokens", () => {
    // arrange
    const bob = chain.newParty("Bob");
    const alice = chain.newParty("Alice");

    const prices = { buy: 5n, sell: 10n }; // buy at 5 nanoergs per token, sell at 10 nanoergs per token
    const order = new GridOrder(
      mockOrderBox({
        owner: bob,
        assets: { tokens: 100n },
        prices // buy at 5 nanoergs per token, sell at 10 nanoergs per token
      })
    );

    const contract = chain.addParty(order.box.ergoTree, "Grid contract").addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG });

    const BUY_AMOUNT = 10n; // buying 10 tokens
    const PAY_AMOUNT = BUY_AMOUNT * prices.buy; // 10 * 5 = 50 nanoergs

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(BUY_AMOUNT)) // buy 10 tokens
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });
    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toStrictEqual({
      nanoergs: order.box.value + PAY_AMOUNT, // 1_000_000_000 + 50 = 1_000_000_050 nanoergs in the contract
      tokens: [token(first(order.box.assets).amount - BUY_AMOUNT)] // 100 - 10 = 90 tokens left in the order
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG - PAY_AMOUNT, // 1_000_000_000 - 50 = 999_999_950 nanoergs left
      tokens: [token(BUY_AMOUNT)] // 10 tokens bought
    });
  });

  it("Should not allow canceling order if not owner", () => {
    // arrange
    const bob = chain.newParty("Bob");
    const alice = chain.newParty("Alice");
    const order = new GridOrder(mockOrderBox({ owner: bob }));

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.cancel()) // trying to cancel the order
      .sendChangeTo(alice.address) // sending change to Alice, but Bob is the owner
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow();
  });
});

interface OrderParams {
  owner: KeyedMockChainParty;
  assets?: { nanoergs?: bigint; tokens?: bigint };
  prices?: PriceRange;
  max?: PriceRange;
}

function orderBuilder(ergoTree: string | undefined, tokenId: string) {
  return (p: OrderParams): Box<bigint, R4ToR6Registers> => {
    const candidate = GridOrder.create({
      assets: !p.assets
        ? { nanoerg: SAFE_MIN_BOX_VALUE, token: { tokenId, amount: 0n } }
        : {
            nanoerg: p.assets?.nanoergs ?? 0n,
            token: { tokenId, amount: p.assets?.tokens ?? 0n }
          },
      prices: p.prices ?? { buy: 1n, sell: 1n },
      max: p.max,
      owner: p.owner.address
    })
      .setCreationHeight(1)
      .build();

    return mockUTxO({
      ...candidate,
      ergoTree: ergoTree ?? candidate.ergoTree
    }) as Box<bigint, R4ToR6Registers>;
  };
}
