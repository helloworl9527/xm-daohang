// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import {
  appSettings,
  categories,
  categoryChangeRuns,
  categoryReclassifyFailures,
  categoryRunRetryRequests,
  items,
} from "@/db/schema";
import { applyCategoryDiff, CategoryApplyError, type ApplyCategoriesInput } from "@/lib/categories/apply";
import { createCategory, listCategories } from "@/lib/categories/store";

const REQUEST_A = "20000000-0000-4000-8000-000000000001";
const REQUEST_B = "20000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-11T05:00:00.000Z");

function input(overrides: Partial<ApplyCategoriesInput>): ApplyCategoriesInput {
  return {
    requestKey: REQUEST_A,
    mode: "full",
    baseVersion: 0,
    accepted: [],
    ignored: [],
    reclassifyAuto: false,
    ...overrides,
  };
}

function pgCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: string; cause?: unknown };
    if (candidate.code) return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

async function waitForCategoryLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await pool.query<{ waiting: string }>(`
      select count(*)::text as waiting
        from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
         and wait_event_type = 'Lock'
         and query ilike '%categories%for update%'
    `);
    if (Number(waiting.rows[0]?.waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for category row lock contention");
}

async function insertItem(
  suffix: string,
  overrides: Partial<typeof items.$inferInsert> = {},
) {
  const [item] = await db.insert(items).values({
    url: `https://example.com/${suffix}`,
    urlCanonical: `https://example.com/${suffix}`,
    type: "web",
    source: "admin",
    ...overrides,
  }).returning();
  return item!;
}

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Category apply tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(categoryRunRetryRequests);
  await db.delete(categoryReclassifyFailures);
  await db.delete(categoryChangeRuns);
  await db.delete(items);
  await db.delete(categories);
  await db.delete(appSettings);
  await db.insert(appSettings).values({ id: 1 });
});

afterAll(async () => {
  await pool.end();
});

