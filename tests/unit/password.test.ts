import { describe, expect, it } from "vitest";

import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "@/lib/auth/password";

describe("password policy and hashing", () => {
  it("hashes with argon2id and verifies without exposing the password", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);

    expect(hash).not.toContain(password);
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, password)).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("enforces the 12 to 128 Unicode character boundary", () => {
    expect(validatePassword("admin", "a".repeat(11))).toEqual({
      valid: false,
      code: "PASSWORD_LENGTH",
    });
    expect(validatePassword("admin", "a".repeat(12))).toEqual({ valid: true });
    expect(validatePassword("admin", "密".repeat(128))).toEqual({ valid: true });
    expect(validatePassword("admin", "密".repeat(129))).toEqual({
      valid: false,
      code: "PASSWORD_LENGTH",
    });
    expect(validatePassword("admin", "🔐".repeat(12))).toEqual({ valid: true });
  });

  it("rejects a password equal to the username", () => {
    expect(validatePassword("long-admin-name", "long-admin-name")).toEqual({
      valid: false,
      code: "PASSWORD_EQUALS_USERNAME",
    });
  });
});
