// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getLocale, PUT as putLocale } from "@/app/admin/api/settings/locale/route";
import { GET as getRateLimit, PUT as putRateLimit } from "@/app/admin/api/settings/rate-limit/route";
import { GET as getRefetch, PUT as putRefetch } from "@/app/admin/api/settings/refetch/route";
import { PUT as putSecurity } from "@/app/admin/api/settings/security/route";
import { GET as getTelegram, PUT as putTelegram } from "@/app/admin/api/settings/telegram/route";
import { db, pool } from "@/db/client";
import { adminUser, appSettings, askCounters, sessions } from "@/db/schema";
import { createCsrfToken } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { decryptSecret } from "@/lib/crypto/secretbox";
import { handleTelegramMessage } from "@/worker/bot/telegram";

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 24).toString("base64");
  process.env.APP_TIMEZONE = "Asia/Shanghai";
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("dedicated DB required");
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(askCounters);
  await db.delete(sessions);
  await db.delete(adminUser);
  await db.delete(appSettings);
  await db.insert(appSettings).values({ id: 1 });
  await db.insert(adminUser).values({
    id: 1,
    username: "admin",
    passwordHash: await hashPassword("current-password-123"),
  });
});

afterAll(async () => pool.end());

async function sessionToken(): Promise<string> {
  return (await createSession()).token;
}

function readRequest(path: string, token: string) {
  return new Request(`https://admin.example${path}`, {
    headers: { cookie: `admin_session=${token}` },
  });
}

function writeRequest(path: string, token: string, body: unknown, overrides: Record<string, string> = {}) {
  return new Request(`https://admin.example${path}`, {
    method: "PUT",
    headers: {
      cookie: `admin_session=${token}`,
      host: "admin.example",
      origin: "https://admin.example",
      "content-type": "application/json",
      "x-csrf-token": createCsrfToken(token),
      ...overrides,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("admin settings routes", () => {
  it("applies the shared write guard before every settings mutation", async () => {
    const handlers = [putRefetch, putRateLimit, putSecurity, putTelegram, putLocale];
    for (const handler of handlers) {
      const anonymous = await handler(new Request("https://admin.example/admin/api/settings/test", {
        method: "PUT", headers: { "content-type": "application/json" }, body: "{}",
      }));
      expect(anonymous.status).toBe(401);
      const token = await sessionToken();
      const invalidCsrf = await handler(writeRequest("/admin/api/settings/test", token, {}, { "x-csrf-token": "wrong" }));
      expect(invalidCsrf.status).toBe(403);
    }
  });

  it("reads and updates scheduled refetch with bounded intervals and next-run data", async () => {
    const token = await sessionToken();
    await db.update(appSettings).set({ refetchLastRun: new Date("2026-08-01T00:00:00Z") });
    const saved = await putRefetch(writeRequest("/admin/api/settings/refetch", token, { enabled: true, intervalDays: 7 }));
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ enabled: true, intervalDays: 7, nextRun: "2026-08-08T00:00:00.000Z" });
    expect((await putRefetch(writeRequest("/admin/api/settings/refetch", token, { enabled: true, intervalDays: 0 }))).status).toBe(400);
    expect((await getRefetch(readRequest("/admin/api/settings/refetch", token))).status).toBe(200);
  });

  it("returns business-day usage and applies public limits immediately", async () => {
    const token = await sessionToken();
    await db.insert(askCounters).values({ day: "2026-08-09", scope: "global", count: 12 });
    const response = await putRateLimit(writeRequest("/admin/api/settings/rate-limit", token, {
      enabled: true, ipDaily: 3, globalDaily: 9,
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ enabled: true, ipDaily: 3, globalDaily: 9 });
    const current = await getRateLimit(readRequest("/admin/api/settings/rate-limit", token));
    await expect(current.json()).resolves.toMatchObject({ usedGlobal: 12, day: "2026-08-09" });
    expect((await putRateLimit(writeRequest("/admin/api/settings/rate-limit", token, { enabled: true, ipDaily: 0, globalDaily: 9 }))).status).toBe(400);
  });

  it("changes the password only with the current password and revokes every session", async () => {
    const token = await sessionToken();
    await sessionToken();
    const before = (await db.select().from(adminUser))[0].passwordHash;
    expect((await putSecurity(writeRequest("/admin/api/settings/security", token, {
      currentPassword: "wrong-current", newPassword: "new-password-456",
    }))).status).toBe(403);
    expect((await putSecurity(writeRequest("/admin/api/settings/security", token, {
      currentPassword: "current-password-123", newPassword: "short",
    }))).status).toBe(400);
    expect((await db.select().from(adminUser))[0].passwordHash).toBe(before);
    expect(await db.select().from(sessions)).toHaveLength(2);

    const changed = await putSecurity(writeRequest("/admin/api/settings/security", token, {
      currentPassword: "current-password-123", newPassword: "new-password-456",
    }));
    expect(changed.status).toBe(204);
    expect(changed.headers.get("set-cookie")).toContain("admin_session=;");
    const hash = (await db.select().from(adminUser))[0].passwordHash;
    await expect(verifyPassword(hash, "current-password-123")).resolves.toBe(false);
    await expect(verifyPassword(hash, "new-password-456")).resolves.toBe(true);
    expect(await db.select().from(sessions)).toEqual([]);
  });

  it("stores Telegram secrets encrypted and returns only a mask and allowlist", async () => {
    const token = await sessionToken();
    const saved = await putTelegram(writeRequest("/admin/api/settings/telegram", token, {
      token: "123456:telegram-secret-token", allowedIds: [42, 9007199254740990],
    }));
    expect(saved.status).toBe(200);
    const payload = await saved.json() as { tokenMasked: string; allowedIds: number[] };
    expect(payload.tokenMasked).not.toContain("telegram-secret-token");
    expect(payload.allowedIds).toEqual([42, 9007199254740990]);
    const row = (await db.select().from(appSettings))[0];
    expect(row.tgTokenEnc).not.toContain("telegram-secret-token");
    expect(decryptSecret(row.tgTokenEnc!)).toBe("123456:telegram-secret-token");
    await expect((await getTelegram(readRequest("/admin/api/settings/telegram", token))).json()).resolves.toEqual(payload);
    const send = vi.fn();
    const retrieve = vi.fn();
    await handleTelegramMessage({ senderId: 7, chatId: "700", text: "不应检索的问题" }, { send, retrieve });
    expect(send).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("persists the default locale and mirrors it to the shared locale cookie", async () => {
    const token = await sessionToken();
    const saved = await putLocale(writeRequest("/admin/api/settings/locale", token, { locale: "en" }));
    expect(saved.status).toBe(200);
    expect(saved.headers.get("set-cookie")).toContain("locale=en");
    await expect(saved.json()).resolves.toEqual({ locale: "en" });
    await expect((await getLocale(readRequest("/admin/api/settings/locale", token))).json()).resolves.toEqual({ locale: "en" });
    expect((await putLocale(writeRequest("/admin/api/settings/locale", token, { locale: "fr" }))).status).toBe(400);
  });
});
