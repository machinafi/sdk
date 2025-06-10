import { compile } from "@fleet-sdk/compiler";
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
  const mockOrderBox = createOrderMocker(tree, SIGUSD_TOKEN_ID);

  const chain = new MockChain();
  const bob = chain.newParty("Bob");
  const alice = chain.newParty("Alice");
  const contract = chain.addParty(mockOrderBox({ owner: bob }).ergoTree, "Grid contract");

  afterEach(() => chain.reset({ clearParties: true }));

  it("Should close the order and withdrawal funds", () => {
    // arrange
    const order = new GridOrder(
      mockOrderBox({ owner: bob, assets: { nanoergs: ONE_ERG, tokens: 100n } })
    );

    const transaction = new TransactionBuilder(chain.height)
      .extend(order.close()) // close the order
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
        prices
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

  it("Should compose multiple orders in the same transaction", () => {
    // arrange
    const orderA = new GridOrder(
      mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices: { buy: 5n, sell: 10n } })
    );

    const orderB = new GridOrder(
      mockOrderBox({ owner: bob, assets: { tokens: 10n }, prices: { buy: 7n, sell: 12n } })
    );

    contract.addUTxOs(orderA.box).addUTxOs(orderB.box);
    alice.addBalance({ nanoergs: ONE_ERG });
    const PAY_AMOUNT = 100n * orderA.price.buy + 5n * orderB.price.buy;

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

    expect(contract.utxos.length).toBe(2);
    expect(contract.balance).toStrictEqual({
      nanoergs: orderA.box.value + orderB.box.value + PAY_AMOUNT, // contract now has 1_000_000_000 + 500 = 1_000_000_500 nanoergs
      tokens: [sigUsd(5n)] // no tokens left in the order
    });

    // alice now has 105 tokens, 100 from orderA and 5 from orderB
    expect(alice.balance).toStrictEqual({ nanoergs: ONE_ERG - PAY_AMOUNT, tokens: [sigUsd(105n)] });
  });

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

  it("Should not allow changing the owner of the order", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n), fakeToken(200n)] });

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

  it("Should not allow changing the prices of the order", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n), fakeToken(200n)] });

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
    const order = new GridOrder(mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices }));

    contract.addUTxOs(order.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n), fakeToken(200n)] });

    const transaction = new TransactionBuilder(chain.height)
      .extend(
        // attempt to buy tokens but maliciously replace the token ID
        order.buy(10n)
      )
      .from(alice.utxos)
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // @ts-expect-error
    transaction.outputs[0].ergoTree = alice.ergoTree; // trying to change the contract of the order

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });

  it("Should not allow spending multiple orders to a single child output", () => {
    // arrange
    const prices = { buy: 5n, sell: 10n };
    const order1 = new GridOrder(mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices }));
    const order2 = new GridOrder(mockOrderBox({ owner: bob, assets: { tokens: 100n }, prices }));

    contract.addUTxOs(order1.box);
    alice.addBalance({ nanoergs: ONE_ERG, tokens: [sigUsd(100n), fakeToken(200n)] });

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
      .to(new OutputBuilder(SAFE_MIN_BOX_VALUE, alice.address).addTokens(sigUsd(10n))) // trying to create a new box to alice with the stolen tokens from order2
      .sendChangeTo(alice.address)
      .build()
      .toEIP12Object();

    // @ts-expect-error
    transaction.outputs[0].ergoTree = alice.ergoTree; // trying to change the contract of the order

    // act
    expect(() => chain.execute(transaction, { signers: [alice] })).toThrow(REDUCED_TO_FALSE_ERROR);
  });
});

interface OrderParams {
  owner: KeyedMockChainParty;
  assets?: { nanoergs?: bigint; tokens?: bigint };
  prices?: PriceRange;
  max?: PriceRange;
}

function createOrderMocker(ergoTree: string | undefined, tokenId: string) {
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
