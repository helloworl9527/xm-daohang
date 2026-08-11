// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const generateLlmText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/llm", () => ({ generateLlmText }));

import { GET as getCategories, POST as createCategoryRoute } from "@/app/admin/api/categories/route";
import {
  DELETE as deleteCategoryRoute,
  PATCH as renameCategoryRoute,
} from "@/app/admin/api/categories/[id]/route";
import { POST as proposeCategoriesRoute } from "@/app/admin/api/categories/propose/route";
import { POST as applyCategoriesRoute } from "@/app/admin/api/categories/apply/route";
import { GET as getRunRoute } from "@/app/admin/api/categories/runs/[id]/route";
import { POST as retryRunRoute } from "@/app/admin/api/categories/runs/[id]/retry/route";
import { PATCH as setItemCategoryRoute } from "@/app/admin/api/items/[id]/category/route";
import { GET as getItemRoute } from "@/app/admin/api/items/[id]/route";
import { db, pool } from "@/db/client";
import {
  appSettings,
  categories,
  categoryChangeRuns,
  categoryReclassifyFailures,
  categoryRunRetryRequests,
  items,
  sessions,
} from "@/db/schema";
import { createCsrfToken } from "@/lib/auth/guard";
import { createSession } from "@/lib/auth/session";

const CATEGORY_A = "30000000-0000-4000-8000-000000000001";
const CATEGORY_B = "30000000-0000-4000-8000-000000000002";
const ITEM_ID = "30000000-0000-4000-8000-000000000010";
const REQUEST_A = "30000000-0000-4000-8000-000000000020";
const REQUEST_B = "30000000-0000-4000-8000-000000000021";

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Category API tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  generateLlmText.mockReset();
  await db.delete(categoryRunRetryRequests);
  await db.delete(categoryReclassifyFailures);
  await db.delete(categoryChangeRuns);
  await db.delete(items);
  await db.delete(categories);
  await db.delete(sessions);
  await db.delete(appSettings);
  await db.insert(appSettings).values({ id: 1 });
});

afterAll(async () => pool.end());

