// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createAskHandler } from "@/app/(public)/ask/route";
import { db, pool } from "@/db/client";
import { appSettings, askCounters } from "@/db/schema";
import { getTrustedClientIp } from "@/lib/http/clientIp";

const PROXY_SECRET = "proxy-test-secret-with-at-least-32-bytes";
const hit = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "向量检索",
  summary: "介绍精确余弦检索。",
  url: "https://example.com/vector",
  tags: ["vector", "search", "fixture"],
  score: 0.95,
};

function request(
  body: unknown = { question: "如何学习向量检索？" },
  headers: Record<string, string> = {},
): Request {
  return new Request("https://collection.example/ask", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-proxy-auth": PROXY_SECRET,
      "x-real-client-ip": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function counters() {
  return db.select().from(askCounters).orderBy(askCounters.scope);
}

beforeAll(async () => {
  process.env.PROXY_SHARED_SECRET = PROXY_SECRET;
  process.env.IP_HASH_KEY = "public-ask-ip-key-with-at-least-32-bytes";
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Public ask tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(askCounters);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    llmBaseUrl: "https://models.example/v1",
    llmModel: "chat",
    llmKeyEnc: "configured",
    embBaseUrl: "https://models.example/v1",
    embModel: "embedding",
    embKeyEnc: "configured",
    embDim: 3,
    embVersion: 4,
    searchMinCosine: 0.7,
    embRebuildStatus: "ready",
    ratelimitIpDaily: 2,
    ratelimitGlobalDaily: 3,
  });
});

afterAll(async () => {
  await pool.end();
});

describe("trusted public client IP", () => {
  it("trusts only a single normalized IP carrying the correct proxy secret", () => {
    expect(getTrustedClientIp(request())).toBe("203.0.113.7");
    expect(getTrustedClientIp(request({}, { "x-real-client-ip": "2001:0db8::1" }))).toBe("2001:db8::1");
  });

  it.each([
    ["missing secret", { "x-proxy-auth": "" }],
    ["wrong secret", { "x-proxy-auth": "wrong-secret" }],
    ["forged forwarded header", { "x-proxy-auth": "", "x-forwarded-for": "1.1.1.1" }],
    ["multiple IP values", { "x-real-client-ip": "203.0.113.7, 1.1.1.1" }],
    ["invalid IP", { "x-real-client-ip": "not-an-ip" }],
  ])("fails closed for %s", async (_label, headers) => {
    const retrieve = vi.fn(async () => [hit]);
    const answer = vi.fn();
    const response = await createAskHandler({ retrieve, answer })(request(undefined, headers));
    expect(response.status).toBe(403);
    expect(await counters()).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("public ask readiness and atomic limits", () => {
  it.each(["unconfigured", "building", "failed"] as const)(
    "rejects %s before counters or models",
    async (status) => {
      await db.update(appSettings).set({ embRebuildStatus: status });
      const retrieve = vi.fn();
      const answer = vi.fn();
      const response = await createAskHandler({ retrieve, answer })(request());
      expect(response.status).toBe(503);
      expect(await counters()).toEqual([]);
      expect(retrieve).not.toHaveBeenCalled();
      expect(answer).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["llm_base_url", { llmBaseUrl: null }],
    ["llm_model", { llmModel: null }],
    ["llm_key_enc", { llmKeyEnc: null }],
    ["emb_base_url", { embBaseUrl: null }],
    ["emb_model", { embModel: null }],
    ["emb_key_enc", { embKeyEnc: null }],
    ["emb_dim", { embDim: null }],
    ["search_min_cosine", { searchMinCosine: null }],
  ])("fails closed when %s is missing", async (_field, update) => {
    await db.update(appSettings).set(update);
    const retrieve = vi.fn();
    const answer = vi.fn();
    const response = await createAskHandler({ retrieve, answer })(request());
    expect(response.status).toBe(503);
    expect(await counters()).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });

  it("rechecks readiness under lock after the fast check", async () => {
    const retrieve = vi.fn();
    const handler = createAskHandler({
      getClientIp: async (incoming) => {
        await db.update(appSettings).set({ embRebuildStatus: "building" });
        return getTrustedClientIp(incoming);
      },
      retrieve,
      answer: vi.fn(),
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await counters()).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("allows at most the configured concurrent IP limit with equal global and IP counts", async () => {
    const retrieve = vi.fn(async () => [hit]);
    const answer = vi.fn(async () => ({ answer: "归纳回答", citationIds: [hit.id] }));
    const handler = createAskHandler({ retrieve, answer });
    const responses = await Promise.all(Array.from({ length: 5 }, () => handler(request())));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(3);
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenCalledTimes(2);
    expect((await counters()).map((row) => row.count)).toEqual([2, 2]);
  });

  it("enforces the global limit across distinct IPs before model calls", async () => {
    await db.update(appSettings).set({ ratelimitIpDaily: 10, ratelimitGlobalDaily: 2 });
    const retrieve = vi.fn(async () => [hit]);
    const answer = vi.fn(async () => ({ answer: "归纳回答", citationIds: [hit.id] }));
    const handler = createAskHandler({ retrieve, answer });
    const responses = await Promise.all(
      ["203.0.113.1", "203.0.113.2", "203.0.113.3"].map((ip) =>
        handler(request(undefined, { "x-real-client-ip": ip })),
      ),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(answer).toHaveBeenCalledTimes(2);
  });

  it("applies raised limits immediately", async () => {
    const handler = createAskHandler({
      retrieve: async () => [hit],
      answer: async () => ({ answer: "归纳", citationIds: [hit.id] }),
    });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(429);
    await db.update(appSettings).set({ ratelimitIpDaily: 3, ratelimitGlobalDaily: 4 });
    expect((await handler(request())).status).toBe(200);
  });

  it("returns the fixed no-hit answer without calling the LLM", async () => {
    const answer = vi.fn();
    const response = await createAskHandler({ retrieve: async () => [], answer })(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "收藏库中没有相关内容", sources: [] });
    expect(answer).not.toHaveBeenCalled();
  });

  it("rejects oversized input and readiness failures without charging or models", async () => {
    const retrieve = vi.fn();
    const answer = vi.fn();
    expect((await createAskHandler({ retrieve, answer })(request({ question: "x".repeat(501) }))).status).toBe(400);

    const unavailable = await createAskHandler({
      readiness: async () => { throw new Error("DB unavailable"); },
      retrieve,
      answer,
    })(request());
    expect(unavailable.status).toBe(503);
    expect(await counters()).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });

  it("fails closed when the rate-limit transaction is unavailable", async () => {
    const retrieve = vi.fn();
    const answer = vi.fn();
    const response = await createAskHandler({
      consume: async () => { throw new Error("counter storage unavailable"); },
      retrieve,
      answer,
    })(request());
    expect(response.status).toBe(503);
    expect(await counters()).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });
});
