import { ErgoTree } from "@fleet-sdk/core";
import { hex } from "@fleet-sdk/crypto";

// placeholder identifiers for base and quote tokens in contracts
const TOKEN_ID_PLACEHOLDERS = {
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

  new(tokenId: string): string {
    return this.proposition.replace(this.#quotePlaceholder.id, tokenId);
  }

  getQuoteTokenId(proposition: string): string {
    return proposition.substring(this.#quotePlaceholder.index, this.#quotePlaceholder.index + 64);
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

  new(baseTokenId: string, quoteTokenId: string): string {
    return this.proposition
      .replace(this.#basePlaceholder.id, baseTokenId)
      .replace(this.#quotePlaceholder.id, quoteTokenId);
  }

  getBaseTokenId(proposition: string): string {
    return proposition.substring(this.#basePlaceholder.index, this.#basePlaceholder.index + 64);
  }

  getQuoteTokenId(proposition: string): string {
    return proposition.substring(this.#quotePlaceholder.index, this.#quotePlaceholder.index + 64);
  }
}
