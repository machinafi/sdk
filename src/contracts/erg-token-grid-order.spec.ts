import { compile } from "@fleet-sdk/compiler";
import { SAFE_MIN_BOX_VALUE, TransactionBuilder, type TokenAmount } from "@fleet-sdk/core";
import { type KeyedMockChainParty, MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "bun:test";
import { GridOrder, type PriceRange } from "../grid-order";

const r = (filename: string) => `./src/contracts/${filename}`;
const script = await Bun.file(r("erg-token-grid-order.es")).text();

const DEFAULT_TOKEN_ID = "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40";
const ONE_ERG = 1_000_000_000n; // 1 erg = 1 billion nanoergs

const token = (amount: bigint): TokenAmount<bigint> => ({ tokenId: DEFAULT_TOKEN_ID, amount });

describe("ERG <-> Token grid order", () => {
  const tree = compile(script);
  const chain = new MockChain();

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
        assets: { nanoergs: ONE_ERG, tokens: 100n }
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
    const order = new GridOrder(mockOrderBox({ owner: bob }));

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
  assets?: { nanoergs?: bigint; tokens?: bigint };
  prices?: PriceRange;
  max?: PriceRange;
}

function orderBuilder(ergoTree: string, tokenId: string) {
  return (p: OrderParams) => {
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
      .setCreationHeight(0)
      .build();

    return mockUTxO({
      ...candidate,
      ergoTree
    });
  };
}
