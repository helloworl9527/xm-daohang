// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const files = [
  "src/lib/search/keyword.ts",
  "src/lib/ratelimit/publicKeyword.ts",
  "src/lib/items/publicCorpus.ts",
  "src/app/(public)/search/route.ts",
];

describe("keyword search architecture", () => {
  it("has no AI, vector retrieval, or ask-handler dependency", async () => {
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(source).not.toMatch(/@\/lib\/ai|search\/retrieve|ask\/handler|embedText|generateLlmText/);
  });
});
