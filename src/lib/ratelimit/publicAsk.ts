import { createHmac } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { pool } from "@/db/client";
import { businessDay } from "@/lib/time/businessDay";

interface ReadinessRow extends QueryResultRow {
  llm_base_url: string | null;
  llm_model: string | null;
  llm_key_enc: string | null;
  emb_base_url: string | null;
  emb_model: string | null;
  emb_key_enc: string | null;
  emb_dim: number | null;
  emb_version: number;
  search_min_cosine: number | null;
  emb_rebuild_status: string;
  ratelimit_enabled: boolean;
  ratelimit_ip_daily: number;
  ratelimit_global_daily: number;
}

type Queryable = Pick<PoolClient, "query">;

export class PublicAskUnavailableError extends Error {
  readonly code = "MODEL_UNAVAILABLE";

  constructor() {
    super("MODEL_UNAVAILABLE");
  }
}

function isReady(row: ReadinessRow | undefined): row is ReadinessRow {
  return Boolean(
    row &&
      row.llm_base_url &&
      row.llm_model &&
      row.llm_key_enc &&
      row.emb_base_url &&
      row.emb_model &&
      row.emb_key_enc &&
      row.emb_dim &&
      row.emb_dim > 0 &&
      row.emb_version >= 0 &&
      row.search_min_cosine !== null &&
      row.search_min_cosine >= -1 &&
      row.search_min_cosine <= 1 &&
      row.emb_rebuild_status === "ready",
  );
}

async function readReadiness(queryable: Queryable, lock: boolean): Promise<ReadinessRow> {
  const result = await queryable.query<ReadinessRow>(
    `select llm_base_url, llm_model, llm_key_enc,
            emb_base_url, emb_model, emb_key_enc, emb_dim, emb_version,
            search_min_cosine, emb_rebuild_status,
            ratelimit_enabled, ratelimit_ip_daily, ratelimit_global_daily
       from app_settings where id = 1${lock ? " for update" : ""}`,
  );
  const row = result.rows[0];
  if (!isReady(row)) throw new PublicAskUnavailableError();
  return row;
}

export async function getPublicAskReadiness(queryable: Queryable = pool): Promise<void> {
  await readReadiness(queryable, false);
}

function hashIp(ip: string, day: string): string {
  const key = process.env.IP_HASH_KEY;
  if (!key || Buffer.byteLength(key) < 32) throw new PublicAskUnavailableError();
  return createHmac("sha256", key).update(`${day}\0${ip}`).digest("hex");
}

export type PublicAskLimitResult = { allowed: true } | { allowed: false; reason: "ip" | "global" };

export async function consumePublicAsk(ip: string, now = new Date()): Promise<PublicAskLimitResult> {
  const client = await pool.connect();
  let settled = false;
  try {
    await client.query("begin");
    const settings = await readReadiness(client, true);
    if (!settings.ratelimit_enabled) {
      await client.query("commit");
      settled = true;
      return { allowed: true };
    }

    const day = businessDay(now);
    const ipScope = `ip:${hashIp(ip, day)}`;
    for (const scope of ["global", ipScope]) {
      await client.query(
        "insert into ask_counters (day, scope, count) values ($1, $2, 0) on conflict do nothing",
        [day, scope],
      );
    }
    const globalResult = await client.query<{ count: number }>(
      "select count from ask_counters where day = $1 and scope = 'global' for update",
      [day],
    );
    const ipResult = await client.query<{ count: number }>(
      "select count from ask_counters where day = $1 and scope = $2 for update",
      [day, ipScope],
    );
    const globalCount = globalResult.rows[0]?.count;
    const ipCount = ipResult.rows[0]?.count;
    if (globalCount === undefined || ipCount === undefined) throw new PublicAskUnavailableError();

    if (globalCount >= settings.ratelimit_global_daily) {
      await client.query("rollback");
      settled = true;
      return { allowed: false, reason: "global" };
    }
    if (ipCount >= settings.ratelimit_ip_daily) {
      await client.query("rollback");
      settled = true;
      return { allowed: false, reason: "ip" };
    }
    await client.query(
      "update ask_counters set count = count + 1 where day = $1 and scope in ('global', $2)",
      [day, ipScope],
    );
    await client.query("commit");
    settled = true;
    return { allowed: true };
  } catch (error) {
    if (!settled) await client.query("rollback").catch(() => undefined);
    if (error instanceof PublicAskUnavailableError) throw error;
    throw new PublicAskUnavailableError();
  } finally {
    client.release();
  }
}
