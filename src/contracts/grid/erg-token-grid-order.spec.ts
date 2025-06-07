import { compile } from "@fleet-sdk/compiler";
import {
  SAFE_MIN_BOX_VALUE,
  TransactionBuilder,
  type R4ToR5Registers,
  type TokenAmount
} from "@fleet-sdk/core";
import { type KeyedMockChainParty, MockChain, mockUTxO } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "bun:test";
import { first, type Amount, type Box } from "@fleet-sdk/common";
import type { PriceRange } from "../../types";
import { GridOrder } from "../../grid-order";

const r = (filename: string) => `./src/contracts/grid/${filename}`;
const script = await Bun.file(r("erg-token-grid-order.es")).text();

const SIGUSD_TOKEN_ID = "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40";
const FAKE_TOKEN_ID = "fb96947d14ab7006d0aaf90383934278517d7b6e300ad4b7cbbd13cfc3e4ca69";
const ONE_ERG = 1_000_000_000n; // 1 erg = 1 billion nanoergs

const sigUsd = (amount: bigint): TokenAmount<bigint> => ({ tokenId: SIGUSD_TOKEN_ID, amount });
const fakeToken = (amount: bigint): TokenAmount<bigint> => ({ tokenId: FAKE_TOKEN_ID, amount });

const REDUCED_TO_FALSE_ERROR = "Script reduced to false";
const UNPROVEN_SCHNORR_ERROR = "Tree root should be real but was UnprovenSchnorr";

