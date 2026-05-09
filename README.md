# @nautls/machinafi-sdk

`@nautls/machinafi-sdk` works as a **Fleet SDK plugin layer** for Machina orders contracts: create order boxes with `GridOrder.create(...)` / `LimitOrder.create(...)`, then compose actions in `TransactionBuilder` with `order.buy(...)`, `order.sell(...)`, and `order.close()`.

- First-class Fleet SDK integration via `.extend(...)` API
- Composable order actions: create, fill (buy/sell), and close orders in the same transaction
- 100% test coverage

## Supported contracts

- Grid T2T (token <-> token): [`src/contracts/grid/t2t-grid-order.es`](src/contracts/grid/t2t-grid-order.es)
- Grid E2T (ergo <-> token): [`src/contracts/grid/e2t-grid-order.es`](src/contracts/grid/e2t-grid-order.es)
- Limit E2T (ergo <-> token): [`src/contracts/limit/e2t-limit-order.es`](src/contracts/limit/e2t-limit-order.es)

## Installation

```bash
# npm
npm install @nautls/machinafi-sdk@0.1.0-alpha.0

# yarn
yarn add @nautls/machinafi-sdk@0.1.0-alpha.0

# pnpm
pnpm add @nautls/machinafi-sdk@0.1.0-alpha.0
```

## Grid orders operations

### 1. Creating an order

```ts
import { TransactionBuilder } from "@fleet-sdk/core";
import { GridOrder } from "@machinafi/sdk";

const tx = new TransactionBuilder(height)
  .from(ownerInputs) // spend owner boxes to fund the new order
  .to(
    GridOrder.create({
      owner: ownerAddress, // owner allowed to close the order later
      assets: {
        base: { tokenId: "ERG", amount: 1_000_000_000n },
        quote: {
          tokenId: "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40",
          amount: 100n,
        },
      },
      prices: { buy: 10n, sell: 5n }, // takers pay 10n ERG/token to buy, receive 5n ERG/token when selling
    }),
  )
  .sendChangeTo(ownerAddress) // return leftovers to owner
  .build();
```

For Grid T2T, keep the same flow and use token ids for both `base` and `quote`.

### 2. Filling a buy order

```ts
const order = new GridOrder(orderBox);

const tx = new TransactionBuilder(height)
  .extend(order.buy(10n)) // plugin adds order input/output for a buy fill
  .from(takerInputs)
  .sendChangeTo(takerAddress)
  .build();
```

### 3. Filling a sell order

```ts
const order = new GridOrder(orderBox);

const tx = new TransactionBuilder(height)
  .extend(order.sell(10n)) // plugin adds order input/output for a sell fill
  .from(takerInputs)
  .sendChangeTo(takerAddress)
  .build();
```

### 4. Closing an order

```ts
const order = new GridOrder(orderBox);

const tx = new TransactionBuilder(height)
  .extend(order.close()) // owner reclaims order funds
  .from(ownerInputs) // needed to cover the transaction fee
  .sendChangeTo(ownerAddress)
  .build();
```

## Limit orders operations

> [!WARNING]
> Only E2T (ergo <-> token) limit orders are currently supported. T2T (token <-> token) is not yet implemented and will throw at runtime.

### 1. Creating an order

```ts
import { TransactionBuilder } from "@fleet-sdk/core";
import { LimitOrder } from "@machinafi/sdk";

const buyOrderTx = new TransactionBuilder(height)
  .from(ownerInputs) // owner funds the order box
  .to(
    LimitOrder.create({
      owner: ownerAddress,
      type: "buy", // this order can be filled with order.buy(...)
      assets: {
        base: { tokenId: "ERG", amount: 0n }, // optional, sdk uses min box value
        quote: {
          tokenId: "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40",
          amount: 100n, // quote liquidity offered by this buy order
        },
      },
      price: 5n, // price per quote unit
    }),
  )
  .sendChangeTo(ownerAddress)
  .build();

const sellOrderTx = new TransactionBuilder(height)
  .from(ownerInputs)
  .to(
    LimitOrder.create({
      owner: ownerAddress,
      type: "sell", // this order can be filled with order.sell(...)
      assets: {
        base: { tokenId: "ERG", amount: 1_000_000_000n }, // base liquidity offered by this sell order
        quote: {
          tokenId: "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40",
          amount: 0n,
        },
      },
      price: 10n, // payout price per quote unit sold by takers
    }),
  )
  .sendChangeTo(ownerAddress)
  .build();
```

### 2. Filling a buy order

> [!NOTE]
> `order.buy()` can only be called on a `"buy"`-type order; calling it on a `"sell"`-type order (or vice versa) throws at runtime.

```ts
const order = new LimitOrder(buyOrderBox);

const tx = new TransactionBuilder(height)
  .extend(order.buy(10n)) // fill a buy-type limit order
  .from(takerInputs)
  .sendChangeTo(takerAddress)
  .build();
```

### 3. Filling a sell order

```ts
const order = new LimitOrder(sellOrderBox);

const tx = new TransactionBuilder(height)
  .extend(order.sell(10n)) // fill a sell-type limit order
  .from(takerInputs)
  .sendChangeTo(takerAddress)
  .build();
```

### 4. Closing an order

```ts
const order = new LimitOrder(orderBox);

const tx = new TransactionBuilder(height)
  .extend(order.close()) // owner closes and withdraws order funds
  .from(ownerInputs) // needed to cover the transaction fee
  .sendChangeTo(ownerAddress)
  .build();
```

## Combining multiple orders

You can compose multiple order actions in one transaction:

```ts
const tx = new TransactionBuilder(height)
  .extend(gridOrder.buy(100n)) // first plugin action
  .extend(limitOrder.buy(5n)) // second plugin action in same tx
  .from(takerInputs)
  .sendChangeTo(takerAddress)
  .build();
```
