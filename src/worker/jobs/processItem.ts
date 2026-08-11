import { and, eq, sql } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { appSettings, categories, items, processingRequests, telegramReceipts } from "@/db/schema";
import { AiClientError } from "@/lib/ai/llm";
import { embedText } from "@/lib/ai/embedding";
import { summarizeContent, type SummaryResult } from "@/lib/ai/summarize";
import {
  classifyItem,
  type CategoryCandidate,
  type ClassificationInput,
  type ClassificationOutcome,
} from "@/lib/categories/classify";
import { fingerprintContent } from "@/lib/fetch/fingerprint";
import { fetchGitHubRepository, GitHubFetchError } from "@/lib/fetch/github";
import { ContentExtractError, fetchAndExtractContent } from "@/lib/fetch/webExtract";
import { logger } from "@/lib/log/logger";
import type { ProcessingJobPayload } from "@/worker/queue/requestPublisher";

export interface FetchedItemContent {
  title: string | null;
  content: string;
}

export interface ProcessItemDependencies {
  fetchContent: (item: typeof items.$inferSelect) => Promise<FetchedItemContent>;
  summarize: (input: FetchedItemContent) => Promise<SummaryResult>;
  embed: (input: string) => Promise<number[]>;
  loadTaxonomy?: () => Promise<TaxonomySnapshot>;
  classify?: (input: ClassificationInput) => Promise<ClassificationOutcome>;
  retryDelayMs?: (attempt: number) => number;
  now?: () => Date;
}

export interface TaxonomySnapshot {
  initialized: boolean;
  version: number;
  categories: CategoryCandidate[];
}

export interface ProcessItemOutcome {
  claimed: boolean;
  outcome?: "completed" | "retrying" | "failed" | "deferred";
}

async function loadTaxonomySnapshot(): Promise<TaxonomySnapshot> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{
      categories_initialized: boolean;
      category_version: number;
    }>(sql`
      select categories_initialized, category_version
        from app_settings
       where id = 1
       for share
    `);
    const settings = locked.rows[0];
    if (!settings) return { initialized: false, version: 0, categories: [] };
    const currentCategories = await tx.select({ id: categories.id, name: categories.name })
      .from(categories);
    return {
      initialized: settings.categories_initialized,
      version: settings.category_version,
      categories: currentCategories,
    };
  });
}

const defaultDependencies: ProcessItemDependencies = {
  async fetchContent(item) {
    if (item.type === "github") {
      const repository = await fetchGitHubRepository(item.url);
      return { title: repository.title, content: repository.content };
    }
    return fetchAndExtractContent(item.url);
  },
  summarize: summarizeContent,
  embed: embedText,
  loadTaxonomy: loadTaxonomySnapshot,
  classify: classifyItem,
};

type ClassificationEvent = {
  outcome: "matched" | "unclassified" | "skipped";
  reason: string;
};

type PreparedClassification =
  | { apply: false; event: ClassificationEvent }
  | {
      apply: true;
      categoryId: string | null;
      selected: boolean;
      snapshotVersion: number;
    };

async function prepareClassification(
  item: typeof items.$inferSelect,
  input: Omit<ClassificationInput, "categories">,
  dependencies: ProcessItemDependencies,
): Promise<PreparedClassification> {
  if (item.type !== "web" && item.type !== "github") {
    return { apply: false, event: { outcome: "skipped", reason: "unsupported_type" } };
  }
  if (item.categoryManual) {
    return { apply: false, event: { outcome: "skipped", reason: "manual_protected" } };
  }

  let taxonomy: TaxonomySnapshot;
  try {
    taxonomy = await (dependencies.loadTaxonomy ?? loadTaxonomySnapshot)();
  } catch {
    return { apply: false, event: { outcome: "skipped", reason: "taxonomy_unavailable" } };
  }
  if (!taxonomy.initialized) {
    return { apply: false, event: { outcome: "skipped", reason: "not_initialized" } };
  }

  let classification: ClassificationOutcome;
  try {
    classification = await (dependencies.classify ?? classifyItem)({
      ...input,
      categories: taxonomy.categories,
    });
  } catch {
    return { apply: false, event: { outcome: "skipped", reason: "classifier_upstream_error" } };
  }

  if (classification.outcome === "selected") {
    return {
      apply: true,
      categoryId: classification.categoryId,
      selected: true,
      snapshotVersion: taxonomy.version,
    };
  }
  if (classification.outcome === "unclassified") {
    return {
      apply: true,
      categoryId: null,
      selected: false,
      snapshotVersion: taxonomy.version,
    };
  }
  return {
    apply: false,
    event: {
      outcome: "skipped",
      reason: classification.outcome,
    },
  };
}

