import type { Amount, Box } from "@fleet-sdk/common";

import {
  SGroupElement,
  SInt,
  SLong,
  SSigmaProp,
  TransactionBuilder,
  type R4ToR6Registers,
} from "@fleet-sdk/core";
import { MockChain } from "@fleet-sdk/mock-chain";
import { afterEach, describe, expect, it } from "vitest";

import { LimitOrder } from "../../limit-order";
import {
  createLimitOrderMocker,
  FAKE_TOKEN_ID,
  fakeToken,
  ONE_ERG,
  REDUCED_TO_FALSE_ERROR,
  sigusd,
  SIGUSD_TOKEN_ID,
  UNPROVEN_SCHNORR_ERROR,
} from "../../tests/utils";
import E2TScript from "./e2t-limit-order.es?raw";

/**
 * This test suite covers the ERG <-> Token limit order contract.
 */
describe("Limit order | erg <-> token", () => {
  // E2T contract is implicitly selected if ERG is the base asset.
  const mockLimitOrder = createLimitOrderMocker(E2TScript, "ERG", SIGUSD_TOKEN_ID);

  const chain = new MockChain();
  const bob = chain.newParty("Bob");
  const alice = chain.newParty("Alice");
  const contract = chain.addParty(
    mockLimitOrder("buy", { owner: bob }).box.ergoTree,
    "Limit contract",
  );

  afterEach(() => chain.reset({ clearParties: true }));

  it("Should close the order and withdrawal funds", () => {
    // arrange
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: ONE_ERG, quote: 100n } });
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
    const order = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

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
    const order = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

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

  it("Should partially sell tokens, when contract has no quote tokens", () => {
    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", {
      owner: bob,
      assets: { base: ONE_ERG, quote: 0n },
      price,
    });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(100n)], nanoergs: ONE_ERG }); // Alice has 100 tokens to sell

    const SELL_AMOUNT = 10n; // selling 10 tokens
    const PAY_AMOUNT = SELL_AMOUNT * price; // 10 * 10 = 100 nanoergs

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
      nanoergs: order.box.value - PAY_AMOUNT, // contract now has 100 less nanoergs
      tokens: [sigusd(SELL_AMOUNT)], // contract now has 10 tokens from alice
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG + PAY_AMOUNT,
      tokens: [sigusd(90n)], // alice has 90 tokens left after selling 10
    });
  });

  it("Should partially sell tokens, when contract has quote tokens", () => {
    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", {
      owner: bob,
      assets: { base: ONE_ERG, quote: 5n },
      price,
    });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(100n)], nanoergs: ONE_ERG }); // Alice has 100 tokens to sell

    const SELL_AMOUNT = 10n; // selling 10 tokens
    const PAY_AMOUNT = SELL_AMOUNT * price; // 10 * 10 = 100 nanoergs

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
      nanoergs: order.box.value - PAY_AMOUNT, // contract now has 100 less nanoergs
      tokens: [sigusd(SELL_AMOUNT + 5n)], // contract now has 10 tokens from alice, and 5 from before
    });

    expect(alice.balance).toStrictEqual({
      nanoergs: ONE_ERG + PAY_AMOUNT,
      tokens: [sigusd(90n)], // alice has 90 tokens left after selling 10
    });
  });

  it("Should fully sell tokens and send to the owner", () => {
    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", { owner: bob, assets: { base: 10000n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(1000n)] }); // Alice has tokens to sell
    chain.addParty(bob);

    const SELL_AMOUNT = 999n; // selling enough tokens to nearly deplete ERG in the contract
    const PAY_AMOUNT = SELL_AMOUNT * price; // 999 * 10 = 9990 nanoergs

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(SELL_AMOUNT))
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
      nanoergs: ONE_ERG + PAY_AMOUNT,
      tokens: [sigusd(1n)], // alice has 1 token left after selling 999
    });

    // funds must be sent to the owner
    expect(bob.utxos.length).toBe(1);
    expect(bob.balance).toStrictEqual({
      nanoergs: 10n, // minimal ERG left (10000 - 9990)
      tokens: [sigusd(SELL_AMOUNT)], // bob gets the 1000 tokens
    });
  });

  it("Should compose multiple orders in the same transaction", () => {
    // arrange
    const orderA = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price: 5n });
    const orderB = mockLimitOrder("buy", { owner: bob, assets: { quote: 10n }, price: 7n });

    contract.addUTxOs(orderA.box).addUTxOs(orderB.box);
    alice.addBalance({ nanoergs: ONE_ERG });
    chain.addParty(bob);
    const PAY_AMOUNT = 100n * orderA.price + 5n * orderB.price;

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

    // orderA is fully fulfilled (bought all 100 tokens), orderB is partially filled
    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toStrictEqual({
      nanoergs: orderB.box.value + 5n * orderB.price,
      tokens: [sigusd(5n)], // 5 tokens left in orderB
    });

    // alice now has 105 tokens, 100 from orderA and 5 from orderB
    expect(alice.balance).toStrictEqual({ nanoergs: ONE_ERG - PAY_AMOUNT, tokens: [sigusd(105n)] });

    // bob should have received the ERG from the fully fulfilled orderA
    expect(bob.utxos.length).toBe(1);
    expect(bob.balance).toStrictEqual({
      nanoergs: orderA.box.value + 100n * orderA.price,
      tokens: [],
    });
  });

  it("Should allow operations in the child orders", () => {
    // arrange
    const price = 10n;
    const fatherOrder = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

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

    // assert another buy on the child order
    const childOrder1 = new LimitOrder(
      fatherTx.outputs.at(0)?.toPlainObject("EIP-12") as Box<Amount, R4ToR6Registers>,
    );
    const childBuyTx = new TransactionBuilder(chain.height)
      .extend(childOrder1.buy(10n))
      .from(bob.utxos)
      .sendChangeTo(bob.address)
      .build();

    expect(() => chain.execute(childBuyTx, { signers: [bob] })).not.toThrow();

    // assert close
    const childOrder2 = new LimitOrder(
      childBuyTx.outputs.at(0)?.toPlainObject("EIP-12") as Box<Amount, R4ToR6Registers>,
    );
    const childCloseTx = new TransactionBuilder(chain.height)
      .extend(childOrder2.close())
      .from(bob.utxos)
      .sendChangeTo(bob.address)
      .build();

    expect(() => chain.execute(childCloseTx, { signers: [bob] })).not.toThrow();
  });

  it("Should not allow a third party to close the order", () => {
    // arrange
    const order = mockLimitOrder("buy", { owner: bob });
    const transaction = new TransactionBuilder(chain.height)
      .extend(order.close()) // trying to close the order
      .sendChangeTo(alice.address) // sending to Alice, but Bob is the owner
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(UNPROVEN_SCHNORR_ERROR);
  });

  it("Should not allow buying tokens when underpaying", () => {
    // arrange
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

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
    const price = 10n;
    const order = mockLimitOrder("sell", { owner: bob, assets: { base: ONE_ERG }, price });

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

  it("Should not allow buying when the Token ID is swapped", () => {
    // arrange
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        // attempt to buy tokens but maliciously replace the token ID
        order.buy(10n, (output) => output.eject((x) => (x.tokens.at(0).tokenId = FAKE_TOKEN_ID))),
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow selling when the Token ID is swapped", () => {
    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", { owner: bob, assets: { base: ONE_ERG }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(100n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        // attempt to sell tokens but maliciously replace the token ID
        order.sell(10n, (output) => output.eject((x) => (x.tokens.at(0).tokenId = FAKE_TOKEN_ID))),
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow changing the owner of the order", () => {
    // arrange
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        order.buy(10n, (output) =>
          // trying to change the owner of the order from Bob to Alice
          output.setAdditionalRegisters({ R4: SSigmaProp(SGroupElement(alice.key.publicKey)) }),
        ),
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow changing the price of the order", () => {
    // arrange
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigusd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        order.buy(10n, (output) =>
          // trying to change the price of the order
          output.setAdditionalRegisters({ R5: SLong(1n) }),
        ),
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
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

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

  it("Should not allow spending multiple orders to a single child output for partially filled orders", () => {
    // arrange
    const price = 5n;
    const order1 = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });
    const order2 = mockLimitOrder("buy", { owner: bob, assets: { quote: 100n }, price });

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

    const order1 = mockLimitOrder("buy", { owner: bob, assets: { quote: fullAmount }, price });
    const order2 = mockLimitOrder("buy", { owner: bob, assets: { quote: fullAmount }, price });

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
