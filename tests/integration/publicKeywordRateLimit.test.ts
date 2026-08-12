// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db/client";
import { consumePublicKeyword } from "@/lib/ratelimit/publicKeyword";

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
});
