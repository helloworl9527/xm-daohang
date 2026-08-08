// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/admin/api/items/route";
import { db, pool } from "@/db/client";
import { appSettings, items, processingRequests, sessions } from "@/db/schema";
import { createCsrfToken } from "@/lib/auth/guard";
import { createSession } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto/secretbox";

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Add item tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(processingRequests);
  await db.delete(items);
  await db.delete(sessions);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    llmBaseUrl: "https://models.example/v1",
    llmModel: "chat-model",
    llmKeyEnc: encryptSecret("sk-llm"),
    embBaseUrl: "https://models.example/v1",
    embModel: "embedding-model",
    embKeyEnc: encryptSecret("sk-emb"),
    embDim: 3,
    embVersion: 2,
    embRebuildStatus: "ready",
  });
});

afterAll(async () => {
  await pool.end();
});

async function authenticatedRequest(body: unknown, overrides: {
  contentType?: string;
  origin?: string;
  csrf?: string;
} = {}) {
  const { token } = await createSession();
  return new Request("https://admin.example/admin/api/items", {
    method: "POST",
    headers: {
      cookie: `admin_session=${token}`,
      host: "admin.example",
      origin: overrides.origin ?? "https://admin.example",
      "content-type": overrides.contentType ?? "application/json",
      "x-csrf-token": overrides.csrf ?? createCsrfToken(token),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /admin/api/items", () => {
  it("normalizes, inserts, and enqueues a new public URL in one operation", async () => {
    const response = await POST(await authenticatedRequest({
      url: " https://93.184.216.34/article?b=2&a=1#section ",
    }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({ deduped: false, status: "processing" });

    const saved = await db.select().from(items);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: payload.id,
      urlCanonical: "https://93.184.216.34/article?a=1&b=2",
      type: "web",
      source: "admin",
      status: "processing",
      processGeneration: 1,
    });
    expect(await db.select().from(processingRequests)).toEqual([
      expect.objectContaining({
        itemId: payload.id,
        processGeneration: 1,
        embVersion: 2,
        attempt: 0,
        status: "pending",
      }),
    ]);
  });

  it("returns the existing item for a canonical duplicate without enqueueing again", async () => {
    const first = await POST(await authenticatedRequest({
      url: "https://93.184.216.34/article?a=1&b=2",
    }));
    const firstPayload = await first.json();
    const duplicate = await POST(await authenticatedRequest({
      url: "https://93.184.216.34/article?b=2&a=1#other",
    }));

    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      id: firstPayload.id,
      deduped: true,
      status: "processing",
    });
    expect(await db.select().from(items)).toHaveLength(1);
    expect(await db.select().from(processingRequests)).toHaveLength(1);
  });

  it("fails closed for auth, origin, CSRF, content type, schema, and private targets", async () => {
    const anonymous = await POST(new Request("https://admin.example/admin/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://93.184.216.34" }),
    }));
    expect(anonymous.status).toBe(401);
    expect((await POST(await authenticatedRequest(
      { url: "https://93.184.216.34" },
      { origin: "https://evil.example" },
    ))).status).toBe(403);
    expect((await POST(await authenticatedRequest(
      { url: "https://93.184.216.34" },
      { csrf: "wrong" },
    ))).status).toBe(403);
    expect((await POST(await authenticatedRequest(
      JSON.stringify({ url: "https://93.184.216.34" }),
      { contentType: "text/plain" },
    ))).status).toBe(415);
    expect((await POST(await authenticatedRequest({ url: "not-a-url" }))).status).toBe(400);
    expect((await POST(await authenticatedRequest({ url: "http://127.0.0.1/private" }))).status).toBe(400);
    expect(await db.select().from(items)).toHaveLength(0);
  });

  it("blocks before URL resolution when either model is not configured", async () => {
    await db.delete(appSettings);
    await db.insert(appSettings).values({ id: 1 });
    const response = await POST(await authenticatedRequest({ url: "https://93.184.216.34/article" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODEL_UNAVAILABLE", retryable: false },
    });
    expect(await db.select().from(items)).toHaveLength(0);
  });
});
