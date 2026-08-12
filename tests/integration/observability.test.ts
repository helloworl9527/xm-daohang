// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const logLines = vi.hoisted((): string[] => []);
vi.mock("@/lib/log/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/log/logger")>();
  return { ...actual, logger: actual.createLogger((line) => logLines.push(line)) };
});

import { loginWithCredentials } from "@/app/admin/login/actions";
import { POST as addItemRoute } from "@/app/admin/api/items/route";
import { db, pool } from "@/db/client";
import {
  adminUser,
  appSettings,
  askCounters,
  items,
  loginAttempts,
  processingRequests,
  sessions,
  telegramReceipts,
} from "@/db/schema";
import { createAskHandler } from "@/lib/ask/handler";
import { createCsrfToken } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto/secretbox";
import type { SearchHit } from "@/lib/search/retrieve";
import { dispatchTelegramReceipt } from "@/worker/bot/receiptDispatcher";
import { handleTelegramMessage } from "@/worker/bot/telegram";
import { processItemJob } from "@/worker/jobs/processItem";
import { createKeywordHandler } from "@/lib/search/keyword";

const QUESTION = "SECRET_QUESTION_9876 怎么检索？";
const IP = "203.0.113.199";
const CHAT_ID = "998877665544";
const KEY = "sk-DRAFT-MUST-NOT-LOG-9876";
const COOKIE = "admin_session=COOKIE_MUST_NOT_LOG_9876";
const hit: SearchHit = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "向量检索",
  summary: "介绍精确余弦检索。",
  url: "https://example.com/vector",
  tags: ["vector", "search", "fixture"],
  score: 0.95,
};
const siteHit = {
  id: hit.id,
  title: hit.title,
  summary: hit.summary,
  url: hit.url,
  tags: hit.tags,
  categoryName: "工具",
  faviconPath: `/favicon/${hit.id}`,
};

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
  process.env.LOGIN_IP_HASH_KEY = "observability-login-key-with-at-least-32-bytes";
  process.env.TG_ID_HASH_KEY = "observability-tg-key-with-at-least-32-bytes";
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("dedicated DB required");
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  logLines.length = 0;
  await db.delete(telegramReceipts);
  await db.delete(processingRequests);
  await db.delete(askCounters);
  await db.delete(items);
  await db.delete(sessions);
  await db.delete(loginAttempts);
  await db.delete(adminUser);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    llmBaseUrl: "https://models.example/v1", llmModel: "chat", llmKeyEnc: "configured",
    embBaseUrl: "https://models.example/v1", embModel: "emb", embKeyEnc: "configured", embDim: 3,
    embVersion: 1, embRebuildStatus: "ready", searchMinCosine: 0.5,
    tgAllowedIds: [42],
  });
  await db.insert(adminUser).values({
    id: 1,
    username: "admin-secret-name",
    passwordHash: await hashPassword("correct-password-123"),
  });
});

afterAll(async () => pool.end());

async function adminAddRequest(url: string): Promise<Request> {
  const { token } = await createSession();
  return new Request("https://admin.example/admin/api/items", {
    method: "POST",
    headers: {
      cookie: `admin_session=${token}`,
      host: "admin.example",
      origin: "https://admin.example",
      "content-type": "application/json",
      "x-csrf-token": createCsrfToken(token),
    },
    body: JSON.stringify({ url }),
  });
}

function events(name: string): Array<Record<string, unknown>> {
  return logLines.map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.event === name);
}

