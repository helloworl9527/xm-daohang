// @vitest-environment node
import { describe, expect, it } from "vitest";
import { searchPublicCorpus } from "@/lib/items/publicCorpus";

describe("public corpus literal keyword query", () => {
  it("escapes LIKE metacharacters and parameterizes the complete pattern", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const rows = await searchPublicCorpus("100%_\\safe", { query: async (text, values) => { calls.push({ text, values }); return { rows: [] }; } });
    expect(rows).toEqual([]);
    expect(calls[0]?.text).toContain("ilike $1 escape '\\'");
    expect(calls[0]?.values).toEqual(["%100\\%\\_\\\\safe%"]);
    expect(calls[0]?.text).toContain("status = 'completed'");
    expect(calls[0]?.text).toContain("type in ('web', 'github')");
    expect(calls[0]?.text).not.toMatch(/embedding|generateLlm|retrieve/);
  });
});
