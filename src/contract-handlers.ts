import { ErgoTree } from "@fleet-sdk/core";
import { hex } from "@fleet-sdk/crypto";
import type { AssetId } from "./types";

const ID_LENGTH = 64;

export type ContractType = "E2T" | "T2T";

// placeholder identifiers for base and quote tokens in contracts
export const TOKEN_ID_PLACEHOLDERS = {
  base: "ba5e7acc110ee6374fe8fa7cd1e9ea4847e44dae4876d865cdffa61b4bdee03b",
  quote: "cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e"
};

type BasePlaceholderId = typeof TOKEN_ID_PLACEHOLDERS.base;
type QuotePlaceholderId = typeof TOKEN_ID_PLACEHOLDERS.quote;

export type PlaceHolderId = BasePlaceholderId | QuotePlaceholderId;
export interface PlaceHolder<T extends PlaceHolderId> {
  id: T;
  index: number;
}

abstract class ContractHandler {
  readonly proposition: string;
  readonly template: string;

  constructor(proposition: string) {
    this.proposition = proposition;
    this.template = hex.encode(new ErgoTree(proposition).template);
  }

  abstract get type(): ContractType;

  abstract getBaseId(proposition: string): AssetId;
  abstract getQuoteId(proposition: string): AssetId;

  validate(proposition: string): boolean {
    return proposition?.length === this.proposition.length && proposition.endsWith(this.template);
  }
}

export class E2TOrderContract extends ContractHandler {
  readonly #quotePlaceholder: PlaceHolder<QuotePlaceholderId>;

  constructor(proposition: string) {
    super(proposition);

    const placeholder = TOKEN_ID_PLACEHOLDERS.quote;
    this.#quotePlaceholder = { id: placeholder, index: proposition.indexOf(placeholder) };
  }

  get type(): ContractType {
    return "E2T";
  }

  new(tokenId: string): string {
    return this.proposition.replace(this.#quotePlaceholder.id, tokenId);
  }

  getBaseId(): AssetId {
    return "ERG";
  }

  getQuoteId(proposition: string): string {
    const index = this.#quotePlaceholder.index;
    return proposition.substring(index, index + ID_LENGTH);
  }
}

export class T2TOrderContract extends ContractHandler {
  readonly #basePlaceholder: PlaceHolder<BasePlaceholderId>;
  readonly #quotePlaceholder: PlaceHolder<QuotePlaceholderId>;

  constructor(proposition: string) {
    super(proposition);

    const basePlaceholder = TOKEN_ID_PLACEHOLDERS.base;
    const quotePlaceholder = TOKEN_ID_PLACEHOLDERS.quote;

    this.#basePlaceholder = { id: basePlaceholder, index: proposition.indexOf(basePlaceholder) };
    this.#quotePlaceholder = { id: quotePlaceholder, index: proposition.indexOf(quotePlaceholder) };
  }

  get type(): ContractType {
    return "T2T";
  }

  new(baseTokenId: string, quoteTokenId: string): string {
    return this.proposition
      .replace(this.#basePlaceholder.id, baseTokenId)
      .replace(this.#quotePlaceholder.id, quoteTokenId);
  }

  getBaseId(proposition: string): string {
    const index = this.#basePlaceholder.index;
    return proposition.substring(index, index + ID_LENGTH);
  }

  getQuoteId(proposition: string): string {
    const index = this.#quotePlaceholder.index;
    return proposition.substring(index, index + ID_LENGTH);
  }
}
