// @vitest-environment node

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { items } from "@/db/schema";

type SearchRow = { id: string; score: number };

async function exactSearch(vector: number[], version: number): Promise<SearchRow[]> {
  const literal = `[${vector.join(",")}]`;
  const result = await pool.query<SearchRow>(
    `select id, 1 - (embedding <=> $1::vector) as score
       from items
      where status = 'completed'
        and embedding is not null
        and embedding_version = $2
        and embedding_dim = $3
      order by embedding <=> $1::vector, id
      limit 10`,
    [literal, version, vector.length],
  );
  return result.rows.map((row) => ({ ...row, score: Number(row.score) }));
}

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Vector integration tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(items);
});

afterAll(async () => {
  await pool.end();
});

describe("pgvector exact cosine scan", () => {
  it("rejects embeddings without required metadata", async () => {
    await expect(
      pool.query(
        `insert into items
          (url, url_canonical, type, status, source, tags, embedding)
         values
          ('https://example.com/missing-metadata', 'https://example.com/missing-metadata',
           'web', 'completed', 'admin', array['vector', 'invalid', 'fixture'], '[1,2]'::vector)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects embeddings whose declared dimension does not match the vector", async () => {
    await expect(
      pool.query(
        `insert into items
          (url, url_canonical, type, status, source, tags,
           embedding, embedding_dim, embedding_version)
         values
          ('https://example.com/wrong-dimension', 'https://example.com/wrong-dimension',
           'web', 'completed', 'admin', array['vector', 'invalid', 'fixture'],
           '[1,2]'::vector, 3, 1)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("stores mixed dimensions and filters before distance evaluation", async () => {
    const common = {
      type: "web" as const,
      source: "admin" as const,
      status: "completed" as const,
      tags: ["vector", "search", "fixture"],
    };
    const inserted = await db
      .insert(items)
      .values([
        {
          ...common,
          url: "https://example.com/closest",
          urlCanonical: "https://example.com/closest",
          embedding: [1, 0, 0],
          embeddingDim: 3,
          embeddingVersion: 4,
        },
        {
          ...common,
          url: "https://example.com/second",
          urlCanonical: "https://example.com/second",
          embedding: [0.8, 0.2, 0],
          embeddingDim: 3,
          embeddingVersion: 4,
        },
        {
          ...common,
          url: "https://example.com/far",
          urlCanonical: "https://example.com/far",
          embedding: [0, 1, 0],
          embeddingDim: 3,
          embeddingVersion: 4,
        },
        {
          ...common,
          url: "https://example.com/other-dimension",
          urlCanonical: "https://example.com/other-dimension",
          embedding: [1, 0],
          embeddingDim: 2,
          embeddingVersion: 4,
        },
        {
          ...common,
          url: "https://example.com/other-version",
          urlCanonical: "https://example.com/other-version",
          embedding: [1, 0, 0, 0],
          embeddingDim: 4,
          embeddingVersion: 3,
        },
      ])
      .returning({ id: items.id, canonical: items.urlCanonical });

    const rows = await exactSearch([1, 0, 0], 4);
    const expected = ["closest", "second", "far"].map(
      (suffix) => inserted.find((row) => row.canonical.endsWith(suffix))?.id,
    );
    expect(rows.map((row) => row.id)).toEqual(expected);
    expect(rows[0].score).toBeCloseTo(1, 6);
  });

  it("uses only the approved ordinary partial filter index", async () => {
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'items' order by indexname",
    );
    const retrievable = indexes.rows.find((row) => row.indexname === "items_retrievable_idx");

    expect(retrievable?.indexdef).toContain("USING btree (status, embedding_version, embedding_dim)");
    expect(retrievable?.indexdef).toContain("WHERE (embedding IS NOT NULL)");
    expect(indexes.rows.map((row) => row.indexdef).join("\n")).not.toMatch(/hnsw|ivfflat/i);
  });

  it("records exact recall@10 and P95 at 100/500/1000 rows", async () => {
    const evidence: Array<{ size: number; recallAt10: number; p95Ms: number; plan: string }> = [];

    for (const size of [100, 500, 1_000]) {
      await db.delete(items);
      const fixtures = Array.from({ length: size }, (_, index) => {
        const angle = index * 0.003;
        return {
          url: `https://benchmark.example/${size}/${index}`,
          urlCanonical: `https://benchmark.example/${size}/${index}`,
          type: "web" as const,
          source: "admin" as const,
          status: "completed" as const,
          tags: ["vector", "benchmark", "fixture"],
          embedding: [Math.cos(angle), Math.sin(angle), 0, 0, 0, 0, 0, 0],
          embeddingDim: 8,
          embeddingVersion: 7,
        };
      });
      const inserted = await db.insert(items).values(fixtures).returning({ id: items.id });
      await db.execute(sql`analyze ${items}`);

      const expected = inserted.slice(0, 10).map((row) => row.id);
      const durations: number[] = [];
      let actual: string[] = [];
      for (let run = 0; run < 20; run += 1) {
        const startedAt = performance.now();
        actual = (await exactSearch([1, 0, 0, 0, 0, 0, 0, 0], 7)).map((row) => row.id);
        durations.push(performance.now() - startedAt);
      }
      const matches = actual.filter((id) => expected.includes(id)).length;
      const sorted = [...durations].sort((left, right) => left - right);
      const explain = await pool.query<{ "QUERY PLAN": string }>(
        `explain select id from items
          where status = 'completed' and embedding is not null
            and embedding_version = 7 and embedding_dim = 8
          order by embedding <=> '[1,0,0,0,0,0,0,0]'::vector, id limit 10`,
      );
      const plan = explain.rows.map((row) => row["QUERY PLAN"]).join(" | ");
      evidence.push({
        size,
        recallAt10: matches / 10,
        p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
        plan,
      });

      expect(actual).toEqual(expected);
      expect(matches).toBe(10);
      expect(evidence.at(-1)?.p95Ms).toBeLessThan(2_000);
    }

    console.info(`VECTOR_BENCHMARK ${JSON.stringify(evidence)}`);
  });
});