async function claimRequest(payload: ProcessingJobPayload): Promise<boolean> {
  const result = await pool.query(
    `update processing_requests r set status = 'running'
      where r.item_id = $1 and r.process_generation = $2 and r.attempt = $3
        and r.emb_version = $4 and r.status in ('pending','queued')
        and exists (
          select 1 from items i, app_settings s
           where i.id = r.item_id and i.process_generation = r.process_generation
             and s.id = 1 and s.emb_version = r.emb_version
        )`,
    [payload.itemId, payload.processGeneration, payload.attempt, payload.embVersion],
  );
  if ((result.rowCount ?? 0) === 1) return true;
  await pool.query(
    `update processing_requests r set status = 'done'
      where r.item_id = $1 and r.process_generation = $2 and r.attempt = $3
        and r.emb_version = $4 and r.status in ('pending','queued')
        and not exists (
          select 1 from items i, app_settings s
           where i.id = r.item_id and i.process_generation = r.process_generation
             and s.id = 1 and s.emb_version = r.emb_version
        )`,
    [payload.itemId, payload.processGeneration, payload.attempt, payload.embVersion],
  );
  return false;
}

async function finishStaleRequest(payload: ProcessingJobPayload): Promise<void> {
  await db.update(processingRequests).set({ status: "done" }).where(and(
    eq(processingRequests.itemId, payload.itemId),
    eq(processingRequests.processGeneration, payload.processGeneration),
    eq(processingRequests.attempt, payload.attempt),
    eq(processingRequests.status, "running"),
  ));
}

async function deferForGitHubBackoff(
  payload: ProcessingJobPayload,
  now: Date,
): Promise<boolean> {
  const result = await pool.query(
    `update processing_requests r
        set status = 'pending', next_attempt_at = s.github_backoff_until
       from items i, app_settings s
      where r.item_id = $1 and r.process_generation = $2 and r.attempt = $3
        and r.emb_version = $4 and r.status = 'running'
        and i.id = r.item_id and i.process_generation = r.process_generation
        and i.type = 'github' and s.id = 1 and s.emb_version = r.emb_version
        and s.github_backoff_until > $5`,
    [payload.itemId, payload.processGeneration, payload.attempt, payload.embVersion, now],
  );
  return (result.rowCount ?? 0) === 1;
}

function stableError(error: unknown): { code: string; retryAt?: Date } {
  if (error instanceof GitHubFetchError) return { code: error.code, retryAt: error.retryAt };
  if (error instanceof ContentExtractError) return { code: error.code };
  if (error instanceof AiClientError) return { code: error.code };
  return { code: "PROCESSING_UPSTREAM_FAILED" };
}

