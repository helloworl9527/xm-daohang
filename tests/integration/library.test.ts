// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/admin/api/items/route";
import { db, pool } from "@/db/client";
import { items, sessions } from "@/db/schema";
import { createSession } from "@/lib/auth/session";

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Library tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(items);
  await db.delete(sessions);
});

afterAll(async () => {
  await pool.end();
});

async function authenticatedRequest(query = "") {
  const { token } = await createSession();
  return new Request(`https://admin.example/admin/api/items${query}`, {
    headers: { cookie: `admin_session=${token}` },
  });
}

async function seedLibrary() {
  await db.insert(items).values([
    {
      id: "00000000-0000-4000-8000-000000000001",
      url: "https://example.com/postgresql-guide",
      urlCanonical: "https://example.com/postgresql-guide",
      type: "web",
      title: "PostgreSQL 入门",
      summary: "数据库设计与索引指南。",
      tags: ["数据库", "PostgreSQL", "后端"],
      status: "completed",
      source: "admin",
      embedding: [1, 0, 0],
      embeddingDim: 3,
      embeddingVersion: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-03T00:00:00Z"),
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      url: "https://github.com/example/vector-search",
      urlCanonical: "https://github.com/example/vector-search",
      type: "github",
      title: "向量检索工具",
      summary: "使用 pgvector 完成语义检索。",
      tags: ["检索", "pgvector", "GitHub"],
      status: "completed",
      source: "telegram",
      createdAt: new Date("2026-01-02T00:00:00Z"),
      updatedAt: new Date("2026-01-04T00:00:00Z"),
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      url: "https://example.com/pending",
      urlCanonical: "https://example.com/pending",
      type: "web",
      title: "待处理文章",
      tags: [],
      status: "processing",
      source: "admin",
      createdAt: new Date("2026-01-03T00:00:00Z"),
      updatedAt: new Date("2026-01-05T00:00:00Z"),
    },
  ]);
}

describe("GET /admin/api/items", () => {
  it("requires an authenticated admin session and disables caching", async () => {
    const response = await GET(new Request("https://admin.example/admin/api/items"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns every item for an empty filter without private or internal fields", async () => {
    await seedLibrary();
    const response = await GET(await authenticatedRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.items).toHaveLength(3);
    expect(payload.items.map((item: { id: string }) => item.id)).toEqual([
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000001",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /embedding|processGeneration|contentHash|urlCanonical|keyEnc|secret|stack/i,
    );
  });

  it("keeps a session valid after one minute and returns the library payload", async () => {
    await seedLibrary();
    const { token } = await createSession({ now: new Date(Date.now() - 61_000) });
    const response = await GET(new Request("https://admin.example/admin/api/items", {
      headers: { cookie: `admin_session=${token}` },
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.items).toHaveLength(3);
  });

  it.each([
    ["title", "PostgreSQL", "00000000-0000-4000-8000-000000000001"],
    ["summary", "语义检索", "00000000-0000-4000-8000-000000000002"],
    ["url", "vector-search", "00000000-0000-4000-8000-000000000002"],
  ])("matches keyword in %s", async (_field, query, expectedId) => {
    await seedLibrary();
    const response = await GET(await authenticatedRequest(`?q=${encodeURIComponent(query)}`));
    const payload = await response.json();

    expect(payload.items.map((item: { id: string }) => item.id)).toEqual([expectedId]);
  });

  it("combines repeated tag filters, keyword, and status", async () => {
    await seedLibrary();
    const response = await GET(await authenticatedRequest(
      "?q=PostgreSQL&tag=%E6%95%B0%E6%8D%AE%E5%BA%93&tag=%E5%90%8E%E7%AB%AF&status=completed",
    ));
    const payload = await response.json();

    expect(payload.items.map((item: { id: string }) => item.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
    ]);
  });

  it("uses a stable cursor and rejects malformed query parameters", async () => {
    await seedLibrary();
    const first = await GET(await authenticatedRequest("?limit=2"));
    const firstPayload = await first.json();
    expect(firstPayload.items).toHaveLength(2);
    expect(firstPayload.nextCursor).toEqual(expect.any(String));

    const second = await GET(await authenticatedRequest(
      `?limit=2&cursor=${encodeURIComponent(firstPayload.nextCursor)}`,
    ));
    const secondPayload = await second.json();
    expect(secondPayload.items.map((item: { id: string }) => item.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
    ]);
    expect(secondPayload.nextCursor).toBeNull();

    const invalidStatus = await GET(await authenticatedRequest("?status=deleted"));
    expect(invalidStatus.status).toBe(400);
    const invalidCursor = await GET(await authenticatedRequest("?cursor=not-a-cursor"));
    expect(invalidCursor.status).toBe(400);
  });
});
