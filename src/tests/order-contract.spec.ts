import { describe, expect, it } from "vitest";

import { OrderContract, QUOTE_TOKEN_ID_PLACEHOLDER } from "../order-contract";

// E2T limit order proposition with placeholder token id
const E2T_LIMIT_PROPOSITION =
  "1aa702080e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e05000400040005000580897a05000500d804d601e30004d6027300d603860272027301d604e4c6a7040895e67201d807d605e4c6a70601d606b2a5e4720100d607b2db630872067302017203d6088c720702d6098c720701d60ae4c6a70505d60b8cb2db6308a7730301720302d1ed95957205917208730492c172067305ededededed93c27206c2a7937209720293e4c672060408720493e4c672060505720a93e4c672060601720593e4c67206070ec5a7eded93c27206d07204937209720293e4c67206040ec5a7957205d801d60c99c17206c1a7ed91720c730692720c9c99720b7208720ad801d60c997208720bed91720c7307929c720c720a99c1a7c172067204";

const SOME_TOKEN_ID = "a" + "0".repeat(63); // 64-char hex token ID

describe("OrderContract", () => {
  const contract = new OrderContract(E2T_LIMIT_PROPOSITION, "E2T");

  describe("new", () => {
    it("replaces the placeholder with the given token ID", () => {
      const result = contract.new(SOME_TOKEN_ID);
      expect(result).toContain(SOME_TOKEN_ID);
      expect(result).not.toContain(QUOTE_TOKEN_ID_PLACEHOLDER);
    });

    it("preserves the rest of the proposition", () => {
      const result = contract.new(SOME_TOKEN_ID);
      expect(result.length).toBe(E2T_LIMIT_PROPOSITION.length);
    });
  });

  describe("getQuoteId", () => {
    it("extracts the placeholder from the original proposition", () => {
      expect(contract.getQuoteId(E2T_LIMIT_PROPOSITION)).toBe(QUOTE_TOKEN_ID_PLACEHOLDER);
    });

    it("extracts a substituted token ID from a generated proposition", () => {
      const proposition = contract.new(SOME_TOKEN_ID);
      expect(contract.getQuoteId(proposition)).toBe(SOME_TOKEN_ID);
    });
  });

  describe("validate", () => {
    it("validates the original proposition", () => {
      expect(contract.validate(E2T_LIMIT_PROPOSITION)).toBe(true);
    });

    it("validates a proposition with a different token ID", () => {
      const proposition = contract.new(SOME_TOKEN_ID);
      expect(contract.validate(proposition)).toBe(true);
    });

    it("rejects an empty string", () => {
      expect(contract.validate("")).toBe(false);
    });

    it("rejects a short random string", () => {
      expect(contract.validate("deadbeef")).toBe(false);
    });

    it("rejects a proposition of the correct length but wrong template", () => {
      const wrongProposition = "ff".repeat(E2T_LIMIT_PROPOSITION.length / 2);
      expect(contract.validate(wrongProposition)).toBe(false);
    });

    it("rejects a proposition from a different contract", () => {
      const otherContract = new OrderContract(
        "1af401080e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e0500040004000500040005000402d804d601e30104d6027300d603860272027301d604e4c6a7040895e67201d805d605b2a5e4720100d606b2db630872057302017203d607e4c6a70511d6088cb2db6308a7730301720302d6098c720602d1ededededed93c27205c2a7938c720601720293e4c672050408720493e4c672050511720793e4c67205060ec5a795e4e30001d801d60a99c17205c1a7ed91720a730492720a9c9972087209b27207730500d801d60a9972097208ed91720a7306929c720ab2720773070099c1a7c172057204",
        "E2T",
      );
      expect(contract.validate(otherContract.proposition)).toBe(false);
    });
  });

  describe("type", () => {
    it("stores the contract type", () => {
      expect(contract.type).toBe("E2T");
      expect(new OrderContract("0000", "T2T").type).toBe("T2T");
    });
  });
});
