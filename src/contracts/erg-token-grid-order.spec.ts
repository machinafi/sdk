import { compile } from "@fleet-sdk/compiler";
import {
  SAFE_MIN_BOX_VALUE,
  SColl,
  SGroupElement,
  SLong,
  SSigmaProp,
  TransactionBuilder,
  type TokenAmount
} from "@fleet-sdk/core";
import { type KeyedMockChainParty, MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "bun:test";
import type { PriceRange } from "../types";
import { GridOrder } from "../grid-order";

const r = (filename: string) => `./src/contracts/${filename}`;
const script = await Bun.file(r("erg-token-grid-order.es")).text();

const DEFAULT_TOKEN_ID = "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40";
const ONE_ERG = 1_000_000_000n; // 1 erg = 1 billion nanoergs

const token = (amount: bigint): TokenAmount<bigint> => ({ tokenId: DEFAULT_TOKEN_ID, amount });

describe("ERG <-> Token grid order", () => {
  const tree = compile(script);

  const chain = new MockChain(849_741);

  const bob = chain.newParty("Bob");
  const alice = chain.newParty("Alice");
  const contract = chain.addParty(tree.toHex(), "Grid contract");

  const mockOrderBox = orderBuilder(contract.ergoTree, DEFAULT_TOKEN_ID);

  afterEach(() => chain.reset());

  it("Should cancel order", () => {
    // arrange
    const order = new GridOrder(
      mockOrderBox({
        owner: bob,
        available: { nanoergs: ONE_ERG, tokens: 100n },
        price: { buy: 0n, sell: 0n },
        max: { buy: 0n, sell: 0n }
      })
    );

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.cancel())
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

  it("Should not allow canceling order if not owner", () => {
    // arrange
    const order = new GridOrder(mockOrderBox({ owner: bob, price: { buy: 0n, sell: 0n } }));
    const transaction = new TransactionBuilder(chain.height)
      .extend(order.cancel())
      .sendChangeTo(alice.address) // sending change to Alice, but Bob is the owner
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow();
  });
});

interface OrderParams {
  owner: KeyedMockChainParty;
  available?: { nanoergs?: bigint; tokens?: bigint };
  price: PriceRange;
  max?: PriceRange;
}

function orderBuilder(ergoTree: string, tokenId: string) {
  return (p: OrderParams) =>
    mockUTxO({
      ergoTree,
      value: p.available?.nanoergs ?? SAFE_MIN_BOX_VALUE,
      assets: p.available?.tokens ? [{ tokenId, amount: p.available.tokens }] : undefined,
      additionalRegisters: {
        R4: SSigmaProp(SGroupElement(p.owner.key.publicKey)).toHex(),
        R5: SColl(SLong, [p.price.buy, p.price.sell]).toHex(),
        R6: SColl(SLong, [p.max?.buy ?? 0n, p.max?.sell ?? 0n]).toHex()
      }
    });
}
