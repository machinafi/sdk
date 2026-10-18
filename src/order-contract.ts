import { ErgoTree } from "@fleet-sdk/core";
import { hex } from "@fleet-sdk/crypto";

const ID_LENGTH = 64;
const TOKEN_ID_PATTERN = /^[0-9a-f]{64}$/i;
export const QUOTE_TOKEN_ID_PLACEHOLDER =
  "cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e" as const;

type QuotePlaceholderId = typeof QUOTE_TOKEN_ID_PLACEHOLDER;
export type ContractType = "E2T" | "T2T";

export interface PlaceHolder<T extends string> {
  id: T;
  index: number;
}

export class OrderContract {
  readonly #quotePlaceholder: PlaceHolder<QuotePlaceholderId>;

  readonly proposition: string;
  readonly template: string;
  readonly type: ContractType;

  constructor(proposition: string, type: ContractType) {
    this.proposition = proposition;
    this.template = hex.encode(new ErgoTree(proposition).template);
    this.type = type;

    const placeholder = QUOTE_TOKEN_ID_PLACEHOLDER;
    this.#quotePlaceholder = { id: placeholder, index: proposition.indexOf(placeholder) };
  }

  new(quoteTokenId: string): string {
    if (!TOKEN_ID_PATTERN.test(quoteTokenId)) throw Error("Invalid quote token ID");
    return this.proposition.replace(this.#quotePlaceholder.id, quoteTokenId);
  }

  getQuoteId(proposition: string): string {
    const index = this.#quotePlaceholder.index;
    return proposition.substring(index, index + ID_LENGTH);
  }

  validate(proposition: string): boolean {
    if (proposition?.length !== this.proposition.length) return false;

    // without a quote placeholder, there's nothing to substitute: the tree must match exactly
    if (this.#quotePlaceholder.index === -1) return proposition === this.proposition;

    const quoteId = this.getQuoteId(proposition);
    return TOKEN_ID_PATTERN.test(quoteId) && proposition === this.new(quoteId);
  }
}
