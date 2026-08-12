// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "@/db/client";
import { getPublicDirectory } from "@/lib/categories/publicDirectory";
import { searchPublicCorpus } from "@/lib/items/publicCorpus";

const PREFIX = "task13-performance-";

describe("Task 13 public corpus performance", () => {
  beforeAll(async () => {
    const database = await pool.query<{ current_database: string }>("select current_database()");
    if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("dedicated DB required");
  });
  beforeEach(async () => {
    await pool.query("delete from items where url like $1", [`https://${PREFIX}%`]);
    await pool.query(`insert into items (url,url_canonical,type,source,status,title,summary,tags)
      select 'https://${PREFIX}' || n || '.example', 'https://${PREFIX}' || n || '.example',
             case when n <= 500 then case when n % 2 = 0 then 'web' else 'github' end else 'doc' end,
             'admin', 'completed', case when n <= 500 then 'performance literal fixture ' || n else 'Task13 document ' || n end,
             'performance literal fixture', array['performance','literal','fixture']
        from generate_series(1,550) n`);
  });
  afterAll(async () => { await pool.query("delete from items where url like $1", [`https://${PREFIX}%`]); await pool.end(); });

  it("returns all 500 eligible directory sites with a bounded two-query plan", async () => {
    const calls: string[] = [];
    const groups = await getPublicDirectory({ query: async <T extends object>(text: string, values?: readonly unknown[]) => {
      calls.push(text); return pool.query<T>(text, values as unknown[]);
    } });
    expect(calls).toHaveLength(2);
    expect(groups.flatMap((group) => group.sites).filter((site) => site.url.includes(PREFIX))).toHaveLength(500);
  });

  it("keeps database keyword p95 below one second without including docs", async () => {
    const samples: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const started = performance.now();
      const matches = await searchPublicCorpus("performance literal");
      samples.push(performance.now() - started);
      expect(matches).toHaveLength(50);
      expect(matches.every((match) => match.title?.startsWith("performance literal fixture"))).toBe(true);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
    console.info(`TASK13_KEYWORD_BENCHMARK ${JSON.stringify({ samples: samples.length, p95Ms: Number(p95.toFixed(2)) })}`);
    expect(p95).toBeLessThan(1_000);
  });
});
