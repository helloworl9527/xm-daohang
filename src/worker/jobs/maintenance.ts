import type { Pool, PoolClient } from "pg";

import { pool as defaultPool } from "@/db/client";
import { businessDay } from "@/lib/time/businessDay";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface RetentionResult {
  askCounters: number;
  loginAttempts: number;
  processingRequests: number;
  telegramReceipts: number;
  dailySelections: number;
}

async function deleteBatch(queryable: Queryable, statement: string, values: unknown[]): Promise<number> {
  const result = await queryable.query(statement, values);
  return result.rowCount ?? 0;
}

export async function recordWorkerHeartbeat(
  workerId: string,
  version: string,
  seenAt = new Date(),
  queryable: Queryable = defaultPool,
): Promise<void> {
  await queryable.query(
    `insert into worker_heartbeats (worker_id, seen_at, version) values ($1, $2, $3)
     on conflict (worker_id) do update set seen_at = excluded.seen_at, version = excluded.version`,
    [workerId, seenAt, version],
  );
}

export async function cleanupRetention(
  now = new Date(),
  queryable: Queryable = defaultPool,
): Promise<RetentionResult> {
  const day = businessDay(now);
  const askCounters = await deleteBatch(queryable,
    `delete from ask_counters where (day, scope) in (
       select day, scope from ask_counters where day < $1::date - 32 order by day limit 1000
     )`, [day]);
  const loginAttempts = await deleteBatch(queryable,
    `delete from login_attempts where id in (
       select id from login_attempts where at < $1::timestamptz - interval '30 days' order by at limit 1000
     )`, [now]);
  const processingRequests = await deleteBatch(queryable,
    `delete from processing_requests where (item_id, process_generation, attempt) in (
       select item_id, process_generation, attempt from processing_requests
        where status in ('done', 'failed') and next_attempt_at < $1::timestamptz - interval '30 days'
        order by next_attempt_at limit 1000
     )`, [now]);
  const telegramReceipts = await deleteBatch(queryable,
    `delete from telegram_receipts where id in (
       select id from telegram_receipts
        where status in ('sent', 'failed')
          and coalesce(sent_at, next_attempt_at) < $1::timestamptz - interval '30 days'
        order by coalesce(sent_at, next_attempt_at) limit 1000
     )`, [now]);
  const dailySelections = await deleteBatch(queryable,
    `delete from daily_selections where (day, rank) in (
       select day, rank from daily_selections where day < $1::date - 400 order by day limit 1000
     )`, [day]);
  return { askCounters, loginAttempts, processingRequests, telegramReceipts, dailySelections };
}
