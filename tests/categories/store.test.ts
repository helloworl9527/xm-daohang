// @vitest-environment node

import { sql } from "drizzle-orm";
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
  lockCategoryState,
  renameCategory,
  renameCategoryRecord,
} from "@/lib/categories/store";

function pgErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: string; cause?: unknown };
    if (candidate.code) return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

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

  it("uses a supplied transaction in lockCategoryState and rolls back its settings insert", async () => {
    await db.delete(appSettings);
    const globalInsert = vi.spyOn(db, "insert");
    const globalExecute = vi.spyOn(db, "execute");
    try {
      await expect(
        db.transaction(async (tx) => {
          await lockCategoryState(tx);
          throw new Error("ROLLBACK_LOCK_STATE");
        }),
      ).rejects.toThrow("ROLLBACK_LOCK_STATE");

      expect(globalInsert).not.toHaveBeenCalled();
      expect(globalExecute).not.toHaveBeenCalled();
    } finally {
      globalInsert.mockRestore();
      globalExecute.mockRestore();
    }
    expect(await db.select().from(appSettings)).toHaveLength(0);
  });

  it("holds the taxonomy row lock until the supplied transaction finishes", async () => {
    let releaseFirst!: () => void;
    let reportLocked!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const firstWriter = db.transaction(async (tx) => {
      await lockCategoryState(tx);
      reportLocked();
      await release;
    });

    await locked;
    let secondWriterError: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '100ms'`);
        await lockCategoryState(tx);
      });
    } catch (error) {
      secondWriterError = error;
    } finally {
      releaseFirst();
      await firstWriter;
    }

    expect(pgErrorCode(secondWriterError)).toBe("55P03");
    await expect(db.transaction((tx) => lockCategoryState(tx))).resolves.toMatchObject({
      initialized: false,
      version: 0,
    });
  });

  it("uses a supplied transaction in advanceCategoryVersion and rolls back with the caller", async () => {
    const globalUpdate = vi.spyOn(db, "update");
    try {
      await expect(
        db.transaction(async (tx) => {
          await advanceCategoryVersion(tx, { initialize: true });
          throw new Error("ROLLBACK_ADVANCE_VERSION");
        }),
      ).rejects.toThrow("ROLLBACK_ADVANCE_VERSION");

      expect(globalUpdate).not.toHaveBeenCalled();
    } finally {
      globalUpdate.mockRestore();
    }
    const [settings] = await db.select().from(appSettings);
    expect(settings).toMatchObject({ categoriesInitialized: false, categoryVersion: 0 });
  });

  it("uses a supplied transaction in createCategoryRecord and rolls back with the caller", async () => {
    const globalInsert = vi.spyOn(db, "insert");
    try {
      await expect(
        db.transaction(async (tx) => {
          await createCategoryRecord(tx, { name: "事务内分类" });
          throw new Error("ROLLBACK_CREATE_RECORD");
        }),
      ).rejects.toThrow("ROLLBACK_CREATE_RECORD");

      expect(globalInsert).not.toHaveBeenCalled();
    } finally {
      globalInsert.mockRestore();
    }
    expect(await db.select().from(categories)).toHaveLength(0);
  });

  it("uses a supplied transaction in renameCategoryRecord and rolls back with the caller", async () => {
    const category = await createCategory({ name: "原始名称" });
    const globalUpdate = vi.spyOn(db, "update");
    try {
      await expect(
        db.transaction(async (tx) => {
          await renameCategoryRecord(tx, category.id, { name: "事务名称" });
          throw new Error("ROLLBACK_RENAME_RECORD");
        }),
      ).rejects.toThrow("ROLLBACK_RENAME_RECORD");

      expect(globalUpdate).not.toHaveBeenCalled();
    } finally {
      globalUpdate.mockRestore();
    }
    expect(await listCategories()).toEqual([expect.objectContaining({ name: "原始名称" })]);
  });

  it("uses a supplied transaction in listCategories instead of the global selector", async () => {
    const category = await createCategory({ name: "事务列表" });
    const globalSelect = vi.spyOn(db, "select");
    try {
      const result = await db.transaction((tx) => listCategories(tx));
      expect(result).toEqual([category]);
      expect(globalSelect).not.toHaveBeenCalled();
    } finally {
      globalSelect.mockRestore();
    }
  });

  it("keeps createCategory inside a supplied caller transaction", async () => {
    await expect(
      db.transaction(async (tx) => {
        const globalTransaction = vi.spyOn(db, "transaction");
        const globalInsert = vi.spyOn(db, "insert");
        const globalExecute = vi.spyOn(db, "execute");
        const globalUpdate = vi.spyOn(db, "update");
        try {
          await createCategory({ name: "事务创建" }, tx);
          expect(globalTransaction).not.toHaveBeenCalled();
          expect(globalInsert).not.toHaveBeenCalled();
          expect(globalExecute).not.toHaveBeenCalled();
          expect(globalUpdate).not.toHaveBeenCalled();
        } finally {
          globalTransaction.mockRestore();
          globalInsert.mockRestore();
          globalExecute.mockRestore();
          globalUpdate.mockRestore();
        }
        throw new Error("ROLLBACK_CREATE_CATEGORY");
      }),
    ).rejects.toThrow("ROLLBACK_CREATE_CATEGORY");

    expect(await db.select().from(categories)).toHaveLength(0);
    const [settings] = await db.select().from(appSettings);
    expect(settings).toMatchObject({ categoriesInitialized: false, categoryVersion: 0 });
  });

  it("keeps renameCategory inside a supplied caller transaction", async () => {
    const category = await createCategory({ name: "调用者旧名" });
    await expect(
      db.transaction(async (tx) => {
        const globalTransaction = vi.spyOn(db, "transaction");
        const globalInsert = vi.spyOn(db, "insert");
        const globalExecute = vi.spyOn(db, "execute");
        const globalUpdate = vi.spyOn(db, "update");
        try {
          await renameCategory(category.id, "调用者新名", tx);
          expect(globalTransaction).not.toHaveBeenCalled();
          expect(globalInsert).not.toHaveBeenCalled();
          expect(globalExecute).not.toHaveBeenCalled();
          expect(globalUpdate).not.toHaveBeenCalled();
        } finally {
          globalTransaction.mockRestore();
          globalInsert.mockRestore();
          globalExecute.mockRestore();
          globalUpdate.mockRestore();
        }
        throw new Error("ROLLBACK_RENAME_CATEGORY");
      }),
    ).rejects.toThrow("ROLLBACK_RENAME_CATEGORY");

    expect(await listCategories()).toEqual([expect.objectContaining({ name: "调用者旧名" })]);
    const [settings] = await db.select().from(appSettings);
    expect(settings.categoryVersion).toBe(1);
  });

  it("keeps deleteCategory and its impact query inside a supplied caller transaction", async () => {
    const category = await createCategory({ name: "调用者删除" });
    await db.insert(items).values({
      url: "https://example.com/rollback-delete",
      urlCanonical: "https://example.com/rollback-delete",
      type: "web",
      source: "admin",
      categoryId: category.id,
      categoryManual: true,
    });
    await expect(
      db.transaction(async (tx) => {
        const globalTransaction = vi.spyOn(db, "transaction");
        const globalInsert = vi.spyOn(db, "insert");
        const globalExecute = vi.spyOn(db, "execute");
        const globalDelete = vi.spyOn(db, "delete");
        const globalUpdate = vi.spyOn(db, "update");
        try {
          await expect(deleteCategory(category.id, tx)).resolves.toEqual({
            autoCount: 0,
            manualCount: 1,
          });
          expect(globalTransaction).not.toHaveBeenCalled();
          expect(globalInsert).not.toHaveBeenCalled();
          expect(globalExecute).not.toHaveBeenCalled();
          expect(globalDelete).not.toHaveBeenCalled();
          expect(globalUpdate).not.toHaveBeenCalled();
        } finally {
          globalTransaction.mockRestore();
          globalInsert.mockRestore();
          globalExecute.mockRestore();
          globalDelete.mockRestore();
          globalUpdate.mockRestore();
        }
        throw new Error("ROLLBACK_DELETE_CATEGORY");
      }),
    ).rejects.toThrow("ROLLBACK_DELETE_CATEGORY");

    expect(await listCategories()).toEqual([expect.objectContaining({ id: category.id })]);
    expect(await db.select().from(items)).toEqual([
      expect.objectContaining({ categoryId: category.id, categoryManual: true }),
    ]);
    const [settings] = await db.select().from(appSettings);
    expect(settings.categoryVersion).toBe(1);
  });

  it("uses a supplied transaction in getCategoryOverview instead of global execute", async () => {
    const category = await createCategory({ name: "事务概览" });
    const globalExecute = vi.spyOn(db, "execute");
    try {
      const result = await db.transaction((tx) => getCategoryOverview(tx));
      expect(result.categories).toEqual([expect.objectContaining({ id: category.id })]);
      expect(globalExecute).not.toHaveBeenCalled();
    } finally {
      globalExecute.mockRestore();
    }
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
