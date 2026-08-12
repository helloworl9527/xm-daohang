// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import {
  appSettings,
  categories,
  items,
  processingRequests,
  telegramReceipts,
} from "@/db/schema";
import type { CategoryCandidate, ClassificationOutcome } from "@/lib/categories/classify";
import { upsertItem } from "@/lib/items/dedupe";
import { requestProcessing } from "@/lib/items/processing";
import { logger } from "@/lib/log/logger";
import { createBoss, ensureProcessingQueue, PROCESS_ITEM_QUEUE } from "@/lib/queue/boss";
import { processItemJob, reconcileEmbeddingRebuild } from "@/worker/jobs/processItem";
import { publishPendingRequests, type ProcessingBoss } from "@/worker/queue/requestPublisher";

const VECTOR = [0.1, 0.2, 0.3];

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Process item tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(telegramReceipts);
  await db.delete(processingRequests);
  await db.delete(items);
  await db.delete(categories);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    embVersion: 1,
    embDim: 3,
    embRebuildStatus: "ready",
  });
});

afterAll(async () => {
  await pool.query("drop schema if exists pgboss cascade");
  await pool.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function insertItem(overrides: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    url: `https://example.com/${crypto.randomUUID()}`,
    urlCanonical: `https://example.com/${crypto.randomUUID()}`,
    type: "web",
    source: "admin",
    status: "completed",
    summary: "旧总结第一句。旧总结第二句。",
    tags: ["旧标签一", "旧标签二", "旧标签三"],
    embedding: VECTOR,
    embeddingDim: 3,
    embeddingVersion: 1,
    contentHash: "old-hash",
    ...overrides,
  }).returning();
  return item;
}

function successfulDependencies(content = "new content") {
  return {
    fetchContent: vi.fn(async () => ({ title: "New title", content })),
    summarize: vi.fn(async () => ({
      summary: "新总结第一句。新总结第二句。",
      tags: ["新标签一", "新标签二", "新标签三"],
    })),
    embed: vi.fn(async () => VECTOR),
    loadTaxonomy: vi.fn(async () => ({
      initialized: false,
      version: 0,
      categories: [] as CategoryCandidate[],
    })),
    classify: vi.fn(async (): Promise<ClassificationOutcome> => ({
      outcome: "unclassified",
      confidence: 1,
    })),
    retryDelayMs: () => 0,
  };
}

async function insertCategory(name: string) {
  const [category] = await db.insert(categories).values({ name, slug: `cat-${crypto.randomUUID()}` })
    .returning();
  return category;
}

async function currentRequest(itemId: string, generation: number, attempt: number) {
  const [request] = await db.select().from(processingRequests).where(and(
    eq(processingRequests.itemId, itemId),
    eq(processingRequests.processGeneration, generation),
    eq(processingRequests.attempt, attempt),
  ));
  return request;
}

