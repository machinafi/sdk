import { describe, expect, it } from "vitest";

import { OrderContract, QUOTE_TOKEN_ID_PLACEHOLDER } from "../order-contract";

// E2T limit order proposition with placeholder token id
const E2T_LIMIT_PROPOSITION =
  "1a9d02080e20cafe05e06b54b00eb0067c7c5e900c4d394030f4ac2e351f873a28f6158ced6e05000400040005000580897a05000500d806d601e30004d6027300d603860272027301d604e4c6a70601d605e4c6a70408d606e4c6a7050595e67201d804d607b2a5e4720100d608b2db630872077302017203d6098c720802d60a8cb2db6308a7730301720302d1ed95957204917209730492c172077305ededededed93c27207c2a7938c720801720293e4c672070408720593e4c672070505720693e4c672070601720493e4c67207070ec5a7ed93c27207d0720593e4c67207040ec5a7957204d801d60b99c17207c1a7ed91720b730692720b9c99720a72097206d801d60b997209720aed91720b7307929c720b720699c1a7c172077205";

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
