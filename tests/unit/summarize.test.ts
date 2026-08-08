// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { embedText, type EmbeddingDependencies } from "@/lib/ai/embedding";
import {
  summarizeContent,
  type SummaryGenerator,
} from "@/lib/ai/summarize";

const input = {
  title: "PostgreSQL 向量检索",
  content: "pgvector 在 PostgreSQL 中提供向量存储与余弦距离检索。",
};

describe("constrained Chinese summarization", () => {
  it("rejects an English-dominant summary that contains only a small Chinese fragment", async () => {
    const generate = vi.fn<SummaryGenerator>().mockResolvedValue(JSON.stringify({
      summary: "This report covers database design 中文内容。It also explains vector search in detail。",
      tags: ["database", "vector", "search"],
    }));

    await expect(summarizeContent(input, generate)).rejects.toMatchObject({
      code: "UPSTREAM_INVALID_OUTPUT",
      retryable: true,
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    "该文介绍 PostgreSQL 如何使用 pgvector 存储向量。读者可以结合 RAG 完成语义检索。",
    "该文介绍数据库中的向量存储方法。读者可以按照示例完成语义检索。",
  ])("accepts a Chinese-dominant summary with or without technical names", async (summary) => {
    const generate = vi.fn<SummaryGenerator>().mockResolvedValue(JSON.stringify({
      summary,
      tags: ["数据库", "向量检索", "PostgreSQL"],
    }));
    await expect(summarizeContent(input, generate)).resolves.toMatchObject({ summary });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("retries one invalid English response and returns only the corrected result", async () => {
    const generate = vi.fn<SummaryGenerator>()
      .mockResolvedValueOnce(JSON.stringify({
        summary: "This is an English summary. It is not acceptable.",
        tags: ["database", "vector", "search"],
      }))
      .mockResolvedValueOnce("```json\n" + JSON.stringify({
        summary: "该文介绍 pgvector 如何在 PostgreSQL 中存储向量。它还说明了使用余弦距离完成语义检索的方法。",
        tags: ["数据库", "向量检索", "PostgreSQL"],
      }) + "\n```" );

    await expect(summarizeContent(input, generate)).resolves.toEqual({
      summary: "该文介绍 pgvector 如何在 PostgreSQL 中存储向量。它还说明了使用余弦距离完成语义检索的方法。",
      tags: ["数据库", "向量检索", "PostgreSQL"],
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].correction).toBe(true);
  });

  it.each([
    { summary: "只有一句总结。", tags: ["一", "二", "三"] },
    { summary: `${"过长内容".repeat(130)}。这是第二句。`, tags: ["一", "二", "三"] },
    { summary: "这是第一句。这是第二句。", tags: ["一", "二"] },
    { summary: "这是第一句。这是第二句。", tags: ["一", "二", "三", "四", "五", "六"] },
  ])("throws a stable retryable error after two invalid outputs", async (invalid) => {
    const generate = vi.fn<SummaryGenerator>().mockResolvedValue(JSON.stringify(invalid));

    await expect(summarizeContent(input, generate)).rejects.toMatchObject({
      code: "UPSTREAM_INVALID_OUTPUT",
      retryable: true,
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not make a third model request", async () => {
    const generate = vi.fn<SummaryGenerator>()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce("still not json");
    await expect(summarizeContent(input, generate)).rejects.toMatchObject({
      code: "UPSTREAM_INVALID_OUTPUT",
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe("embedding client validation", () => {
  function dependencies(vector: number[], dimension = 3): EmbeddingDependencies {
    return {
      loadConfig: async () => ({
        baseUrl: "https://models.example/v1",
        model: "embedding-model",
        apiKey: "sk-test",
        dimension,
      }),
      requestEmbedding: vi.fn(async () => vector),
    };
  }

  it("returns a finite vector with the configured dimension", async () => {
    await expect(embedText("待嵌入文本", dependencies([0.1, 0.2, 0.3]))).resolves.toEqual([
      0.1, 0.2, 0.3,
    ]);
  });

  it.each([
    [[0.1, 0.2], "EMBEDDING_DIMENSION_MISMATCH"],
    [[0.1, Number.NaN, 0.3], "EMBEDDING_INVALID_VECTOR"],
    [[0, 0, 0], "EMBEDDING_INVALID_VECTOR"],
  ] as const)("rejects invalid vectors", async (vector, code) => {
    await expect(embedText("待嵌入文本", dependencies([...vector]))).rejects.toMatchObject({ code });
  });
});