describe("processing request state machine", () => {
  it("processes a new generation to completed and atomically completes its receipt", async () => {
    const item = await insertItem({ status: "failed", embedding: null, embeddingDim: null, embeddingVersion: null, tags: [] });
    const generation = await requestProcessing(item.id, {
      receipt: { chatIdHash: "chat-hash", chatIdEnc: "encrypted-chat" },
    });
    const dependencies = successfulDependencies();

    await expect(processItemJob({ itemId: item.id, processGeneration: generation, embVersion: 1, attempt: 0 }, dependencies))
      .resolves.toEqual({ claimed: true, outcome: "completed" });

    const [saved] = await db.select().from(items).where(eq(items.id, item.id));
    expect(saved).toMatchObject({
      status: "completed",
      title: "New title",
      summary: "新总结第一句。新总结第二句。",
      tags: ["新标签一", "新标签二", "新标签三"],
      embeddingVersion: 1,
      failReason: null,
    });
    expect((await currentRequest(item.id, generation, 0))?.status).toBe("done");
    const [receipt] = await db.select().from(telegramReceipts);
    expect(receipt).toMatchObject({ outcome: "completed", status: "ready" });
  });

  it("creates attempts 1 through 3 and marks failed only after all four attempts fail", async () => {
    const item = await insertItem({ status: "failed" });
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();
    dependencies.fetchContent.mockRejectedValue(new Error("untrusted upstream body"));

    for (let attempt = 0; attempt <= 3; attempt += 1) {
      await processItemJob({ itemId: item.id, processGeneration: generation, embVersion: 1, attempt }, dependencies);
      const [saved] = await db.select().from(items).where(eq(items.id, item.id));
      expect(saved.status).toBe(attempt === 3 ? "failed" : "processing");
    }
    const requests = await db.select().from(processingRequests).where(eq(processingRequests.itemId, item.id));
    expect(requests.map((request) => request.attempt)).toEqual([0, 1, 2, 3]);
    expect(requests.every((request) => request.status === "failed")).toBe(true);
    expect(requests[3].lastErrorCode).toBe("PROCESSING_UPSTREAM_FAILED");
  });

  it("allows only one concurrent handler claim after a duplicate delivery", async () => {
    const item = await insertItem({ status: "failed" });
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();

    const results = await Promise.all([
      processItemJob({ itemId: item.id, processGeneration: generation, embVersion: 1, attempt: 0 }, dependencies),
      processItemJob({ itemId: item.id, processGeneration: generation, embVersion: 1, attempt: 0 }, dependencies),
    ]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(dependencies.summarize).toHaveBeenCalledOnce();
    expect(dependencies.embed).toHaveBeenCalledOnce();
  });

  it("rechecks GitHub backoff after queueing and before fetch without delaying web", async () => {
    const now = new Date("2026-08-09T04:00:00.000Z");
    const retryAt = new Date(now.getTime() + 30 * 60 * 1_000);
    const github = await insertItem({ type: "github", status: "failed" });
    const githubGeneration = await requestProcessing(github.id);
    await db.update(processingRequests).set({ status: "queued" }).where(eq(processingRequests.itemId, github.id));
    await db.update(appSettings).set({ githubBackoffUntil: retryAt }).where(eq(appSettings.id, 1));
    const githubDependencies = { ...successfulDependencies(), now: () => now };

    await expect(processItemJob({
      itemId: github.id,
      processGeneration: githubGeneration,
      embVersion: 1,
      attempt: 0,
    }, githubDependencies)).resolves.toEqual({ claimed: true, outcome: "deferred" });
    expect(githubDependencies.fetchContent).not.toHaveBeenCalled();
    expect(await currentRequest(github.id, githubGeneration, 0)).toMatchObject({
      status: "pending",
      nextAttemptAt: retryAt,
    });
    const [githubSaved] = await db.select().from(items).where(eq(items.id, github.id));
    expect(githubSaved.status).toBe("processing");

    const web = await insertItem({ type: "web", status: "failed" });
    const webGeneration = await requestProcessing(web.id);
    await db.update(processingRequests).set({ status: "queued" }).where(eq(processingRequests.itemId, web.id));
    const webDependencies = { ...successfulDependencies(), now: () => now };
    await expect(processItemJob({
      itemId: web.id,
      processGeneration: webGeneration,
      embVersion: 1,
      attempt: 0,
    }, webDependencies)).resolves.toMatchObject({ outcome: "completed" });
    expect(webDependencies.fetchContent).toHaveBeenCalledOnce();
  });

  it("recovers publisher crashes before and after send using the outbox and singleton key", async () => {
    const item = await insertItem({ status: "failed" });
    const generation = await requestProcessing(item.id);
    const sends: string[] = [];
    const boss: ProcessingBoss = {
      send: vi.fn(async (_name, _payload, options) => {
        sends.push(options.singletonKey);
        return sends.length === 1 ? "job-id" : null;
      }),
    };

    await expect(publishPendingRequests(boss, { afterSend: async () => { throw new Error("crash"); } }))
      .rejects.toThrow("crash");
    expect((await currentRequest(item.id, generation, 0))?.status).toBe("pending");

    await publishPendingRequests(boss);
    expect(sends).toEqual([
      `${item.id}:${generation}:0`,
      `${item.id}:${generation}:0`,
    ]);
    expect((await currentRequest(item.id, generation, 0))?.status).toBe("queued");
  });

  it("does not call external services or overwrite for stale generation/version and deleted items", async () => {
    const staleGeneration = await insertItem({ status: "failed" });
    const generation = await requestProcessing(staleGeneration.id);
    await db.update(items).set({ processGeneration: generation + 1 }).where(eq(items.id, staleGeneration.id));
    const dependencies = successfulDependencies();
    await expect(processItemJob({ itemId: staleGeneration.id, processGeneration: generation, embVersion: 1, attempt: 0 }, dependencies))
      .resolves.toMatchObject({ claimed: false });

    const staleVersion = await insertItem({ status: "failed" });
    const versionGeneration = await requestProcessing(staleVersion.id);
    await db.update(appSettings).set({ embVersion: 2 }).where(eq(appSettings.id, 1));
    await expect(processItemJob({ itemId: staleVersion.id, processGeneration: versionGeneration, embVersion: 1, attempt: 0 }, dependencies))
      .resolves.toMatchObject({ claimed: false });

    const deleted = await insertItem({ status: "failed" });
    const deletedGeneration = await requestProcessing(deleted.id);
    await db.delete(items).where(eq(items.id, deleted.id));
    await expect(processItemJob({ itemId: deleted.id, processGeneration: deletedGeneration, embVersion: 2, attempt: 0 }, dependencies))
      .resolves.toMatchObject({ claimed: false });
    expect(dependencies.fetchContent).not.toHaveBeenCalled();
  });

  it("preserves unchanged generated fields, but re-embeds unchanged content for a new model version", async () => {
    const content = "same content";
    const { fingerprintContent } = await import("@/lib/fetch/fingerprint");
    const hash = fingerprintContent({ title: "New title", content });
    const sameVersion = await insertItem({ contentHash: hash, status: "failed" });
    const generation = await requestProcessing(sameVersion.id);
    const dependencies = successfulDependencies(content);
    await processItemJob({ itemId: sameVersion.id, processGeneration: generation, embVersion: 1, attempt: 0 }, dependencies);
    expect(dependencies.summarize).not.toHaveBeenCalled();
    expect(dependencies.embed).not.toHaveBeenCalled();

    await db.update(appSettings).set({ embVersion: 2, embRebuildStatus: "building" }).where(eq(appSettings.id, 1));
    const newVersion = await insertItem({ contentHash: hash, status: "failed", embeddingVersion: 1 });
    const newGeneration = await requestProcessing(newVersion.id);
    const rebuilding = successfulDependencies(content);
    await processItemJob({ itemId: newVersion.id, processGeneration: newGeneration, embVersion: 2, attempt: 0 }, rebuilding);
    expect(rebuilding.summarize).not.toHaveBeenCalled();
    expect(rebuilding.embed).toHaveBeenCalledOnce();
  });

  it("keeps a manual summary when changed content refreshes title, tags, and embedding", async () => {
    const item = await insertItem({ summaryManual: true, status: "failed" });
    const oldSummary = item.summary;
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();
    await processItemJob({ itemId: item.id, processGeneration: generation, embVersion: 1, attempt: 0 }, dependencies);

    const [saved] = await db.select().from(items).where(eq(items.id, item.id));
    expect(saved.summary).toBe(oldSummary);
    expect(saved.tags).toEqual(["新标签一", "新标签二", "新标签三"]);
    expect(dependencies.embed).toHaveBeenCalledWith(oldSummary);
  });

  it("classifies an initialized web item and completes its Telegram receipt atomically", async () => {
    const category = await insertCategory("数据库");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 4 })
      .where(eq(appSettings.id, 1));
    const item = await insertItem({ status: "failed", categoryId: null });
    const generation = await requestProcessing(item.id, {
      receipt: { chatIdHash: "category-chat", chatIdEnc: "category-chat-enc" },
    });
    const dependencies = { ...successfulDependencies(), loadTaxonomy: undefined };
    dependencies.classify.mockResolvedValue({
      outcome: "selected",
      categoryId: category.id,
      confidence: 0.9,
    });
    const info = vi.spyOn(logger, "info");
    try {
      await expect(processItemJob({
        itemId: item.id,
        processGeneration: generation,
        embVersion: 1,
        attempt: 0,
      }, dependencies)).resolves.toEqual({ claimed: true, outcome: "completed" });

      expect(dependencies.classify).toHaveBeenCalledWith({
        title: "New title",
        summary: "新总结第一句。新总结第二句。",
        tags: ["新标签一", "新标签二", "新标签三"],
        categories: [{ id: category.id, name: category.name }],
      });
      expect(info).toHaveBeenCalledWith("category_classified", {
        outcome: "matched",
        version: 4,
      });
    } finally {
      info.mockRestore();
    }

    const [saved] = await db.select().from(items).where(eq(items.id, item.id));
    expect(saved).toMatchObject({ status: "completed", categoryId: category.id, categoryManual: false });
    expect(await currentRequest(item.id, generation, 0)).toMatchObject({ status: "done" });
    const [receipt] = await db.select().from(telegramReceipts);
    expect(receipt).toMatchObject({ outcome: "completed", status: "ready" });
  });

  it("writes reliable unclassified but preserves the old category for classifier failures", async () => {
    const info = vi.spyOn(logger, "info");
    const category = await insertCategory("开发工具");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 2 })
      .where(eq(appSettings.id, 1));
    const snapshot = {
      initialized: true,
      version: 2,
      categories: [{ id: category.id, name: category.name }],
    };

    const reliable = await insertItem({ status: "failed", categoryId: category.id });
    const reliableGeneration = await requestProcessing(reliable.id);
    const reliableDependencies = successfulDependencies();
    reliableDependencies.loadTaxonomy.mockResolvedValue(snapshot);
    reliableDependencies.classify.mockResolvedValue({ outcome: "unclassified", confidence: 0.4 });
    await processItemJob({
      itemId: reliable.id,
      processGeneration: reliableGeneration,
      embVersion: 1,
      attempt: 0,
    }, reliableDependencies);
    expect((await db.select().from(items).where(eq(items.id, reliable.id)))[0]).toMatchObject({
      status: "completed",
      categoryId: null,
    });
    expect(info).toHaveBeenCalledWith("category_classified", {
      outcome: "unclassified",
      version: 2,
    });

    for (const outcome of ["invalid_output", "upstream_error"] as const) {
      const existing = await insertItem({ status: "failed", categoryId: category.id });
      const generation = await requestProcessing(existing.id);
      const dependencies = successfulDependencies();
      dependencies.loadTaxonomy.mockResolvedValue(snapshot);
      dependencies.classify.mockResolvedValue({ outcome });
      await expect(processItemJob({
        itemId: existing.id,
        processGeneration: generation,
        embVersion: 1,
        attempt: 0,
      }, dependencies)).resolves.toEqual({ claimed: true, outcome: "completed" });
      expect((await db.select().from(items).where(eq(items.id, existing.id)))[0]).toMatchObject({
        status: "completed",
        categoryId: category.id,
      });
      expect(await currentRequest(existing.id, generation, 0)).toMatchObject({ status: "done" });
      expect(info).toHaveBeenCalledWith("category_classified", {
        outcome: "skipped",
        errorCode: outcome === "invalid_output" ? "AI_OUTPUT_INVALID" : "AI_UPSTREAM_FAILED",
      });
    }
  });

  it("does not classify uninitialized, doc, or manually categorized items", async () => {
    const info = vi.spyOn(logger, "info");
    const category = await insertCategory("不应调用");
    const cases = [
      { overrides: { type: "web", categoryManual: false }, loadExpected: true },
      { overrides: { type: "doc", categoryManual: false }, loadExpected: false },
      { overrides: { type: "web", categoryManual: true, categoryId: category.id }, loadExpected: false },
    ] as const;

    for (const fixture of cases) {
      const item = await insertItem({ status: "failed", ...fixture.overrides });
      const generation = await requestProcessing(item.id);
      const dependencies = successfulDependencies();
      await processItemJob({
        itemId: item.id,
        processGeneration: generation,
        embVersion: 1,
        attempt: 0,
      }, dependencies);
      expect(dependencies.loadTaxonomy).toHaveBeenCalledTimes(fixture.loadExpected ? 1 : 0);
      expect(dependencies.classify).not.toHaveBeenCalled();
      expect((await db.select().from(items).where(eq(items.id, item.id)))[0]?.status).toBe("completed");
    }
    expect(info.mock.calls.filter(([event, fields]) => event === "category_classified" && (fields as { outcome?: string }).outcome === "skipped")).toHaveLength(3);
  });

  it("protects an initially manual unclassified item without loading taxonomy", async () => {
    const category = await insertCategory("不应自动覆盖人工未分类");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 7 })
      .where(eq(appSettings.id, 1));
    const item = await insertItem({ status: "failed", categoryId: null, categoryManual: true });
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();
    dependencies.loadTaxonomy.mockResolvedValue({
      initialized: true,
      version: 7,
      categories: [{ id: category.id, name: category.name }],
    });
    dependencies.classify.mockResolvedValue({
      outcome: "selected",
      categoryId: category.id,
      confidence: 0.95,
    });

    await expect(processItemJob({
      itemId: item.id,
      processGeneration: generation,
      embVersion: 1,
      attempt: 0,
    }, dependencies)).resolves.toEqual({ claimed: true, outcome: "completed" });

    expect(dependencies.loadTaxonomy).not.toHaveBeenCalled();
    expect(dependencies.classify).not.toHaveBeenCalled();
    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
      status: "completed",
      categoryId: null,
      categoryManual: true,
    });
  });

  it("keeps processing completed when taxonomy loading or classification throws", async () => {
    const info = vi.spyOn(logger, "info");
    const category = await insertCategory("原分类");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 1 })
      .where(eq(appSettings.id, 1));

    for (const failure of ["load", "classify"] as const) {
      const item = await insertItem({ status: "failed", categoryId: category.id });
      const generation = await requestProcessing(item.id);
      const dependencies = successfulDependencies();
      if (failure === "load") {
        dependencies.loadTaxonomy.mockRejectedValue(new Error("taxonomy unavailable"));
      } else {
        dependencies.loadTaxonomy.mockResolvedValue({
          initialized: true,
          version: 1,
          categories: [{ id: category.id, name: category.name }],
        });
        dependencies.classify.mockRejectedValue(new Error("classifier escaped"));
      }

      await expect(processItemJob({
        itemId: item.id,
        processGeneration: generation,
        embVersion: 1,
        attempt: 0,
      }, dependencies)).resolves.toEqual({ claimed: true, outcome: "completed" });
      expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
        status: "completed",
        categoryId: category.id,
      });
      expect(await currentRequest(item.id, generation, 0)).toMatchObject({
        status: "done",
        lastErrorCode: null,
      });
      expect(info).toHaveBeenCalledWith("category_classified", {
        outcome: "skipped",
        errorCode: undefined,
      });
    }
  });

  it("does not overwrite an administrator category change made during inference", async () => {
    const info = vi.spyOn(logger, "info");
    const automatic = await insertCategory("自动候选");
    const manual = await insertCategory("人工选择");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 3 })
      .where(eq(appSettings.id, 1));
    const item = await insertItem({ status: "failed", categoryId: null });
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();
    dependencies.loadTaxonomy.mockResolvedValue({
      initialized: true,
      version: 3,
      categories: [{ id: automatic.id, name: automatic.name }],
    });
    let resolveClassification!: (outcome: ClassificationOutcome) => void;
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    dependencies.classify.mockImplementation(() => new Promise((resolve) => {
      resolveClassification = resolve;
      reportStarted();
    }));
    const processing = processItemJob({
      itemId: item.id,
      processGeneration: generation,
      embVersion: 1,
      attempt: 0,
    }, dependencies);
    await started;
    await db.update(items).set({ categoryId: manual.id, categoryManual: true })
      .where(eq(items.id, item.id));
    resolveClassification({ outcome: "selected", categoryId: automatic.id, confidence: 0.95 });
    await expect(processing).resolves.toEqual({ claimed: true, outcome: "completed" });

    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
      categoryId: manual.id,
      categoryManual: true,
      status: "completed",
    });
    expect(info).toHaveBeenCalledWith("category_classified", {
      outcome: "skipped",
      version: 3,
    });
  });

  it("does not overwrite an administrator choosing unclassified during inference", async () => {
    const info = vi.spyOn(logger, "info");
    const automatic = await insertCategory("自动候选");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 8 })
      .where(eq(appSettings.id, 1));
    const item = await insertItem({ status: "failed", categoryId: automatic.id });
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();
    dependencies.loadTaxonomy.mockResolvedValue({
      initialized: true,
      version: 8,
      categories: [{ id: automatic.id, name: automatic.name }],
    });
    let resolveClassification!: (outcome: ClassificationOutcome) => void;
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    dependencies.classify.mockImplementation(() => new Promise((resolve) => {
      resolveClassification = resolve;
      reportStarted();
    }));

    const processing = processItemJob({
      itemId: item.id,
      processGeneration: generation,
      embVersion: 1,
      attempt: 0,
    }, dependencies);
    await started;
    await db.update(items).set({ categoryId: null, categoryManual: true })
      .where(eq(items.id, item.id));
    resolveClassification({ outcome: "selected", categoryId: automatic.id, confidence: 0.95 });
    await expect(processing).resolves.toEqual({ claimed: true, outcome: "completed" });

    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
      categoryId: null,
      categoryManual: true,
      status: "completed",
    });
    expect(info).toHaveBeenCalledWith("category_classified", {
      outcome: "skipped",
      version: 8,
    });
  });

  it("does not apply an inference after taxonomy version changes", async () => {
    const info = vi.spyOn(logger, "info");
    const category = await insertCategory("版本候选");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 5 })
      .where(eq(appSettings.id, 1));
    const item = await insertItem({ status: "failed", categoryId: null });
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();
    dependencies.loadTaxonomy.mockResolvedValue({
      initialized: true,
      version: 5,
      categories: [{ id: category.id, name: category.name }],
    });
    let resolveClassification!: (outcome: ClassificationOutcome) => void;
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    dependencies.classify.mockImplementation(() => new Promise((resolve) => {
      resolveClassification = resolve;
      reportStarted();
    }));
    const transaction = vi.spyOn(db, "transaction");

    const processing = processItemJob({
      itemId: item.id,
      processGeneration: generation,
      embVersion: 1,
      attempt: 0,
    }, dependencies);
    await started;
    const transactionsDuringInference = transaction.mock.calls.length;
    await db.update(appSettings).set({ categoryVersion: 6 }).where(eq(appSettings.id, 1));
    resolveClassification({ outcome: "selected", categoryId: category.id, confidence: 0.9 });
    await expect(processing).resolves.toEqual({ claimed: true, outcome: "completed" });
    expect(transactionsDuringInference).toBe(0);
    expect(transaction).toHaveBeenCalledOnce();

    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
      status: "completed",
      categoryId: null,
    });
    expect(info).toHaveBeenCalledWith("category_classified", {
      outcome: "skipped",
      version: 5,
    });
  });

  it("does not fail or retry when the selected category disappears during inference", async () => {
    const info = vi.spyOn(logger, "info");
    const category = await insertCategory("即将删除");
    await db.update(appSettings).set({ categoriesInitialized: true, categoryVersion: 7 })
      .where(eq(appSettings.id, 1));
    const item = await insertItem({ status: "failed", categoryId: null });
    const generation = await requestProcessing(item.id);
    const dependencies = successfulDependencies();
    dependencies.loadTaxonomy.mockResolvedValue({
      initialized: true,
      version: 7,
      categories: [{ id: category.id, name: category.name }],
    });
    let resolveClassification!: (outcome: ClassificationOutcome) => void;
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    dependencies.classify.mockImplementation(() => new Promise((resolve) => {
      resolveClassification = resolve;
      reportStarted();
    }));

    const processing = processItemJob({
      itemId: item.id,
      processGeneration: generation,
      embVersion: 1,
      attempt: 0,
    }, dependencies);
    await started;
    await db.delete(categories).where(eq(categories.id, category.id));
    resolveClassification({ outcome: "selected", categoryId: category.id, confidence: 0.9 });
    await expect(processing).resolves.toEqual({ claimed: true, outcome: "completed" });

    expect((await db.select().from(items).where(eq(items.id, item.id)))[0]).toMatchObject({
      status: "completed",
      categoryId: null,
    });
    expect(await currentRequest(item.id, generation, 0)).toMatchObject({ status: "done" });
    expect(await db.select().from(processingRequests).where(and(
      eq(processingRequests.itemId, item.id),
      eq(processingRequests.attempt, 1),
    ))).toHaveLength(0);
    expect(info).toHaveBeenCalledWith("category_classified", {
      outcome: "skipped",
      version: 7,
    });
  });

  it("coordinates embedding rebuild as building, failed, or ready", async () => {
    await db.update(appSettings).set({ embVersion: 2, embRebuildStatus: "building" }).where(eq(appSettings.id, 1));
    const first = await insertItem({ status: "processing", processGeneration: 1, embedding: null, embeddingDim: null, embeddingVersion: null });
    const second = await insertItem({ status: "processing", processGeneration: 1, embedding: null, embeddingDim: null, embeddingVersion: null });
    await db.insert(processingRequests).values([
      { itemId: first.id, processGeneration: 1, embVersion: 2, attempt: 0, status: "done" },
      { itemId: second.id, processGeneration: 1, embVersion: 2, attempt: 0, status: "pending" },
    ]);
    await expect(reconcileEmbeddingRebuild()).resolves.toBe("building");

    await db.update(processingRequests).set({ status: "failed", attempt: 3 }).where(eq(processingRequests.itemId, second.id));
    await expect(reconcileEmbeddingRebuild()).resolves.toBe("failed");

    await db.update(appSettings).set({ embRebuildStatus: "building" }).where(eq(appSettings.id, 1));
    await db.update(processingRequests).set({ status: "done" }).where(eq(processingRequests.itemId, second.id));
    await expect(reconcileEmbeddingRebuild()).resolves.toBe("ready");
  });
});

describe("dedupe and real pg-boss singleton", () => {
  it("upserts a canonical URL without creating duplicates", async () => {
    const first = await upsertItem({ url: "https://example.com/a", urlCanonical: "https://example.com/a", type: "web", source: "admin" });
    const second = await upsertItem({ url: "https://example.com/a#fragment", urlCanonical: "https://example.com/a", type: "web", source: "telegram" });
    expect(first.deduped).toBe(false);
    expect(second).toMatchObject({ deduped: true, item: { id: first.item.id } });
    expect(await db.select().from(items)).toHaveLength(1);
  });

  it("uses the installed pg-boss singleton key contract", async () => {
    const boss = createBoss();
    await boss.start();
    try {
      await ensureProcessingQueue(boss);
      const options = { singletonKey: `probe-${crypto.randomUUID()}` };
      const first = await boss.send(PROCESS_ITEM_QUEUE, { probe: true }, options);
      const duplicate = await boss.send(PROCESS_ITEM_QUEUE, { probe: true }, options);
      expect(first).toEqual(expect.any(String));
      expect(duplicate).toBeNull();
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
