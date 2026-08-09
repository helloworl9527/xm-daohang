// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings, dailySelections, items } from "@/db/schema";
import { pickDaily } from "@/lib/items/daily";
import { retrieve } from "@/lib/search/retrieve";

const tags = ["semantic", "search", "fixture"];

async function seedItem(
  suffix: string,
  embedding: number[] | null,
  overrides: Partial<typeof items.$inferInsert> = {},
) {
  const [row] = await db
    .insert(items)
    .values({
      url: `https://example.com/${suffix}`,
      urlCanonical: `https://example.com/${suffix}`,
      type: "web",
      title: suffix,
      summary: `关于 ${suffix} 的中文总结。`,
      tags,
      status: "completed",
      source: "admin",
      embedding,
      embeddingDim: embedding?.length ?? null,
      embeddingVersion: embedding ? 4 : null,
      ...overrides,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Retrieve tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(dailySelections);
  await db.delete(items);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    embBaseUrl: "https://models.example/v1",
    embModel: "embedding-v4",
    embKeyEnc: "configured",
    embDim: 3,
    embVersion: 4,
    searchMinCosine: 0.7,
    embRebuildStatus: "ready",
  });
});

afterAll(async () => {
  await pool.end();
});

describe("semantic retrieval", () => {
  it("returns calibrated positive fixtures in exact score order and rejects negatives", async () => {
    const expected = await Promise.all([
      seedItem("security-foundations", [1, 0, 0]),
      seedItem("zero-trust", [0.9, 0.1, 0]),
    ]);
    await seedItem("cake", [0, 1, 0]);

    const embed = vi.fn(async () => [1, 0, 0]);
    const hits = await retrieve("我想学习网络安全知识", { embed });

    expect(embed).toHaveBeenCalledOnce();
    expect(hits.map((hit) => hit.id)).toEqual(expected.map((item) => item.id));
    expect(hits[0].score).toBeCloseTo(1, 6);
    expect(hits.every((hit) => hit.score >= 0.7)).toBe(true);
  });

  it("isolates status, version and dimension before distance evaluation", async () => {
    const current = await seedItem("current", [1, 0, 0]);
    await seedItem("processing", [1, 0, 0], { status: "processing" });
    await seedItem("old-version", [1, 0, 0], { embeddingVersion: 3 });
    await seedItem("other-dimension", [1, 0], { embeddingDim: 2 });

    const hits = await retrieve("query", { embed: async () => [1, 0, 0] });

    expect(hits.map((hit) => hit.id)).toEqual([current.id]);
  });

  it("fails closed before embedding when settings or rebuild are not ready", async () => {
    const embed = vi.fn(async () => [1, 0, 0]);
    for (const status of ["unconfigured", "building", "failed"] as const) {
      await db.update(appSettings).set({ embRebuildStatus: status });
      await expect(retrieve("query", { embed })).rejects.toMatchObject({
        code: "SEARCH_UNAVAILABLE",
      });
    }
    expect(embed).not.toHaveBeenCalled();
  });

  it("caps exact recall at ten and drops every result below the live cutoff", async () => {
    const relevant = await Promise.all(
      Array.from({ length: 12 }, (_, index) => seedItem(`relevant-${index}`, [1, index / 100, 0])),
    );
    const hits = await retrieve("query", { embed: async () => [1, 0, 0] });
    expect(hits).toHaveLength(10);
    expect(new Set(hits.map((hit) => hit.id)).size).toBe(10);
    expect(hits.every((hit) => relevant.some((item) => item.id === hit.id))).toBe(true);

    await db.update(appSettings).set({ searchMinCosine: 1 });
    await seedItem("negative-only", [0, 1, 0]);
    const exactOnly = await retrieve("query", { embed: async () => [0, 1, 0] });
    expect(exactOnly.map((hit) => hit.title)).toEqual(["negative-only"]);
  });
});

describe("daily selection", () => {
  it("is stable for concurrent first visits and ignores same-day additions", async () => {
    await Promise.all(Array.from({ length: 6 }, (_, index) => seedItem(`daily-${index}`, null)));
    const [left, right] = await Promise.all([pickDaily("2026-08-09"), pickDaily("2026-08-09")]);
    expect(left).toEqual(right);
    expect(left).toHaveLength(3);

    await seedItem("late", null);
    await expect(pickDaily("2026-08-09")).resolves.toEqual(left);
  });

  it("rotates unseen items across days and repeats only after all were displayed", async () => {
    await Promise.all(Array.from({ length: 6 }, (_, index) => seedItem(`rotation-${index}`, null)));
    const first = await pickDaily("2026-08-09");
    const second = await pickDaily("2026-08-10");
    expect(second.filter((item) => first.some((prior) => prior.id === item.id))).toHaveLength(0);
    expect(new Set([...first, ...second].map((item) => item.id))).toHaveLength(6);

    const third = await pickDaily("2026-08-11");
    expect(third).toHaveLength(3);
  });

  it("returns the actual count and deterministically fills a deleted selection", async () => {
    await Promise.all([seedItem("only-1", null), seedItem("only-2", null)]);
    await expect(pickDaily("2026-08-09")).resolves.toHaveLength(2);

    await db.delete(dailySelections);
    await db.delete(items);
    await Promise.all(Array.from({ length: 4 }, (_, index) => seedItem(`fill-${index}`, null)));
    const selected = await pickDaily("2026-08-09");
    await db.delete(items).where(eq(items.id, selected[0].id));

    const filled = await pickDaily("2026-08-09");
    expect(filled).toHaveLength(3);
    expect(filled.filter((item) => selected.some((prior) => prior.id === item.id))).toHaveLength(2);
  });
});
