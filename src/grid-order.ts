import {
  ensureUTxOBigInt,
  first,
  type Amount,
  type Box,
  type BoxCandidate
} from "@fleet-sdk/common";
import {
  SBool,
  SByte,
  SColl,
  SConstant,
  SGroupElement,
  SInt,
  SLong,
  SSigmaProp
} from "@fleet-sdk/serializer";
import {
  type ErgoAddress,
  estimateMinBoxValue,
  OutputBuilder,
  type FleetPlugin,
  ErgoUnsignedInput,
  ErgoTree,
  type R4ToR5Registers
} from "@fleet-sdk/core";
import type {
  ActionHandler,
  Assets,
  BuyOrder,
  ExchangeableAssets,
  PriceRange,
  SellOrder
} from "./types";

export const ERG_TOKEN_CONTRACT =
  "1a95020e040004000400050004000e20000000000000000000000000000000000000000000000000000000000000000001010500040005000400040005000402d802d601e30104d602e4c6a7040895e67201d806d603b2a5e4720100d604db63087203d60591b172047300d606e4c6a70511d607db6308a7d6089591b1720773018cb27207730200027303d1ededededed93c27203c2a7957205938cb27204730400017305730693e4c672030408720293e4c672030511720693e4c67203060ec5a795e4e30001d801d60999c17203c1a7ed91720973079272099c9972089572058cb27204730800027309b27206730a00d801d609998cb27204730b00027208ed917209730c929c7209b27206730d0099c1a7c172037202";
const ERG_TOKEN_TEMPLATE =
  "d802d601e30104d602e4c6a7040895e67201d806d603b2a5e4720100d604db63087203d60591b172047300d606e4c6a70511d607db6308a7d6089591b1720773018cb27207730200027303d1ededededed93c27203c2a7957205938cb27204730400017305730693e4c672030408720293e4c672030511720693e4c67203060ec5a795e4e30001d801d60999c17203c1a7ed91720973079272099c9972089572058cb27204730800027309b27206730a00d801d609998cb27204730b00027208ed917209730c929c7209b27206730d0099c1a7c172037202";

export class GridOrder implements BuyOrder<PriceRange>, SellOrder<PriceRange> {
  readonly #box: Box<bigint, R4ToR5Registers>;

  readonly #price: PriceRange;
  readonly #assets: Assets;

  constructor(box: Box<Amount, R4ToR5Registers> | BoxCandidate<Amount, R4ToR5Registers>) {
    if (!validateErgoTree(box.ergoTree)) throw new Error("Invalid Grid Order contract");

    const quoteTokenId = box.ergoTree.substring(32, 32 + 64);
    if (!validateToken(quoteTokenId, box, 0)) throw new Error("Invalid token for the contract");

    const prices = SConstant.from<[bigint, bigint]>(box.additionalRegisters.R5);
    if (prices.type.toString() !== "SColl[SLong]") throw new Error("Invalid order box");

    this.#price = { buy: prices.data[0], sell: prices.data[1] };
    this.#box = ensureUTxOBigInt(box) as Box<bigint, R4ToR5Registers>;
    this.#assets = {
      base: { tokenId: "nanoerg", amount: this.#box.value },
      quote: { tokenId: quoteTokenId, amount: this.#box.assets[0]?.amount ?? 0n }
    };
  }

  get price(): PriceRange {
    return this.#price;
  }

  get box(): Box<bigint, R4ToR5Registers> {
    return this.#box;
  }

  get assets(): Assets {
    return this.#assets;
  }

  close(): FleetPlugin {
    return ({ addInputs }) => addInputs(this.#box);
  }

  /**
   * Buys tokens with nanoergs at the price specified in the order.
   * @param amount - The amount of token units to buy.
   */
  buy(amount: bigint, hander?: ActionHandler): FleetPlugin {
    if (amount <= 0n) throw new Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const requiredNanoergs = amount * this.#price.buy;

      const input = new ErgoUnsignedInput(box);
      const output = OutputBuilder.from(box)
        .setValue(box.value + requiredNanoergs)
        .addTokens({ tokenId: this.assets.quote.tokenId, amount: amount * -1n }) // fleet will deduct the amount from the existing tokens
        .setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }); // bind the output to the input box

      const outputsLength = addOutputs(output);
      addInputs(
        input.setContextExtension({
          0: SBool(true), // action, true == buy
          1: SInt(outputsLength - 1) // index of the child output
        })
      );

      if (hander) hander(output, input);
    };
  }

  /**
   * Sell tokens for nanoergs at the price specified in the order.
   * @param amount - The amount of token units to sell.
   */
  sell(amount: bigint, hander?: ActionHandler): FleetPlugin {
    if (amount <= 0n) throw new Error("Amount must be greater than zero");

    return ({ addInputs, addOutputs }) => {
      const box = this.#box;
      const nanoergsPayout = amount * this.#price.sell;

      const input = new ErgoUnsignedInput(box);
      const output = OutputBuilder.from(box)
        .setValue(box.value - nanoergsPayout)
        .addTokens({ tokenId: this.assets.quote.tokenId, amount }) // fleet will sum the amount to the existing tokens
        .setAdditionalRegisters({ R6: SColl(SByte, box.boxId) }); // bind the output to the input box

      const outputsLength = addOutputs(output);
      addInputs(
        input.setContextExtension({
          0: SBool(false), // action, false == sell
          1: SInt(outputsLength - 1) // index of the child output
        })
      );

      if (hander) hander(output, input);
    };
  }

  static create(options: GridOrderCreationParams): OutputBuilder {
    if (!options.assets?.nanoerg && !options.assets?.token.amount) {
      throw new Error("At least one of base or target assets must be specified");
    }

    if (!options.prices.buy || !options.prices.sell) {
      throw new Error("Prices must be specified for both buy and sell");
    }

    const tokenId = SColl(SByte, options.assets.token.tokenId);
    const contract = new ErgoTree(ERG_TOKEN_CONTRACT).replaceConstant(5, tokenId);

    return new OutputBuilder(options.assets.nanoerg || estimateMinBoxValue(), contract)
      .addTokens(options.assets.token)
      .setAdditionalRegisters({
        R4: SSigmaProp(SGroupElement(first(options.owner.getPublicKeys()))),
        R5: SColl(SLong, [options.prices.buy, options.prices.sell])
      });
  }
}

function validateErgoTree(ergoTree: string): boolean {
  return ergoTree?.length === ERG_TOKEN_CONTRACT.length && ergoTree.endsWith(ERG_TOKEN_TEMPLATE);
}

function validateToken(tokenId: string, box: BoxCandidate<Amount>, index: number): boolean {
  const token = box.assets[index];
  return !token || token.tokenId === tokenId;
}

export interface ErgTokenAmounts {
  nanoerg?: bigint;
  token?: bigint;
}

export interface GridOrderCreationParams {
  owner: ErgoAddress;
  assets: ExchangeableAssets;
  prices: PriceRange;
  max?: PriceRange;
}
