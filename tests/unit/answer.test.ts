// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { answerFromHits } from "@/lib/ai/answer";
import type { LlmRequest } from "@/lib/ai/llm";
import type { SearchHit } from "@/lib/search/retrieve";

const hits: SearchHit[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "PostgreSQL 向量检索",
    summary: "介绍 pgvector 的精确余弦检索。",
    url: "https://example.com/vector",
    tags: ["PostgreSQL", "pgvector", "检索"],
    score: 0.95,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "RAG 实践",
    summary: "仅使用检索命中来归纳回答。",
    url: "https://example.com/rag",
    tags: ["RAG", "AI", "归纳"],
    score: 0.9,
  },
];

describe("answer schema and citation boundary", () => {
  it("accepts a Chinese answer whose citation IDs are all server-provided hits", async () => {
    const generate = vi.fn(async (request: LlmRequest) => {
      void request;
      return JSON.stringify({
        answer: "可以用 pgvector 做精确余弦检索，并仅基于命中条目归纳。",
        citationIds: hits.map((hit) => hit.id),
      });
    });
    const result = await answerFromHits("如何实现向量检索？", hits, { generate });

    expect(result.citationIds).toEqual(hits.map((hit) => hit.id));
    expect(generate.mock.calls[0]?.[0].system).toContain("仅能使用提供的收藏条目");
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["unknown citation", JSON.stringify({ answer: "答案", citationIds: ["33333333-3333-4333-8333-333333333333"] })],
    ["extra field", JSON.stringify({ answer: "答案", citationIds: [], extra: true })],
    ["empty answer", JSON.stringify({ answer: "", citationIds: [] })],
  ])("rejects %s without inventing or repairing model output", async (_label, output) => {
    await expect(answerFromHits("query", hits, { generate: async () => output }))
      .rejects.toMatchObject({ code: "UPSTREAM_INVALID_OUTPUT" });
  });
});