async function failRequest(
  payload: ProcessingJobPayload,
  error: unknown,
  dependencies: ProcessItemDependencies,
): Promise<ProcessItemOutcome> {
  const failure = stableError(error);
  const finalAttempt = payload.attempt >= 3;
  const now = dependencies.now?.() ?? new Date();
  const retryAt = failure.retryAt ?? new Date(
    now.getTime() + (dependencies.retryDelayMs?.(payload.attempt) ?? 30_000 * (2 ** payload.attempt)),
  );

  await db.transaction(async (tx) => {
    await tx.update(processingRequests).set({
      status: "failed",
      lastErrorCode: failure.code,
    }).where(and(
      eq(processingRequests.itemId, payload.itemId),
      eq(processingRequests.processGeneration, payload.processGeneration),
      eq(processingRequests.attempt, payload.attempt),
      eq(processingRequests.status, "running"),
    ));

    const [current] = await tx.select({
      processGeneration: items.processGeneration,
    }).from(items).where(eq(items.id, payload.itemId));
    if (!current || current.processGeneration !== payload.processGeneration) return;

    if (failure.code === "GITHUB_RATE_LIMITED" && failure.retryAt) {
      await tx.update(appSettings).set({
        githubBackoffUntil: sql`greatest(coalesce(${appSettings.githubBackoffUntil}, '-infinity'::timestamptz), ${failure.retryAt})`,
      }).where(eq(appSettings.id, 1));
    }

    if (!finalAttempt) {
      await tx.insert(processingRequests).values({
        itemId: payload.itemId,
        processGeneration: payload.processGeneration,
        embVersion: payload.embVersion,
        attempt: payload.attempt + 1,
        status: "pending",
        nextAttemptAt: retryAt,
      }).onConflictDoNothing();
      return;
    }

    await tx.update(items).set({
      status: "failed",
      failReason: failure.code,
      updatedAt: now,
    }).where(and(
      eq(items.id, payload.itemId),
      eq(items.processGeneration, payload.processGeneration),
    ));
    await tx.update(telegramReceipts).set({ outcome: "failed", status: "ready" }).where(and(
      eq(telegramReceipts.itemId, payload.itemId),
      eq(telegramReceipts.processGeneration, payload.processGeneration),
      eq(telegramReceipts.status, "waiting"),
    ));
  });
  return { claimed: true, outcome: finalAttempt ? "failed" : "retrying" };
}

async function processItemJobCore(
  payload: ProcessingJobPayload,
  dependencies: ProcessItemDependencies = defaultDependencies,
): Promise<ProcessItemOutcome> {
  if (!(await claimRequest(payload))) return { claimed: false };
  const startedAt = dependencies.now?.() ?? new Date();
  if (await deferForGitHubBackoff(payload, startedAt)) {
    return { claimed: true, outcome: "deferred" };
  }

  try {
    const [item] = await db.select().from(items).where(eq(items.id, payload.itemId));
    if (!item || item.processGeneration !== payload.processGeneration) {
      await finishStaleRequest(payload);
      return { claimed: false };
    }
    const fetched = await dependencies.fetchContent(item);
    const contentHash = fingerprintContent(fetched);
    const unchanged = item.contentHash === contentHash;
    const requiresNewEmbedding = item.embeddingVersion !== payload.embVersion || item.embedding === null;

    let summary = item.summary;
    let tags = item.tags;
    if (!unchanged) {
      const generated = await dependencies.summarize(fetched);
      summary = item.summaryManual ? item.summary : generated.summary;
      tags = generated.tags;
    }
    if (!summary) {
      const generated = await dependencies.summarize(fetched);
      summary = generated.summary;
      tags = generated.tags;
    }

    const embedding = unchanged && !requiresNewEmbedding
      ? item.embedding
      : await dependencies.embed(summary);
    const classification = await prepareClassification(item, {
      title: unchanged ? item.title : fetched.title,
      summary,
      tags,
    }, dependencies);
    const now = dependencies.now?.() ?? new Date();
    let committed = false;
    let classificationEvent = classification.apply ? undefined : classification.event;
    await db.transaction(async (tx) => {
      let embVersion: number | undefined;
      let categoryVersion: number | undefined;
      if (classification.apply) {
        const locked = await tx.execute<{ emb_version: number; category_version: number }>(sql`
          select emb_version, category_version
            from app_settings
           where id = 1
           for share
        `);
        embVersion = locked.rows[0]?.emb_version;
        categoryVersion = locked.rows[0]?.category_version;
      } else {
        const [settings] = await tx.select({ embVersion: appSettings.embVersion })
          .from(appSettings).where(eq(appSettings.id, 1));
        embVersion = settings?.embVersion;
      }
      if (embVersion !== payload.embVersion) return;

      let categoryReady = false;
      if (classification.apply) {
        if (categoryVersion !== classification.snapshotVersion) {
          classificationEvent = { outcome: "skipped", reason: "stale_taxonomy" };
        } else if (classification.selected) {
          const [candidate] = await tx.select({ id: categories.id }).from(categories)
            .where(eq(categories.id, classification.categoryId as string));
          if (candidate) categoryReady = true;
          else classificationEvent = { outcome: "skipped", reason: "category_missing" };
        } else {
          categoryReady = true;
        }
      }

      const [saved] = await tx.update(items).set({
        ...(unchanged ? {} : { title: fetched.title, summary, tags, contentHash }),
        ...(embedding ? {
          embedding,
          embeddingDim: embedding.length,
          embeddingVersion: payload.embVersion,
        } : {}),
        status: "completed",
        failReason: null,
        updatedAt: now,
      }).where(and(
        eq(items.id, payload.itemId),
        eq(items.processGeneration, payload.processGeneration),
      )).returning({ id: items.id, categoryManual: items.categoryManual });
      if (!saved) return;

      if (classification.apply && categoryReady) {
        if (saved.categoryManual) {
          classificationEvent = { outcome: "skipped", reason: "manual_override" };
        } else {
          const [classified] = await tx.update(items).set({ categoryId: classification.categoryId })
            .where(and(
              eq(items.id, payload.itemId),
              eq(items.processGeneration, payload.processGeneration),
              eq(items.categoryManual, false),
            )).returning({ id: items.id });
          classificationEvent = classified
            ? {
                outcome: classification.selected ? "matched" : "unclassified",
                reason: classification.selected ? "selected" : "reliable_unclassified",
              }
            : { outcome: "skipped", reason: "manual_override" };
        }
      }

      committed = true;
      await tx.update(processingRequests).set({ status: "done", lastErrorCode: null }).where(and(
        eq(processingRequests.itemId, payload.itemId),
        eq(processingRequests.processGeneration, payload.processGeneration),
        eq(processingRequests.attempt, payload.attempt),
        eq(processingRequests.status, "running"),
      ));
      await tx.update(telegramReceipts).set({ outcome: "completed", status: "ready" }).where(and(
        eq(telegramReceipts.itemId, payload.itemId),
        eq(telegramReceipts.processGeneration, payload.processGeneration),
        eq(telegramReceipts.status, "waiting"),
      ));
    });
    if (!committed) await finishStaleRequest(payload);
    if (committed && classificationEvent) {
      logger.info("category_classified", classificationEvent);
    }
    return committed ? { claimed: true, outcome: "completed" } : { claimed: false };
  } catch (error) {
    return failRequest(payload, error, dependencies);
  }
}

