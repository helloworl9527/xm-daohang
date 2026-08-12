// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db/client";
import { consumePublicKeyword } from "@/lib/ratelimit/publicKeyword";
import { readFile } from "node:fs/promises";

describe("keyword rate limit fail closed", () => {
  beforeAll(async () => {
    const database = await pool.query<{ current_database: string }>("select current_database()");
    if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("requires collection_system_test");
  });
  beforeEach(async () => {
    process.env.IP_HASH_KEY = "keyword-test-hash-key-at-least-32-bytes";
    await pool.query("delete from ask_counters; delete from app_settings; insert into app_settings (id, ratelimit_enabled, ratelimit_ip_daily, ratelimit_global_daily) values (1,true,1,2)");
  });
  afterAll(async () => pool.end());

  it("requires the independent hash secret and never falls back to ask scope", async () => {
    const previous = process.env.IP_HASH_KEY;
    delete process.env.IP_HASH_KEY;
    await expect(consumePublicKeyword("203.0.113.7")).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE" });
    if (previous === undefined) delete process.env.IP_HASH_KEY;
    else process.env.IP_HASH_KEY = previous;
  });

  it("uses only kw scopes and enforces the independent IP limit", async () => {
    expect(await consumePublicKeyword("203.0.113.7", new Date("2026-08-12T00:00:00Z"))).toEqual({ allowed: true });
    expect(await consumePublicKeyword("203.0.113.7", new Date("2026-08-12T00:00:00Z"))).toEqual({ allowed: false, reason: "ip" });
    const scopes = await pool.query<{ scope: string }>("select scope from ask_counters order by scope");
    expect(scopes.rows.map((row) => row.scope)).toEqual(expect.arrayContaining(["kw:global"]));
    expect(scopes.rows.every((row) => row.scope.startsWith("kw:"))).toBe(true);
  });

  it("serializes same-IP concurrency without changing ask counters", async () => {
    await pool.query("update app_settings set ratelimit_ip_daily=2, ratelimit_global_daily=10 where id=1");
    await pool.query("insert into ask_counters(day,scope,count) values ('2026-08-12','global',7),('2026-08-12','ip:existing',4)");
    const results = await Promise.all(Array.from({ length: 8 }, () => consumePublicKeyword("203.0.113.8", new Date("2026-08-12T00:00:00Z"))));
    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    const ask = await pool.query<{ scope: string; count: number }>("select scope,count from ask_counters where scope in ('global','ip:existing') order by scope");
    expect(ask.rows).toEqual([{ scope: "global", count: 7 }, { scope: "ip:existing", count: 4 }]);
  });

  it("serializes distinct-IP concurrency at the global limit", async () => {
    await pool.query("update app_settings set ratelimit_ip_daily=10, ratelimit_global_daily=3 where id=1");
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => consumePublicKeyword(`203.0.113.${20 + index}`, new Date("2026-08-12T00:00:00Z"))));
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    const global = await pool.query<{ count: number }>("select count from ask_counters where day='2026-08-12' and scope='kw:global'");
    expect(global.rows[0]?.count).toBe(3);
  });

  it("keeps settings and counters inside the same row-lock barrier", async () => {
    const source = await readFile("src/lib/ratelimit/publicKeyword.ts", "utf8");
    expect(source).toContain("from app_settings where id = 1 for update");
    expect(source).toContain("scope = any($2::text[]) for update");
  });
});
