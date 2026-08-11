import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { categories, categoryChangeRuns, items } from "@/db/schema";
import {
  advanceCategoryVersion,
  CategoryError,
  createCategoryRecord,
  lockCategoryState,
  normalizeCategoryName,
  renameCategoryRecord,
} from "@/lib/categories/store";
import { logger } from "@/lib/log/logger";

const refSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), categoryId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("proposal"), proposalId: z.string().min(1).max(100) }).strict(),
]);
const destinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unclassified") }).strict(),
  z.object({ kind: z.literal("target"), target: refSchema }).strict(),
]);
const proposalId = z.string().min(1).max(100);
const clientCounts = {
  autoCount: z.number().int().nonnegative().optional(),
  manualCount: z.number().int().nonnegative().optional(),
};
const appliedDiffSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), proposalId, name: z.string(), ...clientCounts }).strict(),
  z.object({
    kind: z.literal("rename"),
    proposalId,
    sourceCategoryId: z.string().uuid(),
    name: z.string(),
    ...clientCounts,
  }).strict(),
  z.object({
    kind: z.literal("merge"),
    proposalId,
    sourceCategoryId: z.string().uuid(),
    target: refSchema,
    autoDestination: destinationSchema,
    ...clientCounts,
  }).strict(),
  z.object({
    kind: z.literal("delete"),
    proposalId,
    sourceCategoryId: z.string().uuid(),
    autoDestination: destinationSchema,
    ...clientCounts,
  }).strict(),
]);
const ignoredDiffSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), proposalId, name: z.string(), ...clientCounts }).strict(),
  z.object({
    kind: z.literal("rename"),
    proposalId,
    sourceCategoryId: z.string().uuid(),
    name: z.string(),
    ...clientCounts,
  }).strict(),
  z.object({
    kind: z.literal("merge"),
    proposalId,
    sourceCategoryId: z.string().uuid(),
    target: refSchema,
    ...clientCounts,
  }).strict(),
  z.object({
    kind: z.literal("delete"),
    proposalId,
    sourceCategoryId: z.string().uuid(),
    ...clientCounts,
  }).strict(),
]);
export const applyCategoriesInputSchema = z.object({
  requestKey: z.string().uuid(),
  mode: z.enum(["supplement", "full"]),
  baseVersion: z.number().int().nonnegative(),
  accepted: z.array(appliedDiffSchema).max(50),
  ignored: z.array(ignoredDiffSchema).max(50),
  reclassifyAuto: z.boolean(),
}).strict();

export type AutoDestination = z.infer<typeof destinationSchema>;
export type AppliedDiff = z.infer<typeof appliedDiffSchema>;
export type ApplyCategoriesInput = z.infer<typeof applyCategoriesInputSchema>;

export type CategoryApplyErrorCode =
  | "VALIDATION"
  | "DUPLICATE_CATEGORY"
  | "CATEGORY_NOT_FOUND"
  | "STALE_TAXONOMY"
  | "MANUAL_CATEGORY_CONFLICT";

export class CategoryApplyError extends Error {
  constructor(public readonly code: CategoryApplyErrorCode) {
    super(code);
    this.name = "CategoryApplyError";
  }
}

export interface AppliedRun {
  id: string;
  requestKey: string;
  status: string;
  baseVersion: number;
  appliedVersion: number;
  reclassifyGeneration: number;
  counts: {
    added: number;
    renamed: number;
    merged: number;
    deleted: number;
    ignored: number;
  };
}

interface ApplyDependencies {
  publish?: (payload: { runId: string; generation: number }) => Promise<void>;
  now?: () => Date;
  logger?: Pick<typeof logger, "info">;
  afterImpactLock?: () => Promise<void>;
}

function toRun(run: typeof categoryChangeRuns.$inferSelect): AppliedRun {
  if (run.appliedVersion === null) throw new Error("RUN_NOT_APPLIED");
  return {
    id: run.id,
    requestKey: run.requestKey,
    status: run.status,
    baseVersion: run.baseVersion,
    appliedVersion: run.appliedVersion,
    reclassifyGeneration: run.reclassifyGeneration,
    counts: {
      added: run.addedCount,
      renamed: run.renamedCount,
      merged: run.mergedCount,
      deleted: run.deletedCount,
      ignored: run.ignoredCount,
    },
  };
}

