// @vitest-environment node

import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  initializeAdmin,
  readCredentialFile,
  resetAdminPassword,
} from "../../scripts/admin-credentials";
import { verifyPassword } from "@/lib/auth/password";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString });

describe("host-only administrator initialization and recovery", () => {
  beforeEach(async () => {
    await pool.query("delete from sessions; delete from admin_user");
  });
  afterAll(async () => pool.end());

  it("initializes once with a strong password and is idempotent", async () => {
    await expect(initializeAdmin("admin", "initial-password-123", pool)).resolves.toBe("created");
    await expect(initializeAdmin("admin", "ignored-password-456", pool)).resolves.toBe("existing");
    const result = await pool.query<{ username: string; password_hash: string }>("select username, password_hash from admin_user");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.username).toBe("admin");
    await expect(verifyPassword(result.rows[0]!.password_hash, "initial-password-123")).resolves.toBe(true);
  });

  it("rejects weak initialization without writing a row", async () => {
    await expect(initializeAdmin("admin", "short", pool)).rejects.toThrow("PASSWORD_LENGTH");
    await expect(pool.query("select 1 from admin_user")).resolves.toMatchObject({ rowCount: 0 });
  });

  it("resets only the matching administrator and revokes every session atomically", async () => {
    await initializeAdmin("admin", "initial-password-123", pool);
    await pool.query(
      `insert into sessions (token_hash, idle_expires_at, absolute_expires_at)
       values ('one', now() + interval '1 day', now() + interval '7 days'),
              ('two', now() + interval '1 day', now() + interval '7 days')`,
    );
    await expect(resetAdminPassword("other", "replacement-password-456", pool)).rejects.toThrow("ADMIN_NOT_FOUND");
    await expect(resetAdminPassword("admin", "short", pool)).rejects.toThrow("PASSWORD_LENGTH");
    expect((await pool.query("select 1 from sessions")).rowCount).toBe(2);

    await expect(resetAdminPassword("admin", "replacement-password-456", pool)).resolves.toBeUndefined();
    const result = await pool.query<{ password_hash: string }>("select password_hash from admin_user where username = 'admin'");
    await expect(verifyPassword(result.rows[0]!.password_hash, "replacement-password-456")).resolves.toBe(true);
    await expect(verifyPassword(result.rows[0]!.password_hash, "initial-password-123")).resolves.toBe(false);
    expect((await pool.query("select 1 from sessions")).rowCount).toBe(0);
  });

  it("rolls back the hash when session revocation fails", async () => {
    await initializeAdmin("admin", "initial-password-123", pool);
    const before = await pool.query<{ password_hash: string }>("select password_hash from admin_user");
    const client = await pool.connect();
    try {
      await client.query(`create or replace function pg_temp.reject_session_delete() returns trigger language plpgsql as $$ begin raise exception 'blocked'; end $$`);
      await client.query("create trigger reject_session_delete before delete on sessions for each statement execute function pg_temp.reject_session_delete()");
      const sameConnection = {
        query: client.query.bind(client),
        connect: async () => ({ ...client, query: client.query.bind(client), release: () => undefined }),
      };
      await expect(resetAdminPassword("admin", "replacement-password-456", sameConnection as never)).rejects.toThrow();
      const after = await client.query<{ password_hash: string }>("select password_hash from admin_user");
      expect(after.rows[0]?.password_hash).toBe(before.rows[0]?.password_hash);
      await client.query("drop trigger reject_session_delete on sessions");
    } finally {
      client.release();
    }
  });

  it("accepts only a permission-0600 credential file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "collection-admin-"));
    const file = path.join(directory, "password");
    await writeFile(file, "file-password-123\n", { mode: 0o600 });
    await expect(readCredentialFile(file)).resolves.toBe("file-password-123");
    await chmod(file, 0o644);
    await expect(readCredentialFile(file)).rejects.toThrow("CREDENTIAL_FILE_MODE");
  });
});
