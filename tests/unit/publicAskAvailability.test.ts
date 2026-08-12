// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("public ask availability architecture", () => {
  it("uses completed ask corpus independently from daily directory content", async () => {
    const source = await readFile("src/app/(public)/page.tsx", "utf8");
    expect(source).toContain("hasCompletedAskCorpus()");
    expect(source).toContain("getPublicAskReadiness()");
    expect(source).toContain("const disabledReason = !hasAskCorpus");
    expect(source).not.toContain("const disabledReason = dailyItems.length");
  });
});
