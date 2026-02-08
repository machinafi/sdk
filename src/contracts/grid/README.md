# Auto-Compounding Two-Way Grid Order Contracts

## Overview

These are auto-compounding two-way grid order contracts for ERG to TOKEN (`E2T`) and TOKEN to TOKEN (`T2T`). The contracts allow users to create grid orders for simultaneously buying and selling tokens at predefined prices.

## Key Features

- **Two-way trading:** Simultaneous buy and sell orders at grid-defined prices.
- **Auto-compounding:** All available ERG and TOKEN balances are traded for optimal compounding.
- **Owner withdrawal:** The owner can close the order and withdraw assets at any time.
- **Composable:** Multiple orders can be used in the same transaction.

## Contracts Logic

Both contracts share the same logic

- **Trading:**
  - Extract context variables to determine action and output.
  - Ensure contract state and token IDs are preserved.
  - Ensure that outputs are bound to parent inputs to prevent **input aggregation attacks**.
  - For **Buy**:
    - Validate if the **base** assets received from the user are enough to cover the requested **quote** assets at the predefined **buy** price.
  - For **Sell**:
    - Validate if the **quote** assets received from the user are enough to cover the requested **base** assets at the predefined **sell** price.

- **Close Order:**
  - Only the owner (as set in `R4`) can close the order and withdraw assets.

## Contracts Parameters

### Registers & Context Variables

| Register         | Purpose                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `R4: SigmaProp`  | Owner’s `SigmaProp` script (defines who can close/withdraw)               |
| `R5: Coll[Long]` | `[buy, sell]` prices in nanoergs per token unit                           |
| `R6: Coll[Byte]` | Spent `Input ID` (prevents spending multiple orders with a single output) |

| Context Variable | Purpose                              |
| ---------------- | ------------------------------------ |
| `0: Boolean`     | Action: `true` = Buy, `false` = Sell |
| `1: Int`         | Recreated output index               |

### Tokens

Tokens structure differs between `E2T` and `T2T` contracts.

#### ERG to Token (`E2T`)

| Index | Purpose                   |
| ----- | ------------------------- |
| `0`   | Quote token, can be empty |

#### Token to Token (`T2T`)

| Index | Purpose                                    |
| ----- | ------------------------------------------ |
| `0`   | Base token, must contain at least one unit |
| `1`   | Quote token, can be empty                  |

## Unit Tests

Contracts unit tests ensure the correctness of the actions and are located at the [../tests/](/src/contracts/tests/) directory.

### Running Tests

```bash
# install dependencies
pnpm install

# run contract unit tests
pnpm test:unit grid-order
```
