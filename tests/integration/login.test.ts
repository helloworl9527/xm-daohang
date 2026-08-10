// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { adminUser, loginAttempts, sessions } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { requireAdminApi } from "@/lib/auth/guard";
import { hashLoginIp, isLockedOut } from "@/lib/auth/loginThrottle";
import { loginWithCredentials } from "@/app/admin/login/actions";

const TEST_IP = "203.0.113.42";

beforeAll(async () => {
  process.env.LOGIN_IP_HASH_KEY = "login-test-key-with-at-least-32-bytes";
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Login integration tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(loginAttempts);
  await db.delete(adminUser);
  await db.insert(adminUser).values({
    username: "admin",
    passwordHash: await hashPassword("correct-password-123"),
  });
});

afterAll(async () => {
  await pool.end();
});

describe("admin login", () => {
  it("creates a session and restricted cookie for correct credentials", async () => {
    const result = await loginWithCredentials({
      username: "admin",
      password: "correct-password-123",
      ip: TEST_IP,
    });

    expect(result).toMatchObject({
      ok: true,
      cookie: {
        name: "admin_session",
        options: { httpOnly: true, secure: true, sameSite: "lax", path: "/admin" },
      },
    });
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it("permits the session cookie on local HTTP only in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      const result = await loginWithCredentials({
        username: "admin",
        password: "correct-password-123",
        ip: TEST_IP,
      });

      expect(result).toMatchObject({
        ok: true,
        cookie: { options: { httpOnly: true, secure: false, sameSite: "lax", path: "/admin" } },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("records only an HMAC IP and creates no session for invalid credentials", async () => {
    const result = await loginWithCredentials({
      username: "admin",
      password: "wrong-password-value",
      ip: TEST_IP,
    });
    const attempts = await db.select().from(loginAttempts);

    expect(result).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].ipHash).toBe(hashLoginIp(TEST_IP));
    expect(JSON.stringify(attempts)).not.toContain(TEST_IP);
  });

  it("locks after five consecutive failures", async () => {
    const now = new Date("2026-08-09T01:00:00.000Z");
    for (let count = 0; count < 5; count += 1) {
      await loginWithCredentials({
        username: "admin",
        password: "wrong-password-value",
        ip: TEST_IP,
        now: new Date(now.getTime() + count),
      });
    }

    const afterFailures = new Date(now.getTime() + 5);
    await expect(isLockedOut(hashLoginIp(TEST_IP), afterFailures)).resolves.toMatchObject({
      locked: true,
    });
    await expect(
      loginWithCredentials({
        username: "admin",
        password: "correct-password-123",
        ip: TEST_IP,
        now: afterFailures,
      }),
    ).resolves.toMatchObject({ ok: false, code: "LOCKED" });
  });

  it("returns 401 for anonymous API requests and accepts a valid session", async () => {
    const anonymous = await requireAdminApi(new Request("https://example.com/admin/api/items"));
    expect(anonymous).toBeInstanceOf(Response);
    expect((anonymous as Response).status).toBe(401);
    await expect((anonymous as Response).json()).resolves.toEqual({
      error: { code: "AUTH_REQUIRED", message: "需要登录管理端。", retryable: false },
    });

    const login = await loginWithCredentials({
      username: "admin",
      password: "correct-password-123",
      ip: TEST_IP,
    });
    if (!login.ok) throw new Error("login fixture failed");
    const authenticated = await requireAdminApi(
      new Request("https://example.com/admin/api/items", {
        headers: { cookie: `${login.cookie.name}=${login.cookie.value}` },
      }),
    );
    expect(authenticated).not.toBeInstanceOf(Response);
  });
});
