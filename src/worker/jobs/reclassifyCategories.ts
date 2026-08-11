import { classifyItem, type ClassificationInput, type ClassificationOutcome } from "@/lib/categories/classify";
import {
  commitReclassifyDecision,
  finishCategoryReclassification,
  getCategoryRun,
  loadReclassifyContext,
  type CategoryReclassifyPayload,
  type ReclassifyDecision,
} from "@/lib/categories/reclassify";
import { logger } from "@/lib/log/logger";

interface ReclassifyDependencies {
  classify?: (input: ClassificationInput) => Promise<ClassificationOutcome>;
  afterItem?: (itemId: string) => Promise<void>;
}

function toDecision(outcome: ClassificationOutcome): ReclassifyDecision {
  if (outcome.outcome === "selected") {
    return { outcome: "selected", categoryId: outcome.categoryId };
  }
  if (outcome.outcome === "unclassified") return { outcome: "unclassified" };
  return {
    outcome: "failure",
    errorCode: outcome.outcome === "upstream_error" ? "AI_UPSTREAM_FAILED" : "AI_OUTPUT_INVALID",
  };
}

export async function reclassifyCategoriesJob(
  payload: CategoryReclassifyPayload,
  dependencies: ReclassifyDependencies = {},
): Promise<"completed" | "partial" | "superseded" | "ignored"> {
  const classify = dependencies.classify ?? classifyItem;
  let retryCursor: string | undefined;
  for (;;) {
    const context = await loadReclassifyContext(payload, retryCursor);
    if (!context) {
      const run = await getCategoryRun(payload.runId);
      if (run.status === "superseded") return "superseded";
      if (run.status === "completed" || run.status === "partial") return run.status;
      return "ignored";
    }
    if (context.items.length === 0) {
      return finishCategoryReclassification(context);
    }
    for (const item of context.items) {
      if (
        context.retryOnly &&
        (item.categoryManual || item.status !== "completed" || (item.type !== "web" && item.type !== "github"))
      ) {
        const result = await commitReclassifyDecision(context, item, {
          outcome: "failure",
          errorCode: "AI_OUTPUT_INVALID",
        });
        logger.info("category_reclassified", { outcome: result });
        retryCursor = item.id;
        await dependencies.afterItem?.(item.id);
        continue;
      }
      let outcome: ClassificationOutcome;
      try {
        outcome = await classify({
          title: item.title,
          summary: item.summary,
          tags: item.tags,
          categories: context.categories,
        });
      } catch {
        outcome = { outcome: "upstream_error" };
      }
      const result = await commitReclassifyDecision(context, item, toDecision(outcome));
      logger.info("category_reclassified", { outcome: result });
      if (result === "superseded") return "superseded";
      if (context.retryOnly) retryCursor = item.id;
      await dependencies.afterItem?.(item.id);
    }
  }
}