describe("atomic category diff apply", () => {
  it("applies add, rename, merge, and delete topologically with server-derived effects", async () => {
    const keep = await createCategory({ name: "保留分类" });
    const mergeSource = await createCategory({ name: "合并来源" });
    const deleteSource = await createCategory({ name: "删除来源" });
    const mergedItem = await insertItem("merged", { categoryId: mergeSource.id });
    const unclassifiedItem = await insertItem("unclassified", { categoryId: deleteSource.id });
    const manualNull = await insertItem("manual-null", { categoryId: null, categoryManual: true });

    const result = await applyCategoryDiff(input({
      baseVersion: 3,
      accepted: [
        { kind: "add", proposalId: "new", name: "  人工智能  ", autoCount: 999, manualCount: 999 },
        { kind: "rename", proposalId: "rename", sourceCategoryId: keep.id, name: "核心工具" },
        {
          kind: "merge",
          proposalId: "merge",
          sourceCategoryId: mergeSource.id,
          target: { kind: "proposal", proposalId: "new" },
          autoDestination: { kind: "target", target: { kind: "proposal", proposalId: "new" } },
        },
        {
          kind: "delete",
          proposalId: "delete",
          sourceCategoryId: deleteSource.id,
          autoDestination: { kind: "unclassified" },
        },
      ],
      ignored: [{ kind: "add", proposalId: "ignored", name: "忽略分类", autoCount: 900 }],
    }), { now: () => NOW });

    expect(result).toMatchObject({
      status: "completed",
      baseVersion: 3,
      appliedVersion: 4,
      counts: { added: 1, renamed: 1, merged: 1, deleted: 1, ignored: 1 },
    });
    const remaining = await listCategories();
    const added = remaining.find((category) => category.name === "人工智能")!;
    expect(remaining.map((category) => category.name).sort()).toEqual(["人工智能", "核心工具"]);
    expect((await db.select().from(items).where(eq(items.id, mergedItem.id)))[0]).toMatchObject({
      categoryId: added.id,
      categoryManual: false,
    });
    expect((await db.select().from(items).where(eq(items.id, unclassifiedItem.id)))[0]).toMatchObject({
      categoryId: null,
      categoryManual: false,
    });
    expect((await db.select().from(items).where(eq(items.id, manualNull.id)))[0]).toMatchObject({
      categoryId: null,
      categoryManual: true,
    });
    const [run] = await db.select().from(categoryChangeRuns);
    expect(run).toMatchObject({ movedUnclassified: 1, manualProtected: 0, snapshotAt: NOW });
    expect(JSON.stringify(run?.accepted)).not.toContain("999");
    expect((await db.select().from(appSettings))[0]).toMatchObject({
      categoriesInitialized: true,
      categoryVersion: 4,
    });
  });

  it("fails the entire batch closed when a destructive source has any manual item", async () => {
    const source = await createCategory({ name: "人工来源" });
    const target = await createCategory({ name: "目标分类" });
    const manual = await insertItem("manual-source", { categoryId: source.id, categoryManual: true });
    const manualNull = await insertItem("manual-null-conflict", { categoryId: null, categoryManual: true });

    await expect(applyCategoryDiff(input({
      baseVersion: 2,
      accepted: [
        { kind: "add", proposalId: "must-rollback", name: "不得落库" },
        {
          kind: "merge",
          proposalId: "blocked",
          sourceCategoryId: source.id,
          target: { kind: "existing", categoryId: target.id },
          autoDestination: { kind: "target", target: { kind: "existing", categoryId: target.id } },
          autoCount: 0,
          manualCount: 0,
        },
      ],
    }))).rejects.toEqual(new CategoryApplyError("MANUAL_CATEGORY_CONFLICT"));

    expect((await listCategories()).map((category) => category.name).sort()).toEqual(["人工来源", "目标分类"]);
    expect(await db.select().from(categoryChangeRuns)).toHaveLength(0);
    expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(2);
    expect((await db.select().from(items).where(eq(items.id, manual.id)))[0]).toMatchObject({
      categoryId: source.id,
      categoryManual: true,
    });
    expect((await db.select().from(items).where(eq(items.id, manualNull.id)))[0]).toMatchObject({
      categoryId: null,
      categoryManual: true,
    });
  });

  it("locks destructive source items through the conflict check and apply", async () => {
    const source = await createCategory({ name: "锁定来源" });
    const target = await createCategory({ name: "锁定目标" });
    const item = await insertItem("locked-source", { categoryId: source.id });
    let reportLocked!: () => void;
    let releaseApply!: () => void;
    const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseApply = resolve; });
    const applying = applyCategoryDiff(input({
      baseVersion: 2,
      accepted: [{
        kind: "merge",
        proposalId: "locked-merge",
        sourceCategoryId: source.id,
        target: { kind: "existing", categoryId: target.id },
        autoDestination: { kind: "target", target: { kind: "existing", categoryId: target.id } },
      }],
    }), {
      afterImpactLock: async () => {
        reportLocked();
        await release;
      },
    });
    await locked;

    const client = await pool.connect();
    let concurrentError: unknown;
    try {
      await client.query("begin");
      await client.query("set local lock_timeout = '100ms'");
      await client.query("update items set category_manual = true where id = $1", [item.id]);
    } catch (error) {
      concurrentError = error;
    } finally {
      await client.query("rollback");
      client.release();
      releaseApply();
    }
    expect(pgCode(concurrentError)).toBe("55P03");
    await expect(applying).resolves.toMatchObject({ status: "completed" });
  });

  it.each(["merge", "delete"] as const)(
    "rechecks a concurrent manual NULL assignment before destructive %s and rolls back the batch",
    async (kind) => {
      const source = await createCategory({ name: `并发${kind}来源` });
      const target = await createCategory({ name: `并发${kind}目标` });
      const manualNull = await insertItem(`concurrent-manual-null-${kind}`, {
        categoryId: null,
        categoryManual: true,
      });
      const client = await pool.connect();
      let transactionOpen = false;
      let applying: Promise<Awaited<ReturnType<typeof applyCategoryDiff>>> | undefined;
      try {
        await client.query("begin");
        transactionOpen = true;
        await client.query("update items set category_id = $1 where id = $2", [source.id, manualNull.id]);

        let settled = false;
        applying = applyCategoryDiff(input({
          baseVersion: 2,
          accepted: [
            { kind: "add", proposalId: `rollback-${kind}`, name: `回滚${kind}新增` },
            kind === "merge"
              ? {
                  kind: "merge",
                  proposalId: "concurrent-merge",
                  sourceCategoryId: source.id,
                  target: { kind: "existing", categoryId: target.id },
                  autoDestination: { kind: "target", target: { kind: "existing", categoryId: target.id } },
                }
              : {
                  kind: "delete",
                  proposalId: "concurrent-delete",
                  sourceCategoryId: source.id,
                  autoDestination: { kind: "unclassified" },
                },
          ],
        })).finally(() => { settled = true; });

        await waitForCategoryLockWait();
        expect(settled).toBe(false);
        await client.query("commit");
        transactionOpen = false;
        await expect(applying).rejects.toEqual(new CategoryApplyError("MANUAL_CATEGORY_CONFLICT"));
      } finally {
        if (transactionOpen) await client.query("rollback").catch(() => undefined);
        client.release();
        await applying?.catch(() => undefined);
      }

      expect((await listCategories()).map((category) => category.name).sort()).toEqual([
        `并发${kind}来源`,
        `并发${kind}目标`,
      ].sort());
      expect(await db.select().from(categoryChangeRuns)).toHaveLength(0);
      expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(2);
      expect((await db.select().from(items).where(eq(items.id, manualNull.id)))[0]).toMatchObject({
        categoryId: source.id,
        categoryManual: true,
      });
    },
  );

  it.each(["merge", "delete"] as const)(
    "fails destructive %s closed when a manual NULL assignment commits after impact scan",
    async (kind) => {
      const source = await createCategory({ name: `扫描后${kind}来源` });
      const target = await createCategory({ name: `扫描后${kind}目标` });
      const manualNull = await insertItem(`post-scan-manual-null-${kind}`, {
        categoryId: null,
        categoryManual: true,
      });
      let reportLocked!: () => void;
      let releaseApply!: () => void;
      const locked = new Promise<void>((resolve) => { reportLocked = resolve; });
      const release = new Promise<void>((resolve) => { releaseApply = resolve; });
      const applying = applyCategoryDiff(input({
        baseVersion: 2,
        accepted: [
          { kind: "add", proposalId: `post-scan-rollback-${kind}`, name: `扫描后回滚${kind}` },
          kind === "merge"
            ? {
                kind: "merge",
                proposalId: "post-scan-merge",
                sourceCategoryId: source.id,
                target: { kind: "existing", categoryId: target.id },
                autoDestination: { kind: "target", target: { kind: "existing", categoryId: target.id } },
              }
            : {
                kind: "delete",
                proposalId: "post-scan-delete",
                sourceCategoryId: source.id,
                autoDestination: { kind: "unclassified" },
              },
        ],
      }), {
        afterImpactLock: async () => {
          reportLocked();
          await release;
        },
      });
      await locked;
      await pool.query("update items set category_id = $1 where id = $2", [source.id, manualNull.id]);
      releaseApply();

      await expect(applying).rejects.toEqual(new CategoryApplyError("MANUAL_CATEGORY_CONFLICT"));
      expect((await listCategories()).map((category) => category.name).sort()).toEqual([
        `扫描后${kind}来源`,
        `扫描后${kind}目标`,
      ].sort());
      expect(await db.select().from(categoryChangeRuns)).toHaveLength(0);
      expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(2);
      expect((await db.select().from(items).where(eq(items.id, manualNull.id)))[0]).toMatchObject({
        categoryId: source.id,
        categoryManual: true,
      });
    },
  );

  it("allows rename with manual items and never changes their category", async () => {
    const category = await createCategory({ name: "人工保留" });
    const manual = await insertItem("manual-rename", { categoryId: category.id, categoryManual: true });
    await applyCategoryDiff(input({
      baseVersion: 1,
      accepted: [{
        kind: "rename",
        proposalId: "rename-manual",
        sourceCategoryId: category.id,
        name: "人工保留新名",
      }],
    }));
    expect((await db.select().from(items).where(eq(items.id, manual.id)))[0]).toMatchObject({
      categoryId: category.id,
      categoryManual: true,
    });
  });

  it("returns the same run for a repeated request key and rejects a different stale key", async () => {
    const applyInput = input({
      accepted: [{ kind: "add", proposalId: "once", name: "只新增一次" }],
    });
    const [first, duplicate] = await Promise.all([
      applyCategoryDiff(applyInput),
      applyCategoryDiff(applyInput),
    ]);
    expect(duplicate).toEqual(first);
    expect(await db.select().from(categories)).toHaveLength(1);
    expect(await db.select().from(categoryChangeRuns)).toHaveLength(1);
    expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(1);

    await expect(applyCategoryDiff({ ...applyInput, requestKey: REQUEST_B }))
      .rejects.toEqual(new CategoryApplyError("STALE_TAXONOMY"));
  });

  it("maps normalized name conflicts without advancing version or persisting a run", async () => {
    await createCategory({ name: "重复分类" });
    await expect(applyCategoryDiff(input({
      baseVersion: 1,
      accepted: [{ kind: "add", proposalId: "duplicate", name: "  重复分类  " }],
    }))).rejects.toEqual(new CategoryApplyError("DUPLICATE_CATEGORY"));
    expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(1);
    expect(await db.select().from(categoryChangeRuns)).toHaveLength(0);
  });

  it("rejects destinations that are missing or removed in the same batch without partial writes", async () => {
    const source = await createCategory({ name: "来源" });
    const doomedTarget = await createCategory({ name: "同批删除目标" });
    await insertItem("source-auto", { categoryId: source.id });
    await expect(applyCategoryDiff(input({
      baseVersion: 2,
      accepted: [
        { kind: "add", proposalId: "rollback-add", name: "必须回滚新增" },
        {
          kind: "delete",
          proposalId: "source-delete",
          sourceCategoryId: source.id,
          autoDestination: { kind: "target", target: { kind: "existing", categoryId: doomedTarget.id } },
        },
        {
          kind: "delete",
          proposalId: "target-delete",
          sourceCategoryId: doomedTarget.id,
          autoDestination: { kind: "unclassified" },
        },
      ],
    }))).rejects.toEqual(new CategoryApplyError("VALIDATION"));
    expect(await listCategories()).toHaveLength(2);
    expect((await listCategories()).map((category) => category.name).sort()).toEqual(["同批删除目标", "来源"]);
    expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(2);
  });

  it("keeps every apply helper on the supplied transaction", async () => {
    const globalInsert = vi.spyOn(db, "insert");
    const globalSelect = vi.spyOn(db, "select");
    const globalUpdate = vi.spyOn(db, "update");
    const globalDelete = vi.spyOn(db, "delete");
    const globalExecute = vi.spyOn(db, "execute");
    try {
      await applyCategoryDiff(input({
        accepted: [{ kind: "add", proposalId: "tx", name: "事务分类" }],
      }));
      expect(globalInsert).not.toHaveBeenCalled();
      expect(globalSelect).not.toHaveBeenCalled();
      expect(globalUpdate).not.toHaveBeenCalled();
      expect(globalDelete).not.toHaveBeenCalled();
      expect(globalExecute).not.toHaveBeenCalled();
    } finally {
      globalInsert.mockRestore();
      globalSelect.mockRestore();
      globalUpdate.mockRestore();
      globalDelete.mockRestore();
      globalExecute.mockRestore();
    }
  });

  it("commits a recoverable reclassifying run before publishing and survives publisher failure", async () => {
    const publish = vi.fn(async ({ runId }: { runId: string }) => {
      expect((await db.select().from(categoryChangeRuns).where(eq(categoryChangeRuns.id, runId)))[0])
        .toMatchObject({ status: "reclassifying", appliedVersion: 1 });
      expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(1);
      throw new Error("queue unavailable");
    });
    const result = await applyCategoryDiff(input({
      accepted: [{ kind: "add", proposalId: "async", name: "后台分类" }],
      reclassifyAuto: true,
    }), { publish });
    expect(result).toMatchObject({ status: "reclassifying", reclassifyGeneration: 0 });
    expect(publish).toHaveBeenCalledWith({ runId: result.id, generation: 0 });
  });

  it("supersedes older reclassifying runs in the same taxonomy transaction", async () => {
    const older = await applyCategoryDiff(input({
      accepted: [{ kind: "add", proposalId: "older", name: "旧代分类" }],
      reclassifyAuto: true,
    }));
    await applyCategoryDiff(input({
      requestKey: REQUEST_B,
      baseVersion: 1,
      accepted: [{ kind: "add", proposalId: "newer", name: "新代分类" }],
    }));
    expect((await db.select().from(categoryChangeRuns).where(eq(categoryChangeRuns.id, older.id)))[0])
      .toMatchObject({ status: "superseded", completedAt: expect.any(Date) });
    expect((await db.select().from(appSettings))[0]?.categoryVersion).toBe(2);
  });

  it("rejects destructive accepted diffs in supplement mode", async () => {
    const source = await createCategory({ name: "补充来源" });
    await expect(applyCategoryDiff(input({
      mode: "supplement",
      baseVersion: 1,
      accepted: [{
        kind: "delete",
        proposalId: "not-add",
        sourceCategoryId: source.id,
        autoDestination: { kind: "unclassified" },
      }],
    }))).rejects.toEqual(new CategoryApplyError("VALIDATION"));
  });
});
