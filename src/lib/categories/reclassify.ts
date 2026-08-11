import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type PgBoss from "pg-boss";

import { db } from "@/db/client";
import {
  categories,
  categoryChangeRuns,
  categoryReclassifyFailures,
  categoryRunRetryRequests,
  items,
} from "@/db/schema";
import { lockCategoryState } from "@/lib/categories/store";
import { logger } from "@/lib/log/logger";

export const CATEGORY_RECLASSIFY_QUEUE = "category-reclassify";
const RECLASSIFY_BATCH_SIZE = 40;

export interface CategoryReclassifyPayload {
  runId: string;
  generation: number;
}

export interface CategoryReclassifyBoss {
  send(
    name: string,
    payload: CategoryReclassifyPayload,
    options: { singletonKey: string; retryLimit: number },
  ): Promise<string | null>;
}

export type CategoryRunErrorCode = "RUN_NOT_FOUND" | "STALE_TAXONOMY" | "VALIDATION";

export class CategoryRunError extends Error {
  constructor(public readonly code: CategoryRunErrorCode) {
    super(code);
    this.name = "CategoryRunError";
  }
}

export async function ensureCategoryReclassifyQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(CATEGORY_RECLASSIFY_QUEUE, {
    name: CATEGORY_RECLASSIFY_QUEUE,
    policy: "short",
    retryLimit: 0,
  });
}

export async function publishPendingCategoryReclassifications(
  boss: CategoryReclassifyBoss,
  limit = 100,
): Promise<number> {
  const pending = await db.select({
    runId: categoryChangeRuns.id,
    generation: categoryChangeRuns.reclassifyGeneration,
  }).from(categoryChangeRuns).where(eq(categoryChangeRuns.status, "reclassifying"))
    .orderBy(asc(categoryChangeRuns.updatedAt), asc(categoryChangeRuns.id)).limit(limit);
  for (const run of pending) {
    await boss.send(CATEGORY_RECLASSIFY_QUEUE, run, {
      singletonKey: `category-reclassify:${run.runId}:${run.generation}`,
      retryLimit: 0,
    });
  }
  return pending.length;
}

interface CategoryRunRow extends Record<string, unknown> {
    id: string;
    request_key: string;
    mode: string;
    base_version: number;
    applied_version: number | null;
    status: string;
    reclassify_generation: number;
    reclassified: number;
    moved_unclassified: number;
    added_count: number;
    renamed_count: number;
    merged_count: number;
    deleted_count: number;
    ignored_count: number;
    manual_protected: number;
    failed_count: string;
}

const CATEGORY_RUN_SELECT = sql`
    select r.id, r.request_key, r.mode, r.base_version, r.applied_version, r.status,
           r.reclassify_generation, r.reclassified, r.moved_unclassified,
           r.added_count, r.renamed_count, r.merged_count, r.deleted_count,
           r.ignored_count, r.manual_protected,
           count(f.item_id)::text as failed_count
      from category_change_runs r
      left join category_reclassify_failures f on f.run_id = r.id
`;

function categoryRunDto(run: CategoryRunRow | undefined) {
  if (!run) throw new CategoryRunError("RUN_NOT_FOUND");
  return {
    id: run.id,
    requestKey: run.request_key,
    mode: run.mode,
    baseVersion: run.base_version,
    appliedVersion: run.applied_version,
    status: run.status,
    reclassifyGeneration: run.reclassify_generation,
    reclassified: run.reclassified,
    movedUnclassified: run.moved_unclassified,
    failedCount: Number(run.failed_count),
    manualProtected: run.manual_protected,
    counts: {
      added: run.added_count,
      renamed: run.renamed_count,
      merged: run.merged_count,
      deleted: run.deleted_count,
      ignored: run.ignored_count,
    },
  };
}

export async function getCategoryRun(runId: string) {
  const result = await db.execute<CategoryRunRow>(sql`
    ${CATEGORY_RUN_SELECT}
     where r.id = ${runId}
     group by r.id
  `);
  return categoryRunDto(result.rows[0]);
}

export async function getLatestCategoryRun() {
  const result = await db.execute<CategoryRunRow>(sql`
    ${CATEGORY_RUN_SELECT}
     group by r.id
     order by r.created_at desc, r.id desc
     limit 1
  `);
  return result.rows[0] ? categoryRunDto(result.rows[0]) : null;
}

