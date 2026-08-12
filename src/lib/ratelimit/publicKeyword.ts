import { createHmac } from "node:crypto";
import { pool } from "@/db/client";
import { businessDay } from "@/lib/time/businessDay";

export type PublicKeywordLimitResult = { allowed: true } | { allowed: false; reason: "ip" | "global" };

export class PublicKeywordUnavailableError extends Error {
  readonly code = "SEARCH_UNAVAILABLE";
}

function hashIp(ip: string, day: string): string {
  const key = process.env.IP_HASH_KEY;
  if (!key || Buffer.byteLength(key) < 32) throw new PublicKeywordUnavailableError();
  return createHmac("sha256", key).update(`${day}\0${ip}`).digest("hex");
}

export async function consumePublicKeyword(ip: string, now = new Date()): Promise<PublicKeywordLimitResult> {
  const client = await pool.connect();
  let settled = false;
  try {
    await client.query("begin");
    const settings = await client.query<{ enabled: boolean; ip_daily: number; global_daily: number }>(
      "select ratelimit_enabled enabled, ratelimit_ip_daily ip_daily, ratelimit_global_daily global_daily from app_settings where id = 1 for update",
    );
    const row = settings.rows[0];
    if (!row) throw new PublicKeywordUnavailableError();
    if (!row.enabled) {
      await client.query("commit"); settled = true; return { allowed: true };
    }
    const day = businessDay(now);
    const ipScope = `kw:ip:${hashIp(ip, day)}`;
    const scopes = ["kw:global", ipScope];
    for (const scope of scopes) await client.query(
      "insert into ask_counters (day, scope, count) values ($1, $2, 0) on conflict do nothing", [day, scope],
    );
    const counts = await client.query<{ scope: string; count: number }>(
      "select scope, count from ask_counters where day = $1 and scope = any($2::text[]) for update", [day, scopes],
    );
    const count = new Map(counts.rows.map((entry) => [entry.scope, Number(entry.count)]));
    if (count.get("kw:global") === undefined || count.get(ipScope) === undefined) throw new PublicKeywordUnavailableError();
    if (count.get("kw:global")! >= row.global_daily) { await client.query("rollback"); settled = true; return { allowed: false, reason: "global" }; }
    if (count.get(ipScope)! >= row.ip_daily) { await client.query("rollback"); settled = true; return { allowed: false, reason: "ip" }; }
    await client.query("update ask_counters set count = count + 1 where day = $1 and scope = any($2::text[])", [day, scopes]);
    await client.query("commit"); settled = true; return { allowed: true };
  } catch (error) {
    if (!settled) await client.query("rollback").catch(() => undefined);
    if (error instanceof PublicKeywordUnavailableError) throw error;
    throw new PublicKeywordUnavailableError();
  } finally { client.release(); }
}
