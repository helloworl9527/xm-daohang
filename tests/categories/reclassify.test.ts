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
import { applyCategoryDiff } from "@/lib/categories/apply";
import {
  CATEGORY_RECLASSIFY_QUEUE,
  CategoryRunError,
  getCategoryRun,
  publishPendingCategoryReclassifications,
  requestCategoryRunRetry,
} from "@/lib/categories/reclassify";
import { createCategory } from "@/lib/categories/store";
import { reclassifyCategoriesJob } from "@/worker/jobs/reclassifyCategories";

const NOW = new Date("2026-08-11T06:00:00.000Z");
const RETRY_A = "30000000-0000-4000-8000-000000000001";
const RETRY_B = "30000000-0000-4000-8000-000000000002";

async function insertCompleted(
  suffix: string,
  overrides: Partial<typeof items.$inferInsert> = {},
) {
  const [item] = await db.insert(items).values({
    url: `https://example.com/reclassify-${suffix}`,
    urlCanonical: `https://example.com/reclassify-${suffix}`,
    type: "web",
    source: "admin",
    status: "completed",
    title: suffix,
    summary: `摘要-${suffix}`,
    tags: ["标签一", "标签二", "标签三"],
    createdAt: new Date(NOW.getTime() - 1_000),
    ...overrides,
  }).returning();
  return item!;
}

async function createRun(options: { baseVersion?: number } = {}) {
  return applyCategoryDiff({
    requestKey: crypto.randomUUID(),
    mode: "full",
    baseVersion: options.baseVersion ?? 0,
    accepted: options.baseVersion
      ? []
      : [{ kind: "add", proposalId: "target", name: "自动目标" }],
    ignored: [],
    reclassifyAuto: true,
  }, { now: () => NOW });
}

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Category reclassify tests require the dedicated collection_system_test database");
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

