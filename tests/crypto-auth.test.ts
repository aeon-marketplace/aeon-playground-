import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashToken,
  maskSecret,
  safeEqual,
  secretAad,
} from "@/lib/crypto/secrets";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("AES-256-GCM secret storage", () => {
  it("round-trips a secret with its AAD", () => {
    const aad = secretAad("user-1", "provider", "record-1");
    const encrypted = encryptSecret("sk-test-secret-value", aad);
    expect(encrypted.ciphertext).not.toContain("sk-test-secret-value");
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(decryptSecret(encrypted, aad)).toBe("sk-test-secret-value");
  });

  it("fails when the AAD does not match the record", () => {
    const encrypted = encryptSecret("secret", secretAad("user-1", "provider", "record-1"));
    expect(() => decryptSecret(encrypted, secretAad("user-2", "provider", "record-1"))).toThrow();
    expect(() => decryptSecret(encrypted, secretAad("user-1", "custom", "record-1"))).toThrow();
  });

  it("detects ciphertext tampering", () => {
    const aad = secretAad("user-1", "provider", "record-1");
    const encrypted = encryptSecret("secret", aad);
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] = bytes[0] ^ 0xff;
    expect(() =>
      decryptSecret({ ...encrypted, ciphertext: bytes.toString("base64") }, aad),
    ).toThrow();
  });

  it("uses a fresh IV for every encryption", () => {
    const aad = secretAad("user-1", "provider", "record-1");
    const first = encryptSecret("same", aad);
    const second = encryptSecret("same", aad);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("masks secrets without revealing them", () => {
    expect(maskSecret("sk-1234567890")).toBe("••••7890");
    expect(maskSecret("abc")).toBe("••••");
    expect(maskSecret("abcd")).toBe("••••");
  });

  it("hashes session tokens with a server secret", () => {
    const token = "session-token";
    expect(hashToken(token, "secret-a")).toBe(hashToken(token, "secret-a"));
    expect(hashToken(token, "secret-a")).not.toBe(hashToken(token, "secret-b"));
    expect(hashToken(token, "secret-a")).toHaveLength(64);
  });
});

describe("safeEqual", () => {
  it("compares equal values and rejects differences", () => {
    expect(safeEqual("abcdef", "abcdef")).toBe(true);
    expect(safeEqual("abcdef", "abcdeg")).toBe(false);
    expect(safeEqual("short", "longer")).toBe(false);
  });
});

describe("scrypt password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("uses a unique salt per hash", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");
    expect(first).not.toBe(second);
    expect(await verifyPassword("same-password", first)).toBe(true);
    expect(await verifyPassword("same-password", second)).toBe(true);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("password", "not-a-hash")).toBe(false);
    expect(await verifyPassword("password", "scrypt$abc$8$1$aaaa$bbbb")).toBe(false);
    expect(await verifyPassword("password", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});