interface RetryDependencies {
  publish?: (payload: CategoryReclassifyPayload) => Promise<void>;
  now?: () => Date;
}

export async function requestCategoryRunRetry(
  runId: string,
  requestKey: string,
  dependencies: RetryDependencies = {},
): Promise<{ runId: string; generation: number; status: "reclassifying" }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw new CategoryRunError("VALIDATION");
  }
  const now = dependencies.now?.() ?? new Date();
  const result = await db.transaction(async (tx) => {
    const state = await lockCategoryState(tx);
    const locked = await tx.execute<{
      id: string;
      status: string;
      applied_version: number | null;
      reclassify_generation: number;
    }>(sql`
      select id, status, applied_version, reclassify_generation
        from category_change_runs where id = ${runId} for update
    `);
    const run = locked.rows[0];
    if (!run) throw new CategoryRunError("RUN_NOT_FOUND");
    const [existing] = await tx.select().from(categoryRunRetryRequests).where(and(
      eq(categoryRunRetryRequests.runId, runId),
      eq(categoryRunRetryRequests.requestKey, requestKey),
    ));
    if (existing) {
      return {
        runId,
        generation: existing.generation,
        status: "reclassifying" as const,
        shouldPublish: false,
      };
    }
    if (run.status === "reclassifying") throw new CategoryRunError("VALIDATION");
    if (run.status !== "partial" && run.status !== "failed") {
      throw new CategoryRunError("VALIDATION");
    }
    if (run.applied_version === null || state.version !== run.applied_version) {
      throw new CategoryRunError("STALE_TAXONOMY");
    }
    const generation = run.reclassify_generation + 1;
    await tx.insert(categoryRunRetryRequests).values({ runId, requestKey, generation, createdAt: now });
    await tx.update(categoryChangeRuns).set({
      reclassifyGeneration: generation,
      status: "reclassifying",
      updatedAt: now,
      completedAt: null,
      errorCode: null,
    }).where(eq(categoryChangeRuns.id, runId));
    return { runId, generation, status: "reclassifying" as const, shouldPublish: true };
  });
  if (result.shouldPublish && dependencies.publish) {
    try {
      await dependencies.publish({ runId, generation: result.generation });
    } catch {
      logger.info("category_reclassify_publish", { ok: false, runId });
    }
  }
  return { runId: result.runId, generation: result.generation, status: result.status };
}

export interface ReclassifyItem {
  id: string;
  title: string | null;
  summary: string | null;
  tags: string[];
  createdAt: Date;
  type: string;
  status: string;
  categoryManual: boolean;
}

export interface ReclassifyContext {
  runId: string;
  generation: number;
  appliedVersion: number;
  snapshotAt: Date;
  retryOnly: boolean;
  categories: Array<{ id: string; name: string }>;
  items: ReclassifyItem[];
}

