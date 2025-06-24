import {
  ErgoUnsignedInput,
  OutputBuilder,
  SAFE_MIN_BOX_VALUE,
  SBool,
  SColl,
  SGroupElement,
  SInt,
  SLong,
  SSigmaProp,
  TransactionBuilder,
  type R4ToR5Registers
} from "@fleet-sdk/core";
import { MockChain } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "vitest";
import type { Amount, Box } from "@fleet-sdk/common";
import { GridOrder } from "../../grid-order";
import {
  createGridOrderMocker,
  FAKE_TOKEN_ID,
  fakeToken,
  ONE_ERG,
  REDUCED_TO_FALSE_ERROR,
  sigusd,
  SIGUSD_TOKEN_ID,
  UNPROVEN_SCHNORR_ERROR,
  RSN_TOKEN_ID,
  rsn
} from "./utils";
import T2TScript from "../grid/t2t-grid-order.es?raw";

/**
 * This test suite covers the Token <-> Token grid order contract.
 * It includes tests for auto-compounding, buying, selling, and closing orders.
 */
describe("Grid order | token <-> token | auto-compound", () => {
  // T2T contract is implicitly selected if ERG is not the base asset.
  const mockOrderBox = createGridOrderMocker(T2TScript, SIGUSD_TOKEN_ID, RSN_TOKEN_ID);

  const chain = new MockChain();
  const bob = chain.newParty("Bob");
  const alice = chain.newParty("Alice");
  const contract = chain.addParty(mockOrderBox({ owner: bob }).ergoTree, "Grid contract");

  afterEach(() => chain.reset({ clearParties: true }));

  it("Should close the order and withdrawal funds", () => {
    // arrange
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { base: 200n, quote: 100n } }));

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.close()) // close the order
      .sendChangeTo(bob.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [bob] });

    // assert
    expect(contract.utxos.length).toBe(0);
    expect(success).toBe(true);
    expect(bob.balance).toEqual({ nanoergs: order.box.value, tokens: [sigusd(200n), rsn(100n)] });
    expect(contract.balance).toEqual({ nanoergs: 0n, tokens: [] });
  });

  it("Should partially buy quote tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { base: 200n, quote: 100n }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n)] }); // Alice has 100 susd tokens

    const BUY_AMOUNT = 10n; // buying 10 RSN
    const PAY_AMOUNT = BUY_AMOUNT * prices.buy; // 10 * 5 = 50 SigUSD

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
      nanoergs: order.box.value, // erg value remains the same
      tokens: [
        sigusd(order.assets.base.amount + PAY_AMOUNT), // contract now has 100 + 50 = 150 SigUSD
        rsn(order.assets.quote.amount - BUY_AMOUNT) // contract now has 200 - 10 = 190 RSN left
      ]
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG,
      tokens: [sigusd(100n - PAY_AMOUNT), rsn(BUY_AMOUNT)]
    });
  });

  it("Should fully buy quote tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { base: 200n, quote: 100n }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(10000n)] }); // Alice has 10000 SigUSD tokens

    const BUY_AMOUNT = order.assets.quote.amount; // buying all available RSN tokens
    const PAY_AMOUNT = BUY_AMOUNT * prices.buy; // 100 * 5 = 500 SigUSD

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(BUY_AMOUNT)) // buy all tokens
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toStrictEqual({
      nanoergs: order.box.value, // ERG value remains the same
      tokens: [sigusd(order.assets.base.amount + PAY_AMOUNT)] // contract now has 200 + 500 = 700 SigUSD, and 0 RSN left
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG, // Alice's ERG balance remains the same
      tokens: [sigusd(10000n - PAY_AMOUNT), rsn(BUY_AMOUNT)] // Alice has 10000 - 500 = 9500 SigUSD and 100 RSN
    });
  });

  it("Should partially sell quote tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { base: 1000n, quote: 200n }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [rsn(100n)], nanoergs: ONE_ERG }); // Alice has 100 tokens to sell

    const SELL_AMOUNT = 10n; // selling 10 RSN
    const RECEIVING_AMOUNT = SELL_AMOUNT * prices.sell; // 10 * 10 = 100 SigUSD

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
      nanoergs: order.box.value,
      tokens: [
        sigusd(order.assets.base.amount - RECEIVING_AMOUNT),
        rsn(order.assets.quote.amount + SELL_AMOUNT)
      ]
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG,
      tokens: [sigusd(RECEIVING_AMOUNT), rsn(100n - SELL_AMOUNT)]
    });
  });

  it("Should fully sell quote tokens", () => {
    // arrange
    const prices = { buy: 5n, sell: 11n };
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { base: 100n, quote: 200n }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [rsn(1000n)] });

    const SELL_AMOUNT = 9n;
    const RECEIVING_AMOUNT = SELL_AMOUNT * prices.sell; // 9 * 11 = 99 SigUSD, one token must be left in the order

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
      nanoergs: order.box.value,
      tokens: [sigusd(1n), rsn(order.assets.quote.amount + SELL_AMOUNT)] // contract now has 100 tokens from alice
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG,
      tokens: [sigusd(RECEIVING_AMOUNT), rsn(1000n - SELL_AMOUNT)]
    });
  });

  it("Should compose multiple orders in the same transaction", () => {
    // arrange
    const orderA = new GridOrder(
      mockOrderBox({
        owner: bob,
        assets: { base: 3000n, quote: 5000n },
        prices: { buy: 5n, sell: 10n }
      })
    );

    const orderB = new GridOrder(
      mockOrderBox({
        owner: bob,
        assets: { base: 200n, quote: 1000n },
        prices: { buy: 7n, sell: 12n }
      })
    );

    contract.addUTxOs(orderA.box).addUTxOs(orderB.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(10000n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(orderA.buy(100n)) // buy tokens
      .extend(orderB.buy(5n)) // buy more tokens
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    const PAY_AMOUNT = 100n * orderA.price.buy + 5n * orderB.price.buy;
    expect(contract.utxos.length).toBe(2);
    expect(contract.balance).toStrictEqual({
      nanoergs: orderA.box.value + orderB.box.value,
      tokens: [
        sigusd(orderA.assets.base.amount + orderB.assets.base.amount + PAY_AMOUNT),
        rsn(orderA.assets.quote.amount + orderB.assets.quote.amount - (100n + 5n))
      ]
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG,
      tokens: [sigusd(10000n - PAY_AMOUNT), rsn(105n)]
    });
  });

  it("Should allow operations in the child orders", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const fatherOrder = new GridOrder(
      mockOrderBox({ owner: bob, assets: { quote: 100n, base: 200n }, prices })
    );

    contract.addUTxOs(fatherOrder.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), rsn(100n)] });
    bob.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), rsn(100n)] });

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
      .extend(childOrder2.buy(2n))
      .from(bob.utxos)
      .sendChangeTo(bob.address)
      .build();

    expect(() => chain.execute(childBuyTx, { signers: [bob] })).not.toThrow();

    // assert close
    const childOrder3 = new GridOrder(
      childBuyTx.outputs.at(0)?.toPlainObject("EIP-12") as Box<Amount, R4ToR5Registers>
    );
    const childCloseTx = new TransactionBuilder(chain.height)
      .extend(childOrder3.close())
      .from(bob.utxos)
      .sendChangeTo(bob.address)
      .build();

    expect(() => chain.execute(childCloseTx, { signers: [bob] })).not.toThrow();
  });

  it("Should not allow a third party to close the order", () => {
    // arrange
    const order = new GridOrder(mockOrderBox({ owner: bob }));
    const transaction = new TransactionBuilder(chain.height)
      .extend(order.close()) // trying to close the order
      .sendChangeTo(alice.address) // sending change to Alice, but Bob is the owner
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(UNPROVEN_SCHNORR_ERROR);
  });

  it.skip("Should not allow buying tokens when underpaying", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { quote: 100n }, prices }));

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

  it.skip("Should not allow selling tokens when underpaying", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { base: ONE_ERG }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(10n, (output) => output.addTokens(sigusd(-1n)))) // tries to sell 10 tokens but only sends 9
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    expect(transaction.outputs[0]?.assets[0]?.amount).toBe(9n); // should have 9 tokens instead of 10

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it.skip("Should not allow buying when the Token ID is swapped", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { quote: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

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

  it.skip("Should not allow selling when the Token ID is swapped", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { base: ONE_ERG }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(100n)] });

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

  it.skip("Should not allow changing the owner of the order", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { quote: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        order.buy(10n, (output) =>
          // trying to change the owner of the order form Bob to Alice
          output.setAdditionalRegisters({ R4: SSigmaProp(SGroupElement(alice.key.publicKey)) })
        )
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it.skip("Should not allow changing the prices of the order", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { quote: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        order.buy(10n, (output) =>
          // trying to change the prices of the order
          output.setAdditionalRegisters({ R5: SColl(SLong, [1n, 1n]) })
        )
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow changing the order contract", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { base: 1n, quote: 100n }, prices })
    );

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(10n))
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // @ts-expect-error
    transaction.outputs[0].ergoTree = alice.ergoTree; // trying to change the contract of the order

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it.skip("Should not allow spending multiple orders to a single child output", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order1 = new GridOrder(mockOrderBox({ owner: bob, assets: { quote: 100n }, prices }));
    const order2 = new GridOrder(mockOrderBox({ owner: bob, assets: { quote: 100n }, prices }));

    contract.addUTxOs(order1.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .from(alice.utxos)
      .from(
        // set index of the child output to 0, which will be the same as order1
        new ErgoUnsignedInput(order2.box).setContextExtension({ 0: SBool(true), 1: SInt(0) }),
        { ensureInclusion: true }
      )
      .extend(
        // attempt to buy tokens but maliciously replace the token ID
        order1.buy(10n)
      )
      .to(new OutputBuilder(SAFE_MIN_BOX_VALUE, alice.address).addTokens(sigusd(10n))) // trying to create a new box to alice with the stolen tokens from order2
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // @ts-expect-error
    transaction.outputs[0].ergoTree = alice.ergoTree; // trying to change the contract of the order

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });
});
