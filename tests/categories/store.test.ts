// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings, categories, items } from "@/db/schema";
import {
  CategoryError,
  advanceCategoryVersion,
  createCategory,
  createCategoryRecord,
  deleteCategory,
  getCategoryOverview,
  listCategories,
  renameCategory,
} from "@/lib/categories/store";

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Category store tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(items);
  await db.delete(categories);
  await db.delete(appSettings);
  await db.insert(appSettings).values({ id: 1 });
});

afterAll(async () => {
  await pool.end();
});

describe("category store", () => {
  it("normalizes names, creates stable slugs, initializes once, and sorts deterministically", async () => {
    const later = await createCategory({ name: "  ＡＩ 工具  ", sort: 20 });
    const earlier = await createCategory({ name: "开发工具", sort: 10 });

    expect(later).toMatchObject({ name: "AI 工具", sort: 20 });
    expect(later.slug).toBe(`cat-${later.id.replaceAll("-", "")}`);
    expect(await listCategories()).toEqual([earlier, later]);
    const [settings] = await db.select().from(appSettings);
    expect(settings).toMatchObject({ categoriesInitialized: true, categoryVersion: 2 });
  });

  it.each(["", "   ", "bad\u0000name", "x".repeat(81)])("rejects an invalid name %#", async (name) => {
    await expect(createCategory({ name })).rejects.toEqual(new CategoryError("VALIDATION"));
  });

  it("maps concurrent normalized duplicates to a stable error", async () => {
    const results = await Promise.allSettled([
      createCategory({ name: "数据库" }),
      createCategory({ name: "  数据库  " }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "DUPLICATE_CATEGORY" } });
  });

  it("uses a supplied transaction for record helpers and rolls back with the caller", async () => {
    const globalInsert = vi.spyOn(db, "insert");
    await expect(
      db.transaction(async (tx) => {
        await createCategoryRecord(tx, { name: "事务内分类" });
        throw new Error("ROLLBACK_FIXTURE");
      }),
    ).rejects.toThrow("ROLLBACK_FIXTURE");

    expect(globalInsert).not.toHaveBeenCalled();
    expect(await db.select().from(categories)).toHaveLength(0);
    globalInsert.mockRestore();
  });

  it("renames with normalization and reports not found without changing the version", async () => {
    const category = await createCategory({ name: "旧名" });
    await expect(renameCategory(category.id, "  Ｎｅｗ 名称  ")).resolves.toMatchObject({
      id: category.id,
      name: "New 名称",
    });
    await expect(
      renameCategory("10000000-0000-4000-8000-000000000099", "不存在"),
    ).rejects.toEqual(new CategoryError("CATEGORY_NOT_FOUND"));
    const [settings] = await db.select().from(appSettings);
    expect(settings.categoryVersion).toBe(2);
  });

  it("deletes explicitly, preserves manual flags, reports affected counts, and never uninitializes", async () => {
    const category = await createCategory({ name: "待删除" });
    await db.insert(items).values([
      {
        url: "https://example.com/auto",
        urlCanonical: "https://example.com/auto",
        type: "web",
        source: "admin",
        categoryId: category.id,
      },
      {
        url: "https://example.com/manual",
        urlCanonical: "https://example.com/manual",
        type: "github",
        source: "admin",
        categoryId: category.id,
        categoryManual: true,
      },
    ]);

    await expect(deleteCategory(category.id)).resolves.toEqual({ autoCount: 1, manualCount: 1 });
    expect(await db.select().from(items)).toEqual([
      expect.objectContaining({ categoryId: null, categoryManual: false }),
      expect.objectContaining({ categoryId: null, categoryManual: true }),
    ]);
    const [settings] = await db.select().from(appSettings);
    expect(settings).toMatchObject({ categoriesInitialized: true, categoryVersion: 2 });
  });

  it("uses explicit overview scopes for eligible, manual, and completed docs", async () => {
    const category = await createCategory({ name: "工具" });
    await db.insert(items).values([
      {
        url: "https://example.com/classified",
        urlCanonical: "https://example.com/classified",
        type: "web",
        title: "Classified",
        tags: ["a", "b", "c"],
        status: "completed",
        source: "admin",
        categoryId: category.id,
      },
      {
        url: "https://example.com/unclassified",
        urlCanonical: "https://example.com/unclassified",
        type: "github",
        title: "Unclassified",
        tags: ["a", "b", "c"],
        status: "completed",
        source: "admin",
        categoryManual: true,
      },
      {
        url: "https://example.com/doc",
        urlCanonical: "https://example.com/doc",
        type: "doc",
        title: "Doc",
        tags: ["a", "b", "c"],
        status: "completed",
        source: "admin",
        categoryManual: true,
      },
      {
        url: "https://example.com/failed",
        urlCanonical: "https://example.com/failed",
        type: "web",
        status: "failed",
        source: "admin",
        categoryId: category.id,
      },
    ]);

    await expect(getCategoryOverview()).resolves.toMatchObject({
      eligible: { classified: 1, unclassified: 1, total: 2 },
      manualItems: 2,
      completedDocs: 1,
      categories: [expect.objectContaining({ id: category.id, autoCount: 2, manualCount: 0 })],
    });
  });

  it("rolls back both taxonomy and version when a transaction fails", async () => {
    await expect(
      db.transaction(async (tx) => {
        await createCategoryRecord(tx, { name: "回滚分类" });
        await advanceCategoryVersion(tx, { initialize: true });
        throw new Error("INJECTED_FAILURE");
      }),
    ).rejects.toThrow("INJECTED_FAILURE");

    expect(await db.select().from(categories)).toHaveLength(0);
    const [settings] = await db.select().from(appSettings);
    expect(settings).toMatchObject({ categoriesInitialized: false, categoryVersion: 0 });
  });
});
