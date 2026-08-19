// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET, PATCH } from "@/app/admin/api/items/[id]/route";
import { db, pool } from "@/db/client";
import {
  appSettings,
  dailySelections,
  items,
  processingRequests,
  sessions,
  telegramReceipts,
} from "@/db/schema";
import { createCsrfToken } from "@/lib/auth/guard";
import { createSession } from "@/lib/auth/session";

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Item detail tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(telegramReceipts);
  await db.delete(processingRequests);
  await db.delete(dailySelections);
  await db.delete(items);
  await db.delete(sessions);
  await db.delete(appSettings);
  await db.insert(appSettings).values({ id: 1, embVersion: 7 });
});

afterAll(async () => {
  await pool.end();
});

async function seedItem(status: "completed" | "failed" | "processing" = "completed") {
  const [item] = await db.insert(items).values({
    id: "00000000-0000-4000-8000-000000000021",
    url: "https://example.com/detail",
    urlCanonical: "https://example.com/detail",
    type: "web",
    title: "条目详情",
    summary: "原总结第一句。原总结第二句。",
    tags: status === "completed" ? ["标签一", "标签二", "标签三"] : [],
    status,
    source: "admin",
    ...(status === "completed" ? {
      embedding: [1, 0, 0],
      embeddingDim: 3,
      embeddingVersion: 7,
    } : {}),
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
  }).returning();
  return item;
}