describe("structured observability events", () => {
  it("uses the Task 13 category and keyword event whitelist without sensitive dimensions", async () => {
    const handler = createKeywordHandler({
      getClientIp: () => IP,
      consume: async () => ({ allowed: false, reason: "ip" }),
    });
    expect((await handler(new Request("https://collection.example/search", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: QUESTION }),
    }))).status).toBe(429);
    const completed = createKeywordHandler({
      getClientIp: () => IP, consume: async () => ({ allowed: true }), search: async () => [siteHit],
    });
    expect((await completed(new Request("https://collection.example/search", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: QUESTION }),
    }))).status).toBe(200);

    for (const event of ["keyword_search_limited", "keyword_search_completed"]) {
      const entries = events(event);
      expect(entries).toHaveLength(1);
      expect(Object.keys(entries[0]!).sort()).toEqual(["count", "event", "level", "ms", "outcome"]);
    }
    const serialized = logLines.join("\n");
    for (const forbidden of [QUESTION, IP, KEY, COOKIE, "hash", "runId", "itemId"]) expect(serialized).not.toContain(forbidden);
  });

  it("emits stable dimensions without questions, identities, credentials, URLs, or upstream text", async () => {
    const first = await addItemRoute(await adminAddRequest("https://93.184.216.34/article?token=URL_SECRET"));
    expect(first.status).toBe(201);
    const added = await first.json() as { id: string };
    const duplicate = await addItemRoute(await adminAddRequest("https://93.184.216.34/article?token=URL_SECRET"));
    expect(duplicate.status).toBe(200);

    await processItemJob(
      { itemId: added.id, processGeneration: 1, embVersion: 1, attempt: 0 },
      {
        fetchContent: vi.fn(async () => {
          throw new Error(`401 ${KEY} https://user:pass@example.com/a?token=UPSTREAM_SECRET`);
        }),
        summarize: vi.fn(),
        embed: vi.fn(),
        retryDelayMs: () => 0,
      },
    );

    const limited = await createAskHandler({
      readiness: async () => undefined,
      getClientIp: () => IP,
      consume: async () => ({ allowed: false }),
    })(new Request("https://collection.example/ask", {
      method: "POST", headers: { "content-type": "application/json", cookie: COOKIE },
      body: JSON.stringify({ question: QUESTION }),
    }));
    expect(limited.status).toBe(429);
    await createAskHandler({
      readiness: async () => undefined,
      getClientIp: () => IP,
      consume: async () => ({ allowed: true }),
      retrieve: async () => [],
    })(new Request("https://collection.example/ask", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: QUESTION }),
    }));
    await createAskHandler({
      readiness: async () => undefined,
      getClientIp: () => IP,
      consume: async () => ({ allowed: true }),
      retrieve: async () => [hit],
      answer: async () => ({ answer: "可以使用精确余弦检索。", citationIds: [hit.id] }),
    })(new Request("https://collection.example/ask", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: QUESTION }),
    }));

    await loginWithCredentials({ username: "admin-secret-name", password: KEY, ip: IP });
    await loginWithCredentials({ username: "admin-secret-name", password: "correct-password-123", ip: IP });

    const send = vi.fn(async () => undefined);
    await handleTelegramMessage(
      { senderId: 42, chatId: CHAT_ID, text: QUESTION },
      { send, readiness: async () => undefined, retrieve: async () => [], answer: vi.fn() },
    );

    await db.insert(items).values({
      id: hit.id,
      url: hit.url,
      urlCanonical: hit.url,
      type: "web",
      source: "telegram",
      status: "completed",
      title: hit.title,
      summary: hit.summary,
      tags: hit.tags,
    });
    await db.insert(telegramReceipts).values({
      itemId: hit.id,
      processGeneration: 0,
      chatIdHash: "stable-hash",
      chatIdEnc: encryptSecret(CHAT_ID),
      outcome: "completed",
      status: "ready",
      nextAttemptAt: new Date("2026-08-08T00:00:00Z"),
    });
    await dispatchTelegramReceipt("worker-observe", {
      send: async () => undefined,
      now: () => new Date("2026-08-09T00:00:00Z"),
    });

    expect(events("item_added")).toEqual([
      expect.objectContaining({ source: "admin", deduped: false }),
      expect.objectContaining({ source: "admin", deduped: true }),
    ]);
    expect(events("item_processed")).toEqual([
      expect.objectContaining({ ok: false, retries: 0, ms: expect.any(Number) }),
    ]);
    expect(events("public_ask")).toEqual([
      expect.objectContaining({ hit: false, empty: false, limited: true }),
      expect.objectContaining({ hit: false, empty: true, limited: false }),
      expect.objectContaining({ hit: true, empty: false, limited: false }),
    ]);
    expect(events("login")).toEqual([
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(events("tg_ask")).toEqual([expect.objectContaining({ hit: false })]);
    expect(events("tg_receipt")).toEqual([
      expect.objectContaining({ outcome: "completed", duplicate_possible: false }),
    ]);

    const serialized = logLines.join("\n");
    for (const forbidden of [QUESTION, IP, CHAT_ID, KEY, COOKIE, "URL_SECRET", "UPSTREAM_SECRET", "user:pass", "admin-secret-name"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
