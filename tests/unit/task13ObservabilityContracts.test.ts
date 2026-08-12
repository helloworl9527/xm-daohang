// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const contracts = [
  ["src/lib/categories/propose.ts", "category_proposal_generated"],
  ["src/lib/categories/apply.ts", "category_diff_applied"],
  ["src/worker/jobs/processItem.ts", "category_classified"],
  ["src/lib/categories/apply.ts", "category_reclassify_progress"],
  ["src/lib/categories/reclassify.ts", "category_reclassify_progress"],
  ["src/worker/jobs/reclassifyCategories.ts", "category_reclassify_progress"],
  ["src/worker/jobs/reclassifyCategories.ts", "category_reclassify_finished"],
  ["src/lib/search/keyword.ts", "keyword_search_limited"],
  ["src/lib/search/keyword.ts", "keyword_search_completed"],
] as const;

const allowedDimensions = new Set(["mode", "outcome", "count", "ms", "version", "errorCode"]);

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Task 13 observability contracts", () => {
  it("keeps every required event and only approved dimensions", () => {
    for (const [path, event] of contracts) {
      const text = source(path);
      const calls = [...text.matchAll(new RegExp(`(?:log|logger)\\.info\\(\\s*["']${event}["']\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, "g"))];
      expect(calls.length, `${event} must be emitted by ${path}`).toBeGreaterThan(0);
      for (const call of calls) {
        const keys = [...call[1]!.matchAll(/(?:^|,)\s*([A-Za-z][A-Za-z0-9]*)\s*(?=:|,|$)/gm)].map((match) => match[1]!);
        expect(keys.length, `${event} must have an explicit structured payload`).toBeGreaterThan(0);
        expect(keys.filter((key) => !allowedDimensions.has(key)), `${event} contains an unapproved dimension`).toEqual([]);
      }
    }
  });

  it("does not retain superseded category or keyword event names", () => {
    const combined = [...new Set(contracts.map(([path]) => path))].map(source).join("\n");
    for (const oldEvent of [
      "category_proposal",
      "category_apply",
      "category_reclassified",
      "category_reclassify_publish",
      "keyword_search",
    ]) {
      expect(combined).not.toMatch(new RegExp(`["']${oldEvent}["']`));
    }
  });
});
