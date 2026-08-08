import argon2 from "argon2";

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

export type PasswordValidation =
  | { valid: true }
  | { valid: false; code: "PASSWORD_LENGTH" | "PASSWORD_EQUALS_USERNAME" };

export function validatePassword(username: string, password: string): PasswordValidation {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    return { valid: false, code: "PASSWORD_LENGTH" };
  }
  if (password === username) {
    return { valid: false, code: "PASSWORD_EQUALS_USERNAME" };
  }
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