async function request(
  method: "GET" | "PATCH" | "DELETE",
  id: string,
  options: {
    body?: unknown;
    contentType?: string | null;
    etag?: string;
    authenticated?: boolean;
    csrf?: string;
    origin?: string | null;
    rawBody?: string;
  } = {},
) {
  const headers: Record<string, string> = { host: "admin.example" };
  if (options.authenticated !== false) {
    const { token } = await createSession();
    headers.cookie = `admin_session=${token}`;
    if (method !== "GET") {
      if (options.origin !== null) headers.origin = options.origin ?? "https://admin.example";
      if (options.contentType !== null) {
        headers["content-type"] = options.contentType ?? "application/json";
      }
      headers["x-csrf-token"] = options.csrf ?? createCsrfToken(token);
    }
  }
  if (options.etag) headers["if-match"] = options.etag;
  return new Request(`https://admin.example/admin/api/items/${id}`, {
    method,
    headers,
    body: method === "GET" ? undefined : options.rawBody ?? JSON.stringify(options.body ?? {}),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("admin item detail API", () => {
  it("returns an authenticated display DTO and ETag without internal fields", async () => {
    const item = await seedItem();
    const anonymous = await GET(await request("GET", item.id, { authenticated: false }), params(item.id));
    expect(anonymous.status).toBe(401);

    const response = await GET(await request("GET", item.id), params(item.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toEqual(expect.stringMatching(/^".+"$/));
    const payload = await response.json();
    expect(payload.item).toMatchObject({
      id: item.id,
      title: "条目详情",
      summaryManual: false,
      status: "completed",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /embedding|processGeneration|contentHash|urlCanonical|keyEnc|secret|stack/i,
    );
  });

  it("updates only the summary, marks it manual, and rejects a stale ETag", async () => {
    const item = await seedItem();
    const detail = await GET(await request("GET", item.id), params(item.id));
    const etag = detail.headers.get("etag")!;

    const updated = await PATCH(await request("PATCH", item.id, {
      body: { summary: "人工修订后的总结。" },
      etag,
    }), params(item.id));
    expect(updated.status).toBe(200);
    expect(updated.headers.get("etag")).not.toBe(etag);
    await expect(updated.json()).resolves.toMatchObject({
      item: { summary: "人工修订后的总结。", summaryManual: true },
    });

    const stale = await PATCH(await request("PATCH", item.id, {
      body: { summary: "应被拒绝的总结。" },
      etag,
    }), params(item.id));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "ITEM_CONFLICT" } });
    const [saved] = await db.select().from(items).where(eq(items.id, item.id));
    expect(saved.summary).toBe("人工修订后的总结。");
  });

  it("fails closed for write auth, CSRF, content type, schema, and missing ETag", async () => {
    const item = await seedItem();
    const anonymous = await PATCH(await request("PATCH", item.id, {
      authenticated: false,
      body: { summary: "x" },
    }), params(item.id));
    expect(anonymous.status).toBe(401);

    const badCsrf = await PATCH(await request("PATCH", item.id, {
      body: { summary: "x" },
      etag: '"2026-01-02T03:04:05.000Z"',
      csrf: "wrong",
    }), params(item.id));
    expect(badCsrf.status).toBe(403);
    const missingEtag = await PATCH(await request("PATCH", item.id, {
      body: { summary: "x" },
    }), params(item.id));
    expect(missingEtag.status).toBe(428);
    const extraField = await PATCH(await request("PATCH", item.id, {
      body: { summary: "x", title: "overwrite" },
      etag: '"2026-01-02T03:04:05.000Z"',
    }), params(item.id));
    expect(extraField.status).toBe(400);

    const [saved] = await db.select().from(items).where(eq(items.id, item.id));
    expect(saved.summaryManual).toBe(false);
    expect(saved.title).toBe("条目详情");
  });

  it("deletes the item, vector, selection, requests, and receipts by cascade", async () => {
    const item = await seedItem();
    await db.insert(dailySelections).values({ day: "2026-01-03", rank: 1, itemId: item.id });
    await db.insert(processingRequests).values({
      itemId: item.id,
      processGeneration: 0,
      embVersion: 7,
      attempt: 0,
      status: "done",
    });
    await db.insert(telegramReceipts).values({
      itemId: item.id,
      processGeneration: 0,
      chatIdHash: "hashed-chat",
      chatIdEnc: "encrypted-chat",
      outcome: "completed",
      status: "sent",
    });

    const response = await DELETE(await request("DELETE", item.id), params(item.id));
    expect(response.status).toBe(204);
    expect(await db.select().from(items)).toHaveLength(0);
    expect(await db.select().from(dailySelections)).toHaveLength(0);
    expect(await db.select().from(processingRequests)).toHaveLength(0);
    expect(await db.select().from(telegramReceipts)).toHaveLength(0);
    const retrievable = await pool.query(
      "select id from items where status = 'completed' and embedding is not null",
    );
    expect(retrievable.rows).toHaveLength(0);
  });

  it("rejects non-JSON media types before a destructive write", async () => {
    const item = await seedItem();
    for (const contentType of [
      "application/jsonp",
      "text/plain",
      null,
      "application/json; charset",
      "application/json; charset=",
      "application/json; foo=bar",
      "application/json; charset=utf-8; x=1",
      "application/json;; charset=utf-8",
    ]) {
      const response = await DELETE(await request("DELETE", item.id, {
        contentType,
      }), params(item.id));
      expect(response.status).toBe(415);
      expect(await db.select().from(items).where(eq(items.id, item.id))).toHaveLength(1);
    }

    const valid = await DELETE(await request("DELETE", item.id, {
      contentType: "application/json; charset=utf-8",
    }), params(item.id));
    expect(valid.status).toBe(204);
  });

  it("accepts case-insensitive application/json with a single UTF-8 charset", async () => {
    const item = await seedItem();
    const response = await DELETE(await request("DELETE", item.id, {
      contentType: "Application/JSON; Charset=UTF-8",
    }), params(item.id));

    expect(response.status).toBe(204);
  });

  it("requires the complete request origin before a destructive write", async () => {
    const item = await seedItem();
    for (const origin of [
      "http://admin.example",
      "https://admin.example:444",
      "https://evil.example",
      null,
      "not-an-origin",
    ]) {
      const response = await DELETE(await request("DELETE", item.id, { origin }), params(item.id));
      expect(response.status).toBe(403);
      expect(await db.select().from(items).where(eq(items.id, item.id))).toHaveLength(1);
    }

    const valid = await DELETE(await request("DELETE", item.id, {
      origin: "https://admin.example",
    }), params(item.id));
    expect(valid.status).toBe(204);
  });

  it.each([
    ["malformed JSON", { rawBody: "not-json" }],
    ["an array", { body: [] }],
    ["an extra field", { body: { force: true } }],
  ])("rejects %s before deleting", async (_case, bodyOptions) => {
    const item = await seedItem();
    const response = await DELETE(await request("DELETE", item.id, bodyOptions), params(item.id));

    expect(response.status).toBe(400);
    expect(await db.select().from(items).where(eq(items.id, item.id))).toHaveLength(1);
  });

  it("rejects malformed IDs and returns a stable not-found envelope", async () => {
    const malformed = await GET(await request("GET", "not-a-uuid"), params("not-a-uuid"));
    expect(malformed.status).toBe(400);
    const missingId = "00000000-0000-4000-8000-000000000099";
    const missing = await GET(await request("GET", missingId), params(missingId));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "ITEM_NOT_FOUND" } });
  });
});
