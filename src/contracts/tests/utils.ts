import type { Box, TokenAmount } from "@fleet-sdk/common";

import { compile } from "@fleet-sdk/compiler";
import { type R4ToR5Registers, type R4ToR6Registers, SAFE_MIN_BOX_VALUE } from "@fleet-sdk/core";
import { type KeyedMockChainParty, mockUTxO } from "@fleet-sdk/mock-chain";

import type { PriceRange } from "../../types";

import { GridOrder } from "../../grid-order";
import { LimitOrder, type LimitOrderType } from "../../limit-order";
import { QUOTE_TOKEN_ID_PLACEHOLDER } from "../../order-contract";

type Token = TokenAmount<bigint>;

interface GridOrderParams {
  owner: KeyedMockChainParty;
  assets?: { base?: bigint; quote?: bigint };
  prices?: PriceRange;
}

interface LimitOrderParams {
  owner: KeyedMockChainParty;
  assets?: { base?: bigint; quote?: bigint };
  price?: bigint;
}

export const SIGUSD_TOKEN_ID = "fbbaac7337d051c10fc3da0ccb864f4d32d40027551e1c3ea3ce361f39b91e40";
export const RSN_TOKEN_ID = "8b08cdd5449a9592a9e79711d7d79249d7a03c535d17efaee83e216e80a44c4b";
export const FAKE_TOKEN_ID = "fb96947d14ab7006d0aaf90383934278517d7b6e300ad4b7cbbd13cfc3e4ca69";
export const ONE_ERG = 1_000_000_000n; // 1 erg = 1 billion nanoergs

export const REDUCED_TO_FALSE_ERROR = "Script reduced to false";
export const UNPROVEN_SCHNORR_ERROR = "Tree root should be real but was UnprovenSchnorr";

export const sigusd = (amount: bigint): Token => ({ tokenId: SIGUSD_TOKEN_ID, amount });
export const rsn = (amount: bigint): Token => ({ tokenId: RSN_TOKEN_ID, amount });
export const fakeToken = (amount: bigint): Token => ({ tokenId: FAKE_TOKEN_ID, amount });

function compileScriptIfRequired(script: string): string | undefined {
  if (process.env.RECOMPILE !== "true") return undefined;

  const tree = compile(script).toHex();

  console.info("Recompiled script:");
  console.info(tree);
  console.info();

  return tree;
}

export function createGridOrderMocker(script: string, baseId: string, quoteId: string) {
  const newTree = compileScriptIfRequired(script)?.replace(QUOTE_TOKEN_ID_PLACEHOLDER, quoteId);

  return (p: GridOrderParams): Box<bigint, R4ToR5Registers> => {
    const candidate = GridOrder.create({
      assets: !p.assets
        ? {
            base: { tokenId: baseId, amount: SAFE_MIN_BOX_VALUE },
            quote: { tokenId: quoteId, amount: 0n },
          }
        : {
            base: { tokenId: baseId, amount: p.assets?.base ?? 0n },
            quote: { tokenId: quoteId, amount: p.assets?.quote ?? 0n },
          },
      prices: p.prices ?? { buy: 1n, sell: 1n },
      owner: p.owner.address,
    })
      .setCreationHeight(1)
      .build();

    return mockUTxO({
      ...candidate,
      ergoTree: newTree ?? candidate.ergoTree,
    }) as Box<bigint, R4ToR5Registers>;
  };
}

export function createLimitOrderMocker(script: string, baseId: string, quoteId: string) {
  const newTree = compileScriptIfRequired(script)?.replace(QUOTE_TOKEN_ID_PLACEHOLDER, quoteId);

  return (t: LimitOrderType, p: LimitOrderParams): Box<bigint, R4ToR6Registers> => {
    const candidate = LimitOrder.create({
      assets: !p.assets
        ? t === "buy"
          ? {
              base: { tokenId: baseId, amount: 0n },
              quote: { tokenId: quoteId, amount: 10n },
            }
          : {
              base: { tokenId: baseId, amount: SAFE_MIN_BOX_VALUE },
              quote: { tokenId: quoteId, amount: 0n },
            }
        : {
            base: { tokenId: baseId, amount: p.assets?.base ?? 0n },
            quote: { tokenId: quoteId, amount: p.assets?.quote ?? 0n },
          },
      price: p.price ?? 1n,
      type: t,
      owner: p.owner.address,
    })
      .setCreationHeight(1)
      .build();

    return mockUTxO({
      ...candidate,
      ergoTree: newTree ?? candidate.ergoTree,
    }) as Box<bigint, R4ToR6Registers>;
  };
}