describe("Grid order | erg <-> token | auto-compound", () => {
  const tree = process.env.RECOMPILE === "true" ? compile(script).toHex() : undefined;
  const mockOrderBox = orderBuilder(tree, SIGUSD_TOKEN_ID);

  const chain = new MockChain();
  const bob = chain.newParty("Bob");
  const alice = chain.newParty("Alice");
  const contract = chain.addParty(mockOrderBox({ owner: bob }).ergoTree, "Grid contract");

  afterEach(() => chain.reset({ clearParties: true }));

  it("Should cancel order", () => {
    // arrange
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { nanoergs: ONE_ERG, tokens: 100n } })
    );

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.cancel()) // cancel the order
      .sendChangeTo(bob.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [bob] });

    // assert
    expect(success).toBe(true);
    expect(contract.utxos.length).toBe(0);
    expect(bob.balance).toEqual({ nanoergs: ONE_ERG, tokens: [sigUsd(100n)] });
    expect(contract.balance).toEqual({ nanoergs: 0n, tokens: [] });
  });

  it("Should partially buy tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n }; // buy at 5 nanoergs per token, sell at 10 nanoergs per token
    const order = new GridOrder(
      mockOrderBox({
        owner: bob,
        assets: { tokens: 100n },
        prices // buy at 5 nanoergs per token, sell at 10 nanoergs per token
      })
    );

    contract.addUTxOs(order.box);
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
      tokens: [sigUsd(first(order.box.assets).amount - BUY_AMOUNT)] // 100 - 10 = 90 tokens left in the order
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG - PAY_AMOUNT, // 1_000_000_000 - 50 = 999_999_950 nanoergs left
      tokens: [sigUsd(BUY_AMOUNT)] // 10 tokens bought
    });
  });

  it("Should fully buy tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n }; // buy at 5 nanoergs per token, sell at 10 nanoergs per token
    const order = new GridOrder(
      mockOrderBox({
        owner: bob,
        assets: { tokens: 100n },
        prices // buy at 5 nanoergs per token, sell at 10 nanoergs per token
      })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG });

    const BUY_AMOUNT = 100n; // buying all 100 tokens
    const PAY_AMOUNT = BUY_AMOUNT * prices.buy; // 10 * 5 = 50 nanoergs

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(BUY_AMOUNT)) // buy tokens
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toStrictEqual({
      nanoergs: order.box.value + PAY_AMOUNT, // contract now has 1_000_000_000 + 500 = 1_000_000_500 nanoergs
      tokens: [] // no tokens left in the order
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG - PAY_AMOUNT, // alice has 1_000_000_000 - 500 = 999_999_500 nanoergs left
      tokens: [sigUsd(100n)] // alice now has all 100 tokens
    });
  });

  it("Should partially sell tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n }; // buy at 5 nanoergs per token, sell at 10 nanoergs per token
    const order = new GridOrder(
      mockOrderBox({
        owner: bob,
        assets: { nanoergs: ONE_ERG },
        prices // buy at 5 nanoergs per token, sell at 10 nanoergs per token
      })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigUsd(100n)], nanoergs: ONE_ERG }); // Alice has 100 tokens to sell

    const SELL_AMOUNT = 10n; // selling 10 tokens
    const PAY_AMOUNT = SELL_AMOUNT * prices.sell; // 10 * 10 = 100 nanoergs

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(SELL_AMOUNT)) // sell 10 tokens
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toStrictEqual({
      nanoergs: order.box.value - PAY_AMOUNT,
      tokens: [sigUsd(SELL_AMOUNT)]
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG + PAY_AMOUNT,
      tokens: [sigUsd(90n)]
    });
  });

  it("Should fully sell tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n }; // buy at 5 nanoergs per token, sell at 10 nanoergs per token
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { nanoergs: ONE_ERG }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n)] }); // Alice has 100 tokens to sell

    const SELL_AMOUNT = 100n; // selling all 100 tokens
    const PAY_AMOUNT = SELL_AMOUNT * prices.sell; // 100 * 10 = 1000 nanoergs

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(SELL_AMOUNT))
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toStrictEqual({
      nanoergs: order.box.value - PAY_AMOUNT,
      tokens: [sigUsd(SELL_AMOUNT)] // contract now has 100 tokens from alice
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG + PAY_AMOUNT,
      tokens: [] // Alice has no tokens left
    });
  });

  it.todo("Should allow composing multiple orders in the same transaction", () => {});

  it("Should allow operations in the child orders", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const fatherOrder = new GridOrder(
      mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices })
    );

    contract.addUTxOs(fatherOrder.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [] });
    bob.addBalance({ nanoergs: ONE_ERG, tokens: [] });

    const fatherTx = new TransactionBuilder(chain.height)
      .extend(fatherOrder.buy(10n))
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(fatherTx, { signers: [alice] })).not.toThrow();

    // assert sell
    const childOrder1 = new GridOrder(
      fatherTx.outputs.at(0)?.toPlainObject("EIP-12") as Box<Amount, R4ToR5Registers>
    );
    const childSellTx = new TransactionBuilder(chain.height)
      .extend(childOrder1.sell(5n))
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    expect(() => chain.execute(childSellTx, { signers: [alice] })).not.toThrow();

    // assert buy
    const childOrder2 = new GridOrder(
      childSellTx.outputs.at(0)?.toPlainObject("EIP-12") as Box<Amount, R4ToR5Registers>
    );
    const childBuyTx = new TransactionBuilder(chain.height)
      .extend(childOrder2.buy(5n))
      .from(bob.utxos)
      .sendChangeTo(bob.address)
      .build();

    expect(() => chain.execute(childBuyTx, { signers: [bob] })).not.toThrow();

    // assert cancel
    const childOrder3 = new GridOrder(
      childBuyTx.outputs.at(0)?.toPlainObject("EIP-12") as Box<Amount, R4ToR5Registers>
    );
    const childCancelTx = new TransactionBuilder(chain.height)
      .extend(childOrder3.cancel())
      .from(bob.utxos)
      .sendChangeTo(bob.address)
      .build();

    expect(() => chain.execute(childCancelTx, { signers: [bob] })).not.toThrow();
  });

  it("Should not allow canceling order if not by the owner", () => {
    // arrange
    const order = new GridOrder(mockOrderBox({ owner: bob }));
    const transaction = new TransactionBuilder(chain.height)
      .extend(order.cancel()) // trying to cancel the order
      .sendChangeTo(alice.address) // sending change to Alice, but Bob is the owner
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(UNPROVEN_SCHNORR_ERROR);
  });

  it("Should not allow buying tokens when underpaying", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG });

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(10n, (output) => output.setValue(output.value - 1n))) // trying to pay 1 nanoerg less
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow selling tokens when underpaying", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { nanoergs: ONE_ERG }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(10n, (output) => output.addTokens(sigUsd(-1n)))) // tries to sell 10 tokens but only sends 9
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    expect(transaction.outputs[0]?.assets[0]?.amount).toBe(9n); // should have 9 tokens instead of 10

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow buying when the Token ID is swapped", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        // attempt to buy tokens but maliciously replace the token ID
        order.buy(10n, (output) => output.eject((x) => (x.tokens.at(0).tokenId = FAKE_TOKEN_ID)))
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow selling when the Token ID is swapped", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { nanoergs: ONE_ERG }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n), fakeToken(100n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        // attempt to sell tokens but maliciously replace the token ID
        order.sell(10n, (output) => output.eject((x) => (x.tokens.at(0).tokenId = FAKE_TOKEN_ID)))
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it.todo("Should not allow changing the owner of the order", () => {});
  it.todo("Should not allow changing the prices of the order", () => {});
  it.todo("Should not allow changing the contract of the order", () => {});
  it.todo("Should not allow spending the order from multiple outputs", () => {});
});

interface OrderParams {
  owner: KeyedMockChainParty;
  assets?: { nanoergs?: bigint; tokens?: bigint };
  prices?: PriceRange;
  max?: PriceRange;
}

function orderBuilder(ergoTree: string | undefined, tokenId: string) {
  return (p: OrderParams): Box<bigint, R4ToR5Registers> => {
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
    }) as Box<bigint, R4ToR5Registers>;
  };
}
