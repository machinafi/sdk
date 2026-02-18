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
  rsn,
  RSN_TOKEN_ID,
  sigusd,
  SIGUSD_TOKEN_ID,
  UNPROVEN_SCHNORR_ERROR,
} from "../../tests/utils";
import T2TScript from "./t2t-limit-order.es?raw";

/**
 * This test suite covers the Token <-> Token limit order contract.
 */
describe("Limit order | token <-> token", () => {
  // T2T contract is implicitly selected if two tokens are provided
  const mockLimitOrder = createLimitOrderMocker(T2TScript, SIGUSD_TOKEN_ID, RSN_TOKEN_ID);

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
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n } });
    const transaction = new TransactionBuilder(chain.height)
      .extend(order.close()) // close the order
      .sendChangeTo(bob.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [bob] });

    // assert
    expect(contract.utxos.length).toBe(0);
    expect(success).toBe(true);
    expect(bob.balance).toEqual({ nanoergs: order.box.value, tokens: [sigusd(1n), rsn(100n)] });
    expect(contract.balance).toEqual({ nanoergs: 0n, tokens: [] });
  });

  it("Should partially buy tokens", () => {
    // arrange
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(100n)] });

    const BUY_AMOUNT = 10n; // buying 10 RSN
    const PAY_AMOUNT = BUY_AMOUNT * price; // 10 * 5 = 50 SigUSD

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
    expect(contract.balance).toMatchObject({
      tokens: [
        sigusd(order.assets.base.amount + PAY_AMOUNT),
        rsn(order.assets.quote.amount - BUY_AMOUNT),
      ],
    });

    expect(alice.balance).toMatchObject({
      tokens: [sigusd(50n), rsn(BUY_AMOUNT)], // alice has 50 SigUSD left after buying, and received 10 RSN
    });
  });

  it("Should fully buy tokens and send base tokens to the owner", () => {
    // arrange
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(1000n)] }); // Alice has SigUSD (base) to pay with
    chain.addParty(bob);

    const BUY_AMOUNT = 100n; // buying all 100 RSN (quote) tokens
    const PAY_AMOUNT = BUY_AMOUNT * price; // 100 * 5 = 500 SigUSD (base tokens)

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
    expect(alice.balance).toMatchObject({
      tokens: [sigusd(1000n - PAY_AMOUNT), rsn(BUY_AMOUNT)], // alice paid SigUSD, received RSN
    });

    // base tokens must be sent to the owner
    expect(bob.utxos.length).toBe(1);
    expect(bob.balance).toMatchObject({
      nanoergs: order.box.value,
      tokens: [sigusd(order.assets.base.amount + PAY_AMOUNT)], // original base + accumulated payment
    });
  });

  it("Should partially sell tokens, when contract has no quote tokens", () => {
    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", {
      owner: bob,
      assets: { base: 1000n, quote: 0n },
      price,
    });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [rsn(100n)], nanoergs: ONE_ERG }); // Alice has 100 RSN (quote) to sell

    const SELL_AMOUNT = 10n; // selling 10 RSN (quote tokens)
    const PAY_AMOUNT = SELL_AMOUNT * price; // 10 * 10 = 100 SigUSD (base tokens)

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(SELL_AMOUNT)) // sell 10 RSN
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toMatchObject({
      nanoergs: order.box.value, // nanoergs unchanged in T2T
      tokens: [sigusd(1000n - PAY_AMOUNT), rsn(SELL_AMOUNT)], // contract paid out base, received quote
    });

    expect(alice.balance).toMatchObject({
      tokens: [sigusd(PAY_AMOUNT), rsn(90n)], // alice received SigUSD payout, has 90 RSN left
    });
  });

  it("Should partially sell tokens, when contract has quote tokens", () => {
    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", {
      owner: bob,
      assets: { base: 1000n, quote: 5n },
      price,
    });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [rsn(100n)], nanoergs: ONE_ERG }); // Alice has 100 RSN (quote) to sell

    const SELL_AMOUNT = 10n; // selling 10 RSN (quote tokens)
    const PAY_AMOUNT = SELL_AMOUNT * price; // 10 * 10 = 100 SigUSD (base tokens)

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(SELL_AMOUNT)) // sell 10 RSN
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toMatchObject({
      nanoergs: order.box.value, // nanoergs unchanged in T2T
      tokens: [sigusd(1000n - PAY_AMOUNT), rsn(SELL_AMOUNT + 5n)], // contract paid out base, received quote (10 from alice + 5 existing)
    });

    expect(alice.balance).toMatchObject({
      tokens: [sigusd(PAY_AMOUNT), rsn(90n)], // alice received SigUSD payout, has 90 RSN left
    });
  });

  it("Should fully sell tokens and send to the owner", () => {
    // Note: at least 1 base token must remain in the order box after a
    // sell to avoid token misplacement.

    // arrange
    const price = 1n;
    const order = mockLimitOrder("sell", {
      owner: bob,
      assets: { base: 10n },
      price,
    });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [rsn(1000n)] }); // Alice has tokens to sell
    chain.addParty(bob);

    const SELL_AMOUNT = 9n; // selling 9 RSN (quote tokens), leaving 1 RSN in the contract
    const PAY_AMOUNT = SELL_AMOUNT * price; // 9 * 1 = 9 SigUSD (base tokens)

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
      nanoergs: ONE_ERG,
      tokens: [sigusd(9n), rsn(991n)], // alice received 9 SigUSD, has 991 RSN left
    });

    // funds must be sent to the owner
    expect(bob.utxos.length).toBe(1);
    expect(bob.balance).toMatchObject({
      tokens: [sigusd(1n), rsn(9n)], // bob receives the 9 RSN sold by Alice, plus the 1 RSN that remained in the contract, and has no SigUSD left
    });
  });

  it("Should not allow stealing base tokens when partially filling a sell order", () => {
    // In T2T, the contract enforces childBox.value == SELF.value for partial fills

    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", { owner: bob, assets: { base: 10000n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [rsn(1000n)] }); // Alice has RSN (quote) to sell
    chain.addParty(bob);

    const SELL_AMOUNT = 999n;

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        order.sell(SELL_AMOUNT, (output) =>
          output.addTokens({ tokenId: order.assets.base.tokenId, amount: -1n }),
        ),
      ) // trying to steal 1 SigUSD from the contract
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should compose multiple orders in the same transaction", () => {
    // arrange
    const orderA = mockLimitOrder("buy", {
      owner: bob,
      assets: { base: 1n, quote: 100n },
      price: 5n,
    });
    const orderB = mockLimitOrder("buy", {
      owner: bob,
      assets: { base: 1n, quote: 10n },
      price: 7n,
    });

    contract.addUTxOs(orderA.box).addUTxOs(orderB.box);
    alice.addBalance({ tokens: [sigusd(1000n)] }); // Alice has SigUSD (base) to pay with
    chain.addParty(bob);
    const PAY_AMOUNT = 100n * orderA.price + 5n * orderB.price; // 500 + 35 = 535 SigUSD

    const transaction = new TransactionBuilder(chain.height)
      .extend(orderA.buy(100n)) // buy all RSN from orderA (full fill)
      .extend(orderB.buy(5n)) // buy 5 RSN from orderB (partial fill)
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    const success = chain.execute(transaction, { signers: [alice] });

    // assert
    expect(success).toBe(true);

    // orderA is fully fulfilled (bought all 100 RSN), orderB is partially filled
    expect(contract.utxos.length).toBe(1);
    expect(contract.balance).toMatchObject({
      tokens: [sigusd(orderB.assets.base.amount + 5n * orderB.price), rsn(5n)], // orderB: base + payment, 5 RSN left
    });

    // alice now has 105 RSN, 100 from orderA and 5 from orderB
    expect(alice.balance).toMatchObject({
      tokens: [sigusd(1000n - PAY_AMOUNT), rsn(105n)],
    });

    // bob should have received the base tokens from the fully fulfilled orderA
    expect(bob.utxos.length).toBe(1);
    expect(bob.balance).toMatchObject({
      nanoergs: orderA.box.value,
      tokens: [sigusd(orderA.assets.base.amount + 100n * orderA.price)],
    });
  });

  it("Should allow operations in the child orders", () => {
    // arrange
    const price = 10n;
    const fatherOrder = mockLimitOrder("buy", {
      owner: bob,
      assets: { base: 1n, quote: 100n },
      price,
    });

    contract.addUTxOs(fatherOrder.box);
    alice.addBalance({ tokens: [sigusd(1000n)] }); // Alice pays with SigUSD (base)
    bob.addBalance({ tokens: [sigusd(1000n)] }); // Bob also pays with SigUSD (base)

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
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 10n } });
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
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(1000n)] }); // Alice pays with SigUSD (base)

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.buy(10n, (output) => output.addTokens(sigusd(-1n)))) // trying to pay 1 less SigUSD (base token)
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow selling tokens when underpaying", () => {
    // arrange
    const price = 10n;
    const order = mockLimitOrder("sell", { owner: bob, assets: { base: 1000n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [rsn(100n)] }); // Alice sells RSN (quote)

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.sell(10n, (output) => output.addTokens(rsn(-1n)))) // tries to sell 10 RSN but only sends 9
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build();

    expect(transaction.outputs[0]?.assets[1]?.amount).toBe(9n); // should have 9 RSN instead of 10

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow buying when the Token ID is swapped", () => {
    // arrange
    const price = 5n;
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(1000n), fakeToken(200n)] }); // Alice pays with SigUSD (base)

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        // attempt to buy tokens but maliciously replace the base token ID
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
    const order = mockLimitOrder("sell", { owner: bob, assets: { base: 1000n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [rsn(100n), fakeToken(1000n)] }); // Alice sells RSN (quote)

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        // attempt to sell tokens but maliciously replace the base token ID
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
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(1000n), fakeToken(200n)] }); // Alice pays with SigUSD (base)

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
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(1000n), fakeToken(200n)] }); // Alice pays with SigUSD (base)

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
    const order = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order.box);
    alice.addBalance({ tokens: [sigusd(1000n), fakeToken(200n)] }); // Alice pays with SigUSD (base)

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
    const order1 = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });
    const order2 = mockLimitOrder("buy", { owner: bob, assets: { base: 1n, quote: 100n }, price });

    contract.addUTxOs(order1.box);
    alice.addBalance({ tokens: [sigusd(1000n), fakeToken(200n)] }); // Alice pays with SigUSD (base)

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

    const order1 = mockLimitOrder("buy", {
      owner: bob,
      assets: { base: 1n, quote: fullAmount },
      price,
    });
    const order2 = mockLimitOrder("buy", {
      owner: bob,
      assets: { base: 1n, quote: fullAmount },
      price,
    });

    contract.addUTxOs(order1.box);
    alice.addBalance({ tokens: [sigusd(2000n), fakeToken(200n)] }); // Alice pays with SigUSD (base)

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