export async function processItemJob(
  payload: ProcessingJobPayload,
  dependencies: ProcessItemDependencies = defaultDependencies,
): Promise<ProcessItemOutcome> {
  const startedAt = performance.now();
  try {
    const result = await processItemJobCore(payload, dependencies);
    if (result.claimed) {
      logger.info("item_processed", {
        ok: result.outcome === "completed",
        retries: payload.attempt,
        ms: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    }
    return result;
  } catch (error) {
    logger.info("item_processed", {
      ok: false,
      retries: payload.attempt,
      ms: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    throw error;
  }
}

export async function reconcileEmbeddingRebuild(): Promise<"building" | "failed" | "ready"> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ emb_version: number; emb_rebuild_status: string }>(
      sql`select emb_version, emb_rebuild_status from app_settings where id = 1 for update`,
    );
    const settings = locked.rows[0];
    if (!settings || settings.emb_rebuild_status !== "building") {
      return (settings?.emb_rebuild_status ?? "failed") as "building" | "failed" | "ready";
    }
    const requests = await tx.select({ status: processingRequests.status, attempt: processingRequests.attempt })
      .from(processingRequests)
      .innerJoin(items, and(
        eq(items.id, processingRequests.itemId),
        eq(items.processGeneration, processingRequests.processGeneration),
      ))
      .where(eq(processingRequests.embVersion, settings.emb_version));
    const hasFinalFailure = requests.some((request) => request.status === "failed" && request.attempt === 3);
    const hasPending = requests.some((request) => ["pending", "queued", "running"].includes(request.status));
    const status = hasFinalFailure ? "failed" : hasPending ? "building" : "ready";
    if (status !== "building") {
      await tx.update(appSettings).set({ embRebuildStatus: status }).where(eq(appSettings.id, 1));
    }
    return status;
  });
}