export async function loadReclassifyContext(
  payload: CategoryReclassifyPayload,
  retryCursor?: string,
): Promise<ReclassifyContext | null> {
  return db.transaction(async (tx) => {
    const settings = await tx.execute<{ category_version: number }>(sql`
      select category_version from app_settings where id = 1 for share
    `);
    const locked = await tx.execute<{
      id: string;
      applied_version: number | null;
      snapshot_at: Date;
      reclassify_generation: number;
      status: string;
      cursor_created_at: Date | null;
      cursor_id: string | null;
    }>(sql`
      select id, applied_version, snapshot_at, reclassify_generation, status,
             cursor_created_at, cursor_id
        from category_change_runs
       where id = ${payload.runId}
       for update
    `);
    const run = locked.rows[0];
    if (!run || run.status !== "reclassifying" || run.reclassify_generation !== payload.generation) {
      return null;
    }
    if (run.applied_version === null) throw new Error("RUN_NOT_APPLIED");
    if (settings.rows[0]?.category_version !== run.applied_version) {
      await tx.update(categoryChangeRuns).set({ status: "superseded", updatedAt: new Date() })
        .where(eq(categoryChangeRuns.id, payload.runId));
      return null;
    }
    const currentCategories = await tx.select({ id: categories.id, name: categories.name })
      .from(categories).orderBy(asc(categories.sort), asc(categories.name), asc(categories.id));
    const retryOnly = payload.generation > 0;
    const page = retryOnly
      ? await tx.select({
          id: items.id,
          title: items.title,
          summary: items.summary,
          tags: items.tags,
          createdAt: items.createdAt,
          type: items.type,
          status: items.status,
          categoryManual: items.categoryManual,
        }).from(items).innerJoin(
          categoryReclassifyFailures,
          and(
            eq(categoryReclassifyFailures.itemId, items.id),
            eq(categoryReclassifyFailures.runId, payload.runId),
          ),
        ).where(retryCursor ? gt(items.id, retryCursor) : undefined)
          .orderBy(asc(items.id)).limit(RECLASSIFY_BATCH_SIZE)
      : await tx.select({
          id: items.id,
          title: items.title,
          summary: items.summary,
          tags: items.tags,
          createdAt: items.createdAt,
          type: items.type,
          status: items.status,
          categoryManual: items.categoryManual,
        }).from(items).where(and(
          eq(items.status, "completed"),
          inArray(items.type, ["web", "github"]),
          eq(items.categoryManual, false),
          lte(items.createdAt, new Date(run.snapshot_at)),
          run.cursor_created_at && run.cursor_id
            ? or(
                gt(items.createdAt, new Date(run.cursor_created_at)),
                and(
                  eq(items.createdAt, new Date(run.cursor_created_at)),
                  gt(items.id, run.cursor_id),
                ),
              )
            : undefined,
        )).orderBy(asc(items.createdAt), asc(items.id)).limit(RECLASSIFY_BATCH_SIZE);
    return {
      runId: payload.runId,
      generation: payload.generation,
      appliedVersion: run.applied_version,
      snapshotAt: new Date(run.snapshot_at),
      retryOnly,
      categories: currentCategories,
      items: page,
    };
  });
}

export type ReclassifyDecision =
  | { outcome: "selected"; categoryId: string }
  | { outcome: "unclassified" }
  | { outcome: "failure"; errorCode: "AI_UPSTREAM_FAILED" | "AI_OUTPUT_INVALID" };

