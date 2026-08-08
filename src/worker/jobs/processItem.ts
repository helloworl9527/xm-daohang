import { and, eq, sql } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { appSettings, items, processingRequests, telegramReceipts } from "@/db/schema";
import { AiClientError } from "@/lib/ai/llm";
import { embedText } from "@/lib/ai/embedding";
import { summarizeContent, type SummaryResult } from "@/lib/ai/summarize";
import { fingerprintContent } from "@/lib/fetch/fingerprint";
import { fetchGitHubRepository, GitHubFetchError } from "@/lib/fetch/github";
import { ContentExtractError, fetchAndExtractContent } from "@/lib/fetch/webExtract";
import type { ProcessingJobPayload } from "@/worker/queue/requestPublisher";

export interface FetchedItemContent {
  title: string | null;
  content: string;
}

export interface ProcessItemDependencies {
  fetchContent: (item: typeof items.$inferSelect) => Promise<FetchedItemContent>;
  summarize: (input: FetchedItemContent) => Promise<SummaryResult>;
  embed: (input: string) => Promise<number[]>;
  retryDelayMs?: (attempt: number) => number;
  now?: () => Date;
}

export interface ProcessItemOutcome {
  claimed: boolean;
  outcome?: "completed" | "retrying" | "failed" | "deferred";
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
};

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

export async function processItemJob(
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
    const now = dependencies.now?.() ?? new Date();
    let committed = false;
    await db.transaction(async (tx) => {
      const [settings] = await tx.select({ embVersion: appSettings.embVersion })
        .from(appSettings).where(eq(appSettings.id, 1));
      if (!settings || settings.embVersion !== payload.embVersion) return;
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
      )).returning({ id: items.id });
      if (!saved) return;
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
    return committed ? { claimed: true, outcome: "completed" } : { claimed: false };
  } catch (error) {
    return failRequest(payload, error, dependencies);
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