describe("persistent automatic category reclassification", () => {
  it("reclassifies only snapshot-eligible automatic items and derives completion counts", async () => {
    const selected = await insertCompleted("selected");
    const unclassified = await insertCompleted("unclassified");
    const manualNull = await insertCompleted("manual-null", { categoryManual: true, categoryId: null });
    const doc = await insertCompleted("doc", { type: "doc" });
    const run = await createRun();
    const [target] = await db.select().from(categories);
    const classify = vi.fn(async ({ title }: { title: string | null }) => title === "selected"
      ? { outcome: "selected" as const, categoryId: target!.id, confidence: 0.9 }
      : { outcome: "unclassified" as const, confidence: 0.8 });

    await expect(reclassifyCategoriesJob({ runId: run.id, generation: 0 }, { classify }))
      .resolves.toBe("completed");
    expect(classify).toHaveBeenCalledTimes(2);
    expect((await db.select().from(items).where(eq(items.id, selected.id)))[0]?.categoryId).toBe(target!.id);
    expect((await db.select().from(items).where(eq(items.id, unclassified.id)))[0]?.categoryId).toBeNull();
    expect((await db.select().from(items).where(eq(items.id, manualNull.id)))[0]).toMatchObject({
      categoryId: null,
      categoryManual: true,
    });
    expect((await db.select().from(items).where(eq(items.id, doc.id)))[0]?.categoryId).toBeNull();
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({
      status: "completed",
      reclassified: 1,
      movedUnclassified: 1,
      failedCount: 0,
    });
  });

  it("keeps old categories on AI failures and derives partial state from stable failure rows", async () => {
    const old = await createCategory({ name: "旧分类" });
    const invalid = await insertCompleted("invalid", { categoryId: old.id });
    const upstream = await insertCompleted("upstream", { categoryId: old.id });
    const run = await createRun({ baseVersion: 1 });
    const classify = vi.fn(async ({ title }: { title: string | null }) => title === "invalid"
      ? { outcome: "invalid_output" as const }
      : { outcome: "upstream_error" as const });

    await expect(reclassifyCategoriesJob({ runId: run.id, generation: 0 }, { classify }))
      .resolves.toBe("partial");
    expect((await db.select().from(items).where(eq(items.id, invalid.id)))[0]?.categoryId).toBe(old.id);
    expect((await db.select().from(items).where(eq(items.id, upstream.id)))[0]?.categoryId).toBe(old.id);
    expect(await db.select().from(categoryReclassifyFailures)).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: invalid.id, errorCode: "AI_OUTPUT_INVALID", attempts: 1 }),
      expect.objectContaining({ itemId: upstream.id, errorCode: "AI_UPSTREAM_FAILED", attempts: 1 }),
    ]));
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({ status: "partial", failedCount: 2 });
  });

  it("turns an injected unknown selected candidate into AI_OUTPUT_INVALID", async () => {
    const old = await createCategory({ name: "未知候选旧分类" });
    const item = await insertCompleted("unknown-candidate", { categoryId: old.id });
    const run = await createRun({ baseVersion: 1 });
    await expect(reclassifyCategoriesJob({ runId: run.id, generation: 0 }, {
      classify: async () => ({
        outcome: "selected",
        categoryId: "40000000-0000-4000-8000-000000000099",
        confidence: 0.9,
      }),
    })).resolves.toBe("partial");
    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]?.categoryId).toBe(old.id);
    expect(await db.select().from(categoryReclassifyFailures)).toEqual([
      expect.objectContaining({ itemId: item.id, errorCode: "AI_OUTPUT_INVALID" }),
    ]);
  });

  it("makes retry request keys permanent, rejects a second active key, and clears failures on success", async () => {
    const item = await insertCompleted("retry");
    const run = await createRun();
    await reclassifyCategoriesJob({ runId: run.id, generation: 0 }, {
      classify: async () => ({ outcome: "upstream_error" }),
    });
    const publish = vi.fn(async () => undefined);

    const first = await requestCategoryRunRetry(run.id, RETRY_A, { publish });
    const duplicate = await requestCategoryRunRetry(run.id, RETRY_A, { publish });
    expect(first).toEqual({ runId: run.id, generation: 1, status: "reclassifying" });
    expect(duplicate).toEqual(first);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(requestCategoryRunRetry(run.id, RETRY_B))
      .rejects.toEqual(new CategoryRunError("VALIDATION"));

    const [target] = await db.select().from(categories);
    await expect(reclassifyCategoriesJob({ runId: run.id, generation: 1 }, {
      classify: async () => ({ outcome: "selected", categoryId: target!.id, confidence: 0.9 }),
    })).resolves.toBe("completed");
    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]?.categoryId).toBe(target!.id);
    expect(await db.select().from(categoryReclassifyFailures)).toHaveLength(0);
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({ status: "completed", failedCount: 0 });
    await expect(requestCategoryRunRetry(run.id, RETRY_A, { publish })).resolves.toMatchObject({ generation: 1 });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("increments attempts without caching or double-counting failures", async () => {
    await insertCompleted("repeat-failure");
    const run = await createRun();
    const fail = async () => ({ outcome: "invalid_output" as const });
    await reclassifyCategoriesJob({ runId: run.id, generation: 0 }, { classify: fail });
    await requestCategoryRunRetry(run.id, RETRY_A);
    await reclassifyCategoriesJob({ runId: run.id, generation: 1 }, { classify: fail });
    expect(await db.select().from(categoryReclassifyFailures)).toEqual([
      expect.objectContaining({ attempts: 2, errorCode: "AI_OUTPUT_INVALID" }),
    ]);
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({ failedCount: 1, status: "partial" });
  });

  it("rejects retry when a newer taxonomy version has superseded the run", async () => {
    await insertCompleted("stale-retry");
    const run = await createRun();
    await reclassifyCategoriesJob({ runId: run.id, generation: 0 }, {
      classify: async () => ({ outcome: "upstream_error" }),
    });
    await createCategory({ name: "更新分类体系" });
    await expect(requestCategoryRunRetry(run.id, RETRY_A))
      .rejects.toEqual(new CategoryRunError("STALE_TAXONOMY"));
    expect(await db.select().from(categoryRunRetryRequests)).toHaveLength(0);
  });

  it("resolves a failure without another model call after an administrator chooses manual NULL", async () => {
    const item = await insertCompleted("manual-resolution");
    const run = await createRun();
    await reclassifyCategoriesJob({ runId: run.id, generation: 0 }, {
      classify: async () => ({ outcome: "upstream_error" }),
    });
    await db.update(items).set({ categoryManual: true, categoryId: null }).where(eq(items.id, item.id));
    await requestCategoryRunRetry(run.id, RETRY_A);
    const classify = vi.fn();
    await expect(reclassifyCategoriesJob({ runId: run.id, generation: 1 }, { classify }))
      .resolves.toBe("completed");
    expect(classify).not.toHaveBeenCalled();
    expect(await db.select().from(categoryReclassifyFailures)).toHaveLength(0);
    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
      categoryManual: true,
      categoryId: null,
    });
  });

  it("does not overwrite an item changed to manual NULL while inference is running", async () => {
    const item = await insertCompleted("manual-race");
    const run = await createRun();
    const [target] = await db.select().from(categories);
    let release!: (value: { outcome: "selected"; categoryId: string; confidence: number }) => void;
    let started!: () => void;
    const inferenceStarted = new Promise<void>((resolve) => { started = resolve; });
    const classify = vi.fn(() => new Promise<{ outcome: "selected"; categoryId: string; confidence: number }>((resolve) => {
      release = resolve;
      started();
    }));
    const processing = reclassifyCategoriesJob({ runId: run.id, generation: 0 }, { classify });
    await inferenceStarted;
    await db.update(items).set({ categoryManual: true, categoryId: null }).where(eq(items.id, item.id));
    release({ outcome: "selected", categoryId: target!.id, confidence: 0.9 });
    await expect(processing).resolves.toBe("completed");
    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
      categoryManual: true,
      categoryId: null,
    });
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({
      reclassified: 0,
      movedUnclassified: 0,
      failedCount: 0,
    });
  });

  it("calls the classifier only after snapshot transactions have closed", async () => {
    await insertCompleted("transaction-boundary");
    const run = await createRun();
    const [target] = await db.select().from(categories);
    const originalTransaction = db.transaction.bind(db);
    let activeTransactions = 0;
    const transaction = vi.spyOn(db, "transaction");
    transaction.mockImplementation(((operation: unknown, config?: unknown) =>
      originalTransaction(async (tx) => {
        activeTransactions += 1;
        try {
          return await (operation as (queryable: typeof tx) => Promise<unknown>)(tx);
        } finally {
          activeTransactions -= 1;
        }
      }, config as never)) as typeof db.transaction);
    try {
      await expect(reclassifyCategoriesJob({ runId: run.id, generation: 0 }, {
        classify: async () => {
          expect(activeTransactions).toBe(0);
          return { outcome: "selected", categoryId: target!.id, confidence: 0.9 };
        },
      })).resolves.toBe("completed");
    } finally {
      transaction.mockRestore();
    }
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({ reclassified: 1 });
  });

  it("supersedes stale work when taxonomy changes during inference", async () => {
    const item = await insertCompleted("version-race");
    const run = await createRun();
    const [target] = await db.select().from(categories);
    let release!: (value: { outcome: "selected"; categoryId: string; confidence: number }) => void;
    let started!: () => void;
    const inferenceStarted = new Promise<void>((resolve) => { started = resolve; });
    const processing = reclassifyCategoriesJob({ runId: run.id, generation: 0 }, {
      classify: () => new Promise((resolve) => {
        release = resolve;
        started();
      }),
    });
    await inferenceStarted;
    const client = await pool.connect();
    try {
      await client.query("set lock_timeout = '250ms'");
      await client.query("update app_settings set category_version = category_version + 1 where id = 1");
    } finally {
      client.release();
    }
    release({ outcome: "selected", categoryId: target!.id, confidence: 0.9 });
    await expect(processing).resolves.toBe("superseded");
    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]?.categoryId).toBeNull();
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({ status: "superseded" });
  });

  it("resumes from the persistent cursor after a worker interruption without recounting", async () => {
    await db.insert(items).values(Array.from({ length: 41 }, (_, index) => ({
      url: `https://example.com/restart-${index}`,
      urlCanonical: `https://example.com/restart-${index}`,
      type: "web",
      source: "admin",
      status: "completed",
      title: `restart-${index}`,
      summary: `摘要-${index}`,
      tags: ["标签一", "标签二", "标签三"],
      createdAt: new Date(NOW.getTime() - 2_000 + index),
    })));
    const run = await createRun();
    const [target] = await db.select().from(categories);
    const classify = vi.fn(async () => ({
      outcome: "selected" as const,
      categoryId: target!.id,
      confidence: 0.9,
    }));
    let committed = 0;
    await expect(reclassifyCategoriesJob({ runId: run.id, generation: 0 }, {
      classify,
      afterItem: async () => {
        committed += 1;
        if (committed === 3) throw new Error("worker stopped");
      },
    })).rejects.toThrow("worker stopped");
    await expect(reclassifyCategoriesJob({ runId: run.id, generation: 0 }, { classify }))
      .resolves.toBe("completed");
    expect(classify).toHaveBeenCalledTimes(41);
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({ reclassified: 41, failedCount: 0 });
  });

  it("does not double-count a duplicate delivery of the same generation", async () => {
    await insertCompleted("duplicate-delivery");
    const run = await createRun();
    const [target] = await db.select().from(categories);
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const classify = vi.fn(async () => {
      started += 1;
      if (started === 2) release();
      await bothStarted;
      return { outcome: "selected" as const, categoryId: target!.id, confidence: 0.9 };
    });

    await expect(Promise.all([
      reclassifyCategoriesJob({ runId: run.id, generation: 0 }, { classify }),
      reclassifyCategoriesJob({ runId: run.id, generation: 0 }, { classify }),
    ])).resolves.toEqual(["completed", "completed"]);
    expect(classify).toHaveBeenCalledTimes(2);
    await expect(getCategoryRun(run.id)).resolves.toMatchObject({ reclassified: 1, failedCount: 0 });
  });

  it("publishes only reclassifying runs with stable singleton keys", async () => {
    const run = await createRun();
    const send = vi.fn(async () => "job-id");
    await expect(publishPendingCategoryReclassifications({ send })).resolves.toBe(1);
    expect(send).toHaveBeenCalledWith(CATEGORY_RECLASSIFY_QUEUE, {
      runId: run.id,
      generation: 0,
    }, {
      singletonKey: `category-reclassify:${run.id}:0`,
      retryLimit: 0,
    });
  });
});