function sanitizedDiff<T extends { autoCount?: number; manualCount?: number }>(
  diff: T,
): Record<string, unknown> {
  const trusted: Record<string, unknown> = { ...diff };
  delete trusted.autoCount;
  delete trusted.manualCount;
  return trusted;
}

function resolveRef(
  ref: z.infer<typeof refSchema>,
  proposalIds: Map<string, string>,
): string | undefined {
  return ref.kind === "existing" ? ref.categoryId : proposalIds.get(ref.proposalId);
}

function mapApplyError(error: unknown): never {
  if (error instanceof CategoryApplyError) throw error;
  if (error instanceof CategoryError) {
    if (error.code === "DUPLICATE_CATEGORY") throw new CategoryApplyError(error.code);
    throw new CategoryApplyError(error.code === "CATEGORY_NOT_FOUND" ? error.code : "VALIDATION");
  }
  throw error;
}

export async function applyCategoryDiff(
  rawInput: ApplyCategoriesInput,
  dependencies: ApplyDependencies = {},
): Promise<AppliedRun> {
  const parsed = applyCategoriesInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new CategoryApplyError("VALIDATION");
  const input = parsed.data;
  const requestedSnapshotAt = dependencies.now?.();
  const log = dependencies.logger ?? logger;

  let applied: AppliedRun;
  try {
    applied = await db.transaction(async (tx) => {
      const state = await lockCategoryState(tx);
      const snapshotAt = requestedSnapshotAt ?? new Date((await tx.execute<{ now: Date }>(
        sql`select clock_timestamp() as now`,
      )).rows[0]!.now);
      const [existingRun] = await tx.select().from(categoryChangeRuns)
        .where(eq(categoryChangeRuns.requestKey, input.requestKey));
      if (existingRun) return toRun(existingRun);
      if (state.version !== input.baseVersion) throw new CategoryApplyError("STALE_TAXONOMY");

      const proposalIds = new Set<string>();
      const sourceIds = new Set<string>();
      for (const diff of input.accepted) {
        if (input.mode === "supplement" && diff.kind !== "add") {
          throw new CategoryApplyError("VALIDATION");
        }
        if (proposalIds.has(diff.proposalId)) throw new CategoryApplyError("VALIDATION");
        proposalIds.add(diff.proposalId);
        if (diff.kind !== "add") {
          if (sourceIds.has(diff.sourceCategoryId)) throw new CategoryApplyError("VALIDATION");
          sourceIds.add(diff.sourceCategoryId);
        }
      }

      const allCategories = await tx.select({ id: categories.id }).from(categories);
      const existingIds = new Set(allCategories.map((category) => category.id));
      if ([...sourceIds].some((id) => !existingIds.has(id))) {
        throw new CategoryApplyError("CATEGORY_NOT_FOUND");
      }
      const destructive = input.accepted.filter(
        (diff): diff is Extract<AppliedDiff, { kind: "merge" | "delete" }> =>
          diff.kind === "merge" || diff.kind === "delete",
      );
      const destructiveIds = destructive.map((diff) => diff.sourceCategoryId);
      if (destructiveIds.length > 0) {
        await tx.select({ id: items.id }).from(items)
          .where(inArray(items.categoryId, destructiveIds))
          .for("update");
      }
      await dependencies.afterImpactLock?.();
      if (destructiveIds.length > 0) {
        await tx.select({ id: categories.id }).from(categories)
          .where(inArray(categories.id, destructiveIds))
          .orderBy(asc(categories.id))
          .for("update");
      }
      const impact = destructiveIds.length === 0
        ? []
        : await tx.select({
            categoryId: items.categoryId,
            categoryManual: items.categoryManual,
          }).from(items).where(inArray(items.categoryId, destructiveIds)).for("update");
      if (impact.some((row) => row.categoryManual)) {
        throw new CategoryApplyError("MANUAL_CATEGORY_CONFLICT");
      }

      const createdByProposal = new Map<string, string>();
      for (const diff of input.accepted) {
        if (diff.kind !== "add") continue;
        const created = await createCategoryRecord(tx, { name: normalizeCategoryName(diff.name) });
        createdByProposal.set(diff.proposalId, created.id);
      }
      for (const diff of input.accepted) {
        if (diff.kind !== "rename") continue;
        await renameCategoryRecord(tx, diff.sourceCategoryId, {
          name: normalizeCategoryName(diff.name),
        });
      }

      const deleting = new Set(destructiveIds);
      const finalIds = new Set([...existingIds].filter((id) => !deleting.has(id)));
      for (const id of createdByProposal.values()) finalIds.add(id);
      for (const diff of destructive) {
        if (diff.kind === "merge") {
          const semanticTarget = resolveRef(diff.target, createdByProposal);
          if (!semanticTarget || !finalIds.has(semanticTarget)) {
            throw new CategoryApplyError("VALIDATION");
          }
        }
        if (diff.autoDestination.kind === "target") {
          const destination = resolveRef(diff.autoDestination.target, createdByProposal);
          if (!destination || !finalIds.has(destination)) {
            throw new CategoryApplyError("VALIDATION");
          }
        }
      }

      let movedUnclassified = 0;
      for (const diff of destructive) {
        const destination = diff.autoDestination.kind === "unclassified"
          ? null
          : resolveRef(diff.autoDestination.target, createdByProposal)!;
        const moved = await tx.update(items).set({ categoryId: destination }).where(and(
          eq(items.categoryId, diff.sourceCategoryId),
          eq(items.categoryManual, false),
        )).returning({ id: items.id });
        if (destination === null) movedUnclassified += moved.length;
        const [deleted] = await tx.delete(categories)
          .where(eq(categories.id, diff.sourceCategoryId))
          .returning({ id: categories.id });
        if (!deleted) throw new CategoryApplyError("CATEGORY_NOT_FOUND");
      }

      const appliedVersion = await advanceCategoryVersion(tx, { initialize: true });
      await tx.update(categoryChangeRuns).set({
        status: "superseded",
        updatedAt: snapshotAt,
        completedAt: snapshotAt,
      }).where(eq(categoryChangeRuns.status, "reclassifying"));
      const counts = {
        added: input.accepted.filter((diff) => diff.kind === "add").length,
        renamed: input.accepted.filter((diff) => diff.kind === "rename").length,
        merged: input.accepted.filter((diff) => diff.kind === "merge").length,
        deleted: input.accepted.filter((diff) => diff.kind === "delete").length,
        ignored: input.ignored.length,
      };
      const [run] = await tx.insert(categoryChangeRuns).values({
        requestKey: input.requestKey,
        mode: input.mode,
        baseVersion: input.baseVersion,
        appliedVersion,
        accepted: input.accepted.map(sanitizedDiff),
        ignored: input.ignored.map(sanitizedDiff),
        reclassifyRequested: input.reclassifyAuto,
        snapshotAt,
        status: input.reclassifyAuto ? "reclassifying" : "completed",
        addedCount: counts.added,
        renamedCount: counts.renamed,
        mergedCount: counts.merged,
        deletedCount: counts.deleted,
        ignoredCount: counts.ignored,
        manualProtected: 0,
        movedUnclassified,
        completedAt: input.reclassifyAuto ? null : snapshotAt,
        updatedAt: snapshotAt,
      }).returning();
      if (!run) throw new Error("RUN_CREATE_FAILED");
      return toRun(run);
    });
  } catch (error) {
    mapApplyError(error);
  }

  if (applied.status === "reclassifying" && dependencies.publish) {
    try {
      await dependencies.publish({ runId: applied.id, generation: applied.reclassifyGeneration });
    } catch {
      log.info("category_reclassify_publish", { ok: false, runId: applied.id });
    }
  }
  log.info("category_apply", {
    ok: true,
    mode: input.mode,
    status: applied.status,
    added: applied.counts.added,
    renamed: applied.counts.renamed,
    merged: applied.counts.merged,
    deleted: applied.counts.deleted,
  });
  return applied;
}
