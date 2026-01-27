import type { _10n } from "@fleet-sdk/common";

import { SInt, TransactionBuilder } from "@fleet-sdk/core";
import { MockChain } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "vitest";

import { LimitOrder } from "../../limit-order";
import {
  createLimitOrderMocker,
  fakeToken,
  ONE_ERG,
  REDUCED_TO_FALSE_ERROR,
  sigusd,
  SIGUSD_TOKEN_ID,
  UNPROVEN_SCHNORR_ERROR,
} from "../../tests/utils";
import E2TScript from "../limit/e2t-limit-order.es?raw";

/**
 * This test suite covers the ERG <-> Token limit order contract.
 */
describe("Limit order | erg <-> token", () => {
  // E2T contract is implicitly selected if ERG is the base asset.
  const mockOrderBox = createLimitOrderMocker(E2TScript, "ERG", SIGUSD_TOKEN_ID);

  const chain = new MockChain();
  const bob = chain.newParty("Bob");
  const alice = chain.newParty("Alice");
  const contract = chain.addParty(mockOrderBox("buy", { owner: bob }).ergoTree, "Limit contract");

  afterEach(() => chain.reset({ clearParties: true }));

  it("Should close the order and withdrawal funds", () => {
    // arrange
    const order = new LimitOrder(
      mockOrderBox("buy", { owner: bob, assets: { base: ONE_ERG, quote: 100n } }),
    );
    const transaction = new TransactionBuilder(chain.height)
      .extend(order.close()) // close the order
      .sendChangeTo(bob.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [bob] });

    // assert
    expect(contract.utxos.length).toBe(0);
    expect(success).toBe(true);
    expect(bob.balance).toEqual({ nanoergs: ONE_ERG, tokens: [sigusd(100n)] });
    expect(contract.balance).toEqual({ nanoergs: 0n, tokens: [] });
  });

  it("Should partially buy tokens", () => {
    // arrange
    const price = 5n;
    const order = new LimitOrder(
      mockOrderBox("buy", { owner: bob, assets: { quote: 100n }, price }),
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG });

    const BUY_AMOUNT = 10n; // buying 10 tokens
    const PAY_AMOUNT = BUY_AMOUNT * price; // 10 * 5 = 50 nanoergs

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(BUY_AMOUNT)) // buy
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toStrictEqual({
      nanoergs: order.box.value + PAY_AMOUNT, // contract now has 50 more nanoergs
      tokens: [
        sigusd(order.assets.quote.amount - BUY_AMOUNT), // contract now has 100 - 10 = 90 SigUSD left
      ],
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG - PAY_AMOUNT,
      tokens: [sigusd(BUY_AMOUNT)],
    });
  });

  it("Should fully buy tokens and send erg to the owner", () => {
    // arrange
    const price = 5n;
    const order = new LimitOrder(
      mockOrderBox("buy", { owner: bob, assets: { quote: 100n }, price }),
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG });
    chain.addParty(bob);

    const BUY_AMOUNT = 100n; // buying all 100 tokens
    const PAY_AMOUNT = BUY_AMOUNT * price; // 100 * 5 = 500 nanoerg

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(BUY_AMOUNT)) // buy
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    // order box must be destroyed
    expect(contract.utxos.length).toBe(0);
    expect(contract.balance).toStrictEqual({
      nanoergs: 0n,
      tokens: [],
    });

    expect(alice.utxos.length).toBe(1);
    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG - PAY_AMOUNT,
      tokens: [sigusd(BUY_AMOUNT)],
    });

    // funds must be sent to the owner
    expect(bob.utxos.length).toBe(1);
    expect(bob.balance).toStrictEqual({
      nanoergs: order.box.value + PAY_AMOUNT,
      tokens: [],
    });
  });

  it.skip("Should partially sell tokens", () => {});

  it.skip("Should fully sell tokens and send to the owner", () => {});

  it.skip("Should compose multiple orders in the same transaction", () => {});

  it.skip("Should allow operations in the child orders", () => {});

  it("Should not allow a third party to close the order", () => {
    // arrange
    const order = new LimitOrder(mockOrderBox("buy", { owner: bob }));
    const transaction = new TransactionBuilder(chain.height)
      .extend(order.close()) // trying to close the order
      .sendChangeTo(alice.address) // sending to Alice, but Bob is the owner
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(UNPROVEN_SCHNORR_ERROR);
  });

  it.skip("Should not allow buying tokens when underpaying", () => {});

  it.skip("Should not allow selling tokens when underpaying", () => {});

  it.skip("Should not allow buying when the Token ID is swapped", () => {});

  it.skip("Should not allow selling when the Token ID is swapped", () => {});

  it.skip("Should not allow changing the owner of the order", () => {});

  it.skip("Should not allow changing the price of the order", () => {});

  it.skip("Should not allow changing the order contract", () => {});

  it("Should not allow spending multiple orders to a single child output for partially filled orders", () => {
    // arrange
    const price = 5n;
    const order1 = new LimitOrder(
      mockOrderBox("buy", { owner: bob, assets: { quote: 100n }, price }),
    );
    const order2 = new LimitOrder(
      mockOrderBox("buy", { owner: bob, assets: { quote: 100n }, price }),
    );

    contract.addUTxOs(order1.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .from(alice.utxos)
      .extend(
        order1.buy(10n, (_, input) => {
          // bind both orders to the same output index 0
          input.setContextExtension({ 0: SInt(0) });
        }),
      )
      .extend(
        order2.buy(10n, (_, input) => {
          // bind both orders to the same output index 0
          input.setContextExtension({ 0: SInt(0) });
        }),
      )
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow spending multiple orders to a single child output for fully filled orders", () => {
    // arrange
    const price = 5n;
    const fullAmount = 100n;
    const order1 = new LimitOrder(
      mockOrderBox("buy", { owner: bob, assets: { quote: fullAmount }, price }),
    );
    const order2 = new LimitOrder(
      mockOrderBox("buy", { owner: bob, assets: { quote: fullAmount }, price }),
    );

    contract.addUTxOs(order1.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .from(alice.utxos)
      .extend(
        order1.buy(fullAmount, (_, input) => {
          // bind both orders to the same output index 0
          input.setContextExtension({ 0: SInt(0) });
        }),
      )
      .extend(
        order2.buy(fullAmount, (_, input) => {
          // bind both orders to the same output index 0
          input.setContextExtension({ 0: SInt(0) });
        }),
      )
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });
});
