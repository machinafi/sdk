import { TransactionBuilder } from "@fleet-sdk/core";
import { MockChain } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "vitest";

import { LimitOrder } from "../../limit-order";
import E2TScript from "../limit/e2t-limit-order.es?raw";
import { createLimitOrderMocker, ONE_ERG, sigusd, SIGUSD_TOKEN_ID } from "./utils";

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
    const PAY_AMOUNT = BUY_AMOUNT * price; // 10 * 5 = 50 ERG

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
      nanoergs: order.box.value + PAY_AMOUNT, // contract now has 50 more ERG
      tokens: [
        sigusd(order.assets.quote.amount - BUY_AMOUNT), // contract now has 100 - 10 = 90 SigUSD left
      ],
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG - PAY_AMOUNT,
      tokens: [sigusd(BUY_AMOUNT)],
    });
  });

  it.skip("Should fully buy tokens and send erg to the owner", () => {});

  it.skip("Should partially sell tokens", () => {});

  it.skip("Should fully sell tokens and send to the owner", () => {});

  it.skip("Should compose multiple orders in the same transaction", () => {});

  it.skip("Should allow operations in the child orders", () => {});

  it.skip("Should not allow a third party to close the order", () => {});

  it.skip("Should not allow buying tokens when underpaying", () => {});

  it.skip("Should not allow selling tokens when underpaying", () => {});

  it.skip("Should not allow buying when the Token ID is swapped", () => {});

  it.skip("Should not allow selling when the Token ID is swapped", () => {});

  it.skip("Should not allow changing the owner of the order", () => {});

  it.skip("Should not allow changing the price of the order", () => {});

  it.skip("Should not allow changing the order contract", () => {});

  it.skip("Should not allow spending multiple orders to a single child output", () => {});
});
