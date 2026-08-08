// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { sessions } from "@/db/schema";
import {
  createSession,
  destroySession,
  hashSessionToken,
  validateSession,
} from "@/lib/auth/session";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Session integration tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(sessions);
});

afterAll(async () => {
  await pool.end();
});

describe("database sessions", () => {
  it("stores only a token hash and applies idle and absolute expiries", async () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    const created = await createSession({ now });
    const [stored] = await db.select().from(sessions);

    expect(created.token).not.toBe(stored.tokenHash);
    expect(stored.tokenHash).toBe(hashSessionToken(created.token));
    expect(stored.idleExpiresAt).toEqual(new Date(now.getTime() + DAY));
    expect(stored.absoluteExpiresAt).toEqual(new Date(now.getTime() + 7 * DAY));
  });

  it("rejects either idle or absolute expiry", async () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    const idleExpired = await createSession({ now });
    await expect(
      validateSession(idleExpired.token, new Date(now.getTime() + DAY)),
    ).resolves.toBeNull();

    const absoluteExpired = await createSession({ now });
    await db
      .update(sessions)
      .set({ idleExpiresAt: new Date(now.getTime() + 8 * DAY) })
      .where(eq(sessions.tokenHash, hashSessionToken(absoluteExpired.token)));
    await expect(
      validateSession(absoluteExpired.token, new Date(now.getTime() + 7 * DAY)),
    ).resolves.toBeNull();
  });

  it("refreshes monotonically without crossing the absolute expiry", async () => {
    const now = new Date("2026-08-09T00:00:00.000Z");
    const created = await createSession({ now });
    const late = new Date(now.getTime() + 23 * HOUR);
    const early = new Date(now.getTime() + 12 * HOUR);

    const [lateResult, earlyResult] = await Promise.all([
      validateSession(created.token, late),
      validateSession(created.token, early),
    ]);
    const [stored] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(created.token)));

    expect(lateResult).not.toBeNull();
    expect(earlyResult).not.toBeNull();
    expect(stored.lastSeenAt).toEqual(late);
    expect(stored.idleExpiresAt).toEqual(new Date(late.getTime() + DAY));

    await db
      .update(sessions)
      .set({ idleExpiresAt: stored.absoluteExpiresAt })
      .where(eq(sessions.tokenHash, hashSessionToken(created.token)));
    const nearAbsolute = new Date(now.getTime() + 6 * DAY + 23 * HOUR);
    await expect(validateSession(created.token, nearAbsolute)).resolves.toMatchObject({
      idleExpiresAt: stored.absoluteExpiresAt,
      absoluteExpiresAt: stored.absoluteExpiresAt,
    });
  });

  it("invalidates a destroyed session", async () => {
    const created = await createSession();

    await expect(destroySession(created.token)).resolves.toBe(true);
    await expect(validateSession(created.token)).resolves.toBeNull();
  });
});
