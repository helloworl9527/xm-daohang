// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secretbox";

describe("AES-256-GCM secretbox", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("uses randomized authenticated encryption and restores plaintext", () => {
    const plaintext = "sk-sensitive-value-abcd";
    const first = encryptSecret(plaintext);
    const second = encryptSecret(plaintext);

    expect(first).not.toBe(plaintext);
    expect(first).not.toContain(plaintext);
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(plaintext);
    expect(decryptSecret(second)).toBe(plaintext);
  });

  it("fails closed for tampering, malformed payloads, and invalid keys", () => {
    const encrypted = encryptSecret("secret");
    const parts = encrypted.split(".");
    const tag = Buffer.from(parts[3], "base64url");
    tag[0] ^= 1;
    const tampered = [parts[0], parts[1], parts[2], tag.toString("base64url")].join(".");

    expect(() => decryptSecret(tampered)).toThrow("SECRET_DECRYPT_FAILED");
    expect(() => decryptSecret("not-a-secretbox")).toThrow("SECRET_FORMAT_INVALID");

    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(31).toString("base64");
    expect(() => encryptSecret("secret")).toThrow("APP_ENCRYPTION_KEY_INVALID");
  });
});