export async function commitReclassifyDecision(
  context: ReclassifyContext,
  item: ReclassifyItem,
  decision: ReclassifyDecision,
): Promise<"applied" | "failed" | "resolved_skipped" | "superseded"> {
  return db.transaction(async (tx) => {
    const settings = await tx.execute<{ category_version: number }>(sql`
      select category_version from app_settings where id = 1 for share
    `);
    if (settings.rows[0]?.category_version !== context.appliedVersion) {
      await tx.update(categoryChangeRuns).set({ status: "superseded", updatedAt: new Date() })
        .where(eq(categoryChangeRuns.id, context.runId));
      return "superseded";
    }
    const lockedRun = await tx.execute<{
      status: string;
      reclassify_generation: number;
      cursor_created_at: Date | null;
      cursor_id: string | null;
    }>(sql`
      select status, reclassify_generation, cursor_created_at, cursor_id
        from category_change_runs
       where id = ${context.runId}
       for update
    `);
    const currentRun = lockedRun.rows[0];
    if (
      !currentRun || currentRun.status !== "reclassifying" ||
      currentRun.reclassify_generation !== context.generation
    ) {
      return "resolved_skipped";
    }
    if (!context.retryOnly && currentRun.cursor_created_at && currentRun.cursor_id) {
      const cursorTime = new Date(currentRun.cursor_created_at).getTime();
      const itemTime = item.createdAt.getTime();
      if (cursorTime > itemTime || (cursorTime === itemTime && currentRun.cursor_id >= item.id)) {
        return "resolved_skipped";
      }
    }
    const lockedItem = await tx.execute<{
      id: string;
      status: string;
      type: string;
      category_manual: boolean;
    }>(sql`select id, status, type, category_manual from items where id = ${item.id} for update`);
    const current = lockedItem.rows[0];
    const cursorUpdate = context.retryOnly
      ? {}
      : { cursorCreatedAt: item.createdAt, cursorId: item.id };
    if (
      !current || current.category_manual || current.status !== "completed" ||
      (current.type !== "web" && current.type !== "github")
    ) {
      await tx.delete(categoryReclassifyFailures).where(and(
        eq(categoryReclassifyFailures.runId, context.runId),
        eq(categoryReclassifyFailures.itemId, item.id),
      ));
      await tx.update(categoryChangeRuns).set({ ...cursorUpdate, updatedAt: new Date() })
        .where(eq(categoryChangeRuns.id, context.runId));
      return "resolved_skipped";
    }

    if (decision.outcome === "failure") {
      await tx.insert(categoryReclassifyFailures).values({
        runId: context.runId,
        itemId: item.id,
        errorCode: decision.errorCode,
      }).onConflictDoUpdate({
        target: [categoryReclassifyFailures.runId, categoryReclassifyFailures.itemId],
        set: {
          errorCode: decision.errorCode,
          attempts: sql`${categoryReclassifyFailures.attempts} + 1`,
          updatedAt: new Date(),
        },
      });
      await tx.update(categoryChangeRuns).set({ ...cursorUpdate, updatedAt: new Date() })
        .where(eq(categoryChangeRuns.id, context.runId));
      return "failed";
    }

    const destination = decision.outcome === "selected" ? decision.categoryId : null;
    if (destination !== null) {
      const [candidate] = await tx.select({ id: categories.id }).from(categories)
        .where(eq(categories.id, destination));
      if (!candidate) {
        await tx.insert(categoryReclassifyFailures).values({
          runId: context.runId,
          itemId: item.id,
          errorCode: "AI_OUTPUT_INVALID",
        }).onConflictDoUpdate({
          target: [categoryReclassifyFailures.runId, categoryReclassifyFailures.itemId],
          set: {
            errorCode: "AI_OUTPUT_INVALID",
            attempts: sql`${categoryReclassifyFailures.attempts} + 1`,
            updatedAt: new Date(),
          },
        });
        await tx.update(categoryChangeRuns).set({ ...cursorUpdate, updatedAt: new Date() })
          .where(eq(categoryChangeRuns.id, context.runId));
        return "failed";
      }
    }
    const updated = await tx.update(items).set({ categoryId: destination }).where(and(
      eq(items.id, item.id),
      eq(items.categoryManual, false),
      eq(items.status, "completed"),
      inArray(items.type, ["web", "github"]),
    )).returning({ id: items.id });
    if (updated.length === 0) {
      await tx.delete(categoryReclassifyFailures).where(and(
        eq(categoryReclassifyFailures.runId, context.runId),
        eq(categoryReclassifyFailures.itemId, item.id),
      ));
      await tx.update(categoryChangeRuns).set({ ...cursorUpdate, updatedAt: new Date() })
        .where(eq(categoryChangeRuns.id, context.runId));
      return "resolved_skipped";
    }
    await tx.delete(categoryReclassifyFailures).where(and(
      eq(categoryReclassifyFailures.runId, context.runId),
      eq(categoryReclassifyFailures.itemId, item.id),
    ));
    await tx.update(categoryChangeRuns).set({
      ...cursorUpdate,
      reclassified: sql`${categoryChangeRuns.reclassified} + ${destination === null ? 0 : 1}`,
      movedUnclassified: sql`${categoryChangeRuns.movedUnclassified} + ${destination === null ? 1 : 0}`,
      updatedAt: new Date(),
    }).where(eq(categoryChangeRuns.id, context.runId));
    return "applied";
  });
}

export async function finishCategoryReclassification(
  context: Pick<ReclassifyContext, "runId" | "generation" | "appliedVersion">,
): Promise<"completed" | "partial" | "superseded"> {
  return db.transaction(async (tx) => {
    const settings = await tx.execute<{ category_version: number }>(sql`
      select category_version from app_settings where id = 1 for share
    `);
    if (settings.rows[0]?.category_version !== context.appliedVersion) {
      await tx.update(categoryChangeRuns).set({ status: "superseded", updatedAt: new Date() })
        .where(eq(categoryChangeRuns.id, context.runId));
      return "superseded";
    }
    const [failure] = await tx.select({ itemId: categoryReclassifyFailures.itemId })
      .from(categoryReclassifyFailures).where(eq(categoryReclassifyFailures.runId, context.runId))
      .limit(1);
    const status = failure ? "partial" : "completed";
    await tx.update(categoryChangeRuns).set({
      status,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(categoryChangeRuns.id, context.runId),
      eq(categoryChangeRuns.reclassifyGeneration, context.generation),
      eq(categoryChangeRuns.status, "reclassifying"),
    ));
    return status;
  });
}