async function request(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body: unknown = {},
  options: { authenticated?: boolean; csrf?: string; contentType?: string; etag?: string } = {},
) {
  const headers: Record<string, string> = { host: "admin.example" };
  if (options.authenticated !== false) {
    const { token } = await createSession();
    headers.cookie = `admin_session=${token}`;
    if (method !== "GET") {
      headers.origin = "https://admin.example";
      headers["content-type"] = options.contentType ?? "application/json";
      headers["x-csrf-token"] = options.csrf ?? createCsrfToken(token);
    }
  }
  if (options.etag) headers["if-match"] = options.etag;
  return new Request(`https://admin.example${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seedCategories() {
  await db.insert(categories).values([
    { id: CATEGORY_A, name: "开发工具", slug: "cat-a", sort: 0 },
    { id: CATEGORY_B, name: "人工智能", slug: "cat-b", sort: 1 },
  ]);
  await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 2 });
}

async function seedItem() {
  const [item] = await db.insert(items).values({
    id: ITEM_ID,
    url: "https://example.com/category-api",
    urlCanonical: "https://example.com/category-api",
    type: "web",
    title: "分类 API 条目",
    summary: "用于分类 API 测试。",
    tags: ["分类", "接口", "测试"],
    status: "completed",
    source: "admin",
    updatedAt: new Date("2026-08-11T02:00:00.000Z"),
  }).returning();
  return item!;
}

describe("admin category APIs", () => {
  it("fails closed for anonymous reads and shared write guards", async () => {
    expect((await getCategories(await request("/admin/api/categories", "GET", {}, { authenticated: false }))).status)
      .toBe(401);
    const writeHandlers: Array<[string, (request: Request) => Promise<Response>]> = [
      ["/admin/api/categories", createCategoryRoute],
      [`/admin/api/categories/${CATEGORY_A}`, (value) => renameCategoryRoute(value, params(CATEGORY_A))],
      [`/admin/api/categories/${CATEGORY_A}`, (value) => deleteCategoryRoute(value, params(CATEGORY_A))],
      ["/admin/api/categories/propose", proposeCategoriesRoute],
      ["/admin/api/categories/apply", applyCategoriesRoute],
      [`/admin/api/categories/runs/${REQUEST_A}/retry`, (value) => retryRunRoute(value, params(REQUEST_A))],
      [`/admin/api/items/${ITEM_ID}/category`, (value) => setItemCategoryRoute(value, params(ITEM_ID))],
    ];
    for (const [path, handler] of writeHandlers) {
      const anonymous = await handler(await request(path, "POST", {}, { authenticated: false }));
      expect(anonymous.status).toBe(401);
      const badCsrf = await handler(await request(path, "POST", {}, { csrf: "wrong" }));
      expect(badCsrf.status).toBe(403);
      const badType = await handler(await request(path, "POST", {}, { contentType: "text/plain" }));
      expect(badType.status).toBe(415);
    }
  });

  it("creates, lists, renames, and explicitly deletes categories with server impact counts", async () => {
    const created = await createCategoryRoute(await request("/admin/api/categories", "POST", { name: "  开发工具  " }));
    expect(created.status).toBe(201);
    const payload = await created.json() as { category: { id: string } };
    const duplicate = await createCategoryRoute(await request("/admin/api/categories", "POST", { name: "开发工具" }));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: { code: "DUPLICATE_CATEGORY" } });

    await seedItem();
    await db.update(items).set({ categoryId: payload.category.id, categoryManual: true }).where(eq(items.id, ITEM_ID));
    const renamed = await renameCategoryRoute(
      await request(`/admin/api/categories/${payload.category.id}`, "PATCH", { name: "研发工具" }),
      params(payload.category.id),
    );
    expect(renamed.status).toBe(200);
    const listed = await getCategories(await request("/admin/api/categories"));
    expect(listed.headers.get("cache-control")).toBe("no-store");
    await expect(listed.json()).resolves.toMatchObject({
      overview: { categories: [{ name: "研发工具", manualCount: 1 }], manualItems: 1 },
    });

    const removed = await deleteCategoryRoute(
      await request(`/admin/api/categories/${payload.category.id}`, "DELETE", {}),
      params(payload.category.id),
    );
    await expect(removed.json()).resolves.toEqual({ autoCount: 0, manualCount: 1 });
    expect((await db.select().from(items))[0]).toMatchObject({ categoryId: null, categoryManual: true });
  });

  it("returns temporary proposals and maps invalid model output without leaking it", async () => {
    await seedCategories();
    generateLlmText.mockResolvedValueOnce(JSON.stringify({ diffs: [{
      kind: "add", proposalId: "new", name: "数据工具",
    }] }));
    const proposed = await proposeCategoriesRoute(await request("/admin/api/categories/propose", "POST", {
      mode: "supplement",
    }));
    expect(proposed.status).toBe(200);
    await expect(proposed.json()).resolves.toMatchObject({ mode: "supplement", baseVersion: 2 });

    generateLlmText.mockResolvedValue("not-json");
    const invalid = await proposeCategoriesRoute(await request("/admin/api/categories/propose", "POST", {
      mode: "full",
    }));
    expect(invalid.status).toBe(502);
    const error = await invalid.text();
    expect(error).toContain("AI_OUTPUT_INVALID");
    expect(error).not.toContain("not-json");
  });

  it("applies idempotently and exposes manual conflicts as stable 409 responses", async () => {
    await seedCategories();
    const body = {
      requestKey: REQUEST_A,
      mode: "full",
      baseVersion: 2,
      accepted: [{ kind: "add", proposalId: "new", name: "数据工具" }],
      ignored: [],
      reclassifyAuto: false,
    };
    const first = await applyCategoriesRoute(await request("/admin/api/categories/apply", "POST", body));
    const duplicate = await applyCategoriesRoute(await request("/admin/api/categories/apply", "POST", body));
    expect(first.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual(await first.clone().json());
    expect(await db.select().from(categoryChangeRuns)).toHaveLength(1);

    const item = await seedItem();
    await db.update(items).set({ categoryId: CATEGORY_A, categoryManual: true }).where(eq(items.id, item.id));
    const conflict = await applyCategoriesRoute(await request("/admin/api/categories/apply", "POST", {
      requestKey: REQUEST_B,
      mode: "full",
      baseVersion: 3,
      accepted: [{
        kind: "delete",
        proposalId: "blocked",
        sourceCategoryId: CATEGORY_A,
        autoDestination: { kind: "unclassified" },
      }],
      ignored: [],
      reclassifyAuto: false,
    }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: { code: "MANUAL_CATEGORY_CONFLICT" } });
  });

  it("gets runs and makes retry request keys permanently idempotent", async () => {
    await seedCategories();
    await seedItem();
    await db.insert(categoryChangeRuns).values({
      id: REQUEST_A,
      requestKey: REQUEST_A,
      mode: "full",
      baseVersion: 1,
      appliedVersion: 2,
      accepted: [],
      ignored: [],
      snapshotAt: new Date(),
      status: "partial",
    });
    await db.insert(categoryReclassifyFailures).values({
      runId: REQUEST_A,
      itemId: ITEM_ID,
      errorCode: "AI_OUTPUT_INVALID",
    });

    const run = await getRunRoute(await request(`/admin/api/categories/runs/${REQUEST_A}`), params(REQUEST_A));
    await expect(run.json()).resolves.toMatchObject({ run: { id: REQUEST_A, failedCount: 1 } });
    const retryBody = { requestKey: REQUEST_B };
    const first = await retryRunRoute(
      await request(`/admin/api/categories/runs/${REQUEST_A}/retry`, "POST", retryBody),
      params(REQUEST_A),
    );
    const duplicate = await retryRunRoute(
      await request(`/admin/api/categories/runs/${REQUEST_A}/retry`, "POST", retryBody),
      params(REQUEST_A),
    );
    expect(first.status).toBe(202);
    await expect(duplicate.json()).resolves.toEqual(await first.clone().json());
    expect(await db.select().from(categoryRunRetryRequests)).toHaveLength(1);
  });

  it("manually assigns a category or NULL with If-Match and rejects stale editors", async () => {
    await seedCategories();
    await seedItem();
    const detail = await getItemRoute(await request(`/admin/api/items/${ITEM_ID}`), params(ITEM_ID));
    const etag = detail.headers.get("etag")!;

    const assigned = await setItemCategoryRoute(
      await request(`/admin/api/items/${ITEM_ID}/category`, "PATCH", { categoryId: CATEGORY_A }, { etag }),
      params(ITEM_ID),
    );
    expect(assigned.status).toBe(200);
    const nextEtag = assigned.headers.get("etag")!;
    await expect(assigned.json()).resolves.toMatchObject({
      item: { categoryId: CATEGORY_A, categoryName: "开发工具", categoryManual: true },
    });

    const stale = await setItemCategoryRoute(
      await request(`/admin/api/items/${ITEM_ID}/category`, "PATCH", { categoryId: null }, { etag }),
      params(ITEM_ID),
    );
    expect(stale.status).toBe(409);
    const cleared = await setItemCategoryRoute(
      await request(`/admin/api/items/${ITEM_ID}/category`, "PATCH", { categoryId: null }, { etag: nextEtag }),
      params(ITEM_ID),
    );
    await expect(cleared.json()).resolves.toMatchObject({
      item: { categoryId: null, categoryName: null, categoryManual: true },
    });
  });

  it("maps missing resources, invalid retry input, and category preconditions to stable codes", async () => {
    await seedCategories();
    await seedItem();

    const missingRun = await getRunRoute(
      await request(`/admin/api/categories/runs/${REQUEST_A}`),
      params(REQUEST_A),
    );
    expect(missingRun.status).toBe(404);
    await expect(missingRun.json()).resolves.toMatchObject({ error: { code: "RUN_NOT_FOUND" } });

    const invalidRetry = await retryRunRoute(
      await request(`/admin/api/categories/runs/${REQUEST_A}/retry`, "POST", { requestKey: "not-a-uuid" }),
      params(REQUEST_A),
    );
    expect(invalidRetry.status).toBe(400);
    await expect(invalidRetry.json()).resolves.toMatchObject({ error: { code: "VALIDATION" } });

    const detail = await getItemRoute(await request(`/admin/api/items/${ITEM_ID}`), params(ITEM_ID));
    const etag = detail.headers.get("etag")!;
    const missingCategory = await setItemCategoryRoute(
      await request(`/admin/api/items/${ITEM_ID}/category`, "PATCH", {
        categoryId: "30000000-0000-4000-8000-000000000099",
      }, { etag }),
      params(ITEM_ID),
    );
    expect(missingCategory.status).toBe(404);
    await expect(missingCategory.json()).resolves.toMatchObject({ error: { code: "CATEGORY_NOT_FOUND" } });
    expect((await db.select().from(items))[0]).toMatchObject({ categoryId: null, categoryManual: false });

    const missingEtag = await setItemCategoryRoute(
      await request(`/admin/api/items/${ITEM_ID}/category`, "PATCH", { categoryId: null }),
      params(ITEM_ID),
    );
    expect(missingEtag.status).toBe(428);
    await expect(missingEtag.json()).resolves.toMatchObject({ error: { code: "PRECONDITION_REQUIRED" } });
  });
});
