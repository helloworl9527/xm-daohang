import { stat, readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

import { hashPassword, validatePassword } from "../src/lib/auth/password.ts";
import { logger } from "../src/lib/log/logger.ts";

type TransactionPool = Pick<Pool, "connect" | "query">;

function requireCredential(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}_REQUIRED`);
  return normalized;
}

function assertStrongPassword(username: string, password: string): void {
  const validation = validatePassword(username, password);
  if (!validation.valid) throw new Error(validation.code);
}

export async function initializeAdmin(
  usernameInput: string,
  passwordInput: string,
  queryable: Pick<Pool, "query">,
): Promise<"created" | "existing"> {
  const username = requireCredential("USERNAME", usernameInput);
  const password = requireCredential("PASSWORD", passwordInput);
  assertStrongPassword(username, password);
  const existing = await queryable.query<{ username: string }>("select username from admin_user where id = 1");
  if (existing.rows[0]) {
    if (existing.rows[0].username !== username) throw new Error("ADMIN_ALREADY_INITIALIZED");
    return "existing";
  }
  const passwordHash = await hashPassword(password);
  const inserted = await queryable.query(
    `insert into admin_user (id, username, password_hash) values (1, $1, $2)
     on conflict (id) do nothing`,
    [username, passwordHash],
  );
  if (inserted.rowCount === 0) {
    const raced = await queryable.query<{ username: string }>("select username from admin_user where id = 1");
    if (raced.rows[0]?.username !== username) throw new Error("ADMIN_ALREADY_INITIALIZED");
    return "existing";
  }
  return "created";
}

async function withTransaction<T>(pool: TransactionPool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function resetAdminPassword(
  usernameInput: string,
  passwordInput: string,
  pool: TransactionPool,
): Promise<void> {
  const username = requireCredential("USERNAME", usernameInput);
  const password = requireCredential("PASSWORD", passwordInput);
  assertStrongPassword(username, password);
  try {
    const passwordHash = await hashPassword(password);
    await withTransaction(pool, async (client) => {
      const updated = await client.query(
        "update admin_user set password_hash = $1 where id = 1 and username = $2",
        [passwordHash, username],
      );
      if (updated.rowCount !== 1) throw new Error("ADMIN_NOT_FOUND");
      await client.query("delete from sessions");
    });
    logger.info("admin_password_reset", { ok: true });
  } catch (error) {
    logger.warn("admin_password_reset", { ok: false });
    throw error;
  }
}

export async function readCredentialFile(file: string): Promise<string> {
  const metadata = await stat(file);
  if ((metadata.mode & 0o777) !== 0o600) throw new Error("CREDENTIAL_FILE_MODE");
  return requireCredential("CREDENTIAL", await readFile(file, "utf8"));
}
