import { describe, it, expect } from "bun:test";
import { generateRefreshToken, hashToken } from "../../src/utils/token";

describe("token utilities", () => {
  describe("generateRefreshToken", () => {
    it("returns a 43-character base64url string", () => {
      const token = generateRefreshToken();
      expect(token).toBeTypeOf("string");
      expect(token.length).toBe(43);
      // base64url uses A-Z, a-z, 0-9, -, _
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("generates different tokens on each call", () => {
      const token1 = generateRefreshToken();
      const token2 = generateRefreshToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("hashToken", () => {
    it("returns a 64-character hex string", async () => {
      const hash = await hashToken("test-token");
      expect(hash).toBeTypeOf("string");
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it("produces same hash for same input", async () => {
      const input = "consistent-input";
      const hash1 = await hashToken(input);
      const hash2 = await hashToken(input);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", async () => {
      const hash1 = await hashToken("input-1");
      const hash2 = await hashToken("input-2");
      expect(hash1).not.toBe(hash2);
    });
  });
});