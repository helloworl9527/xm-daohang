// @vitest-environment node

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { cleanupRetention, recordWorkerHeartbeat } from "@/worker/jobs/maintenance";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString });
const now = new Date("2026-08-09T12:00:00.000Z");
const originalTimezone = process.env.APP_TIMEZONE;

describe("worker maintenance", () => {
  beforeAll(() => {
    process.env.APP_TIMEZONE = "Asia/Shanghai";
  });
  beforeEach(async () => {
    await pool.query(
      "delete from telegram_receipts; delete from processing_requests; delete from daily_selections; delete from ask_counters; delete from login_attempts; delete from worker_heartbeats; delete from items; delete from app_settings",
    );
    await pool.query("insert into app_settings (id) values (1)");
  });
  afterAll(async () => {
    await pool.end();
    if (originalTimezone === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTimezone;
  });

  it("upserts a versioned worker heartbeat", async () => {
    await recordWorkerHeartbeat("worker-a", "0.1.0", now, pool);
    await recordWorkerHeartbeat("worker-a", "0.1.1", new Date(now.getTime() + 1_000), pool);
    const result = await pool.query("select worker_id, seen_at, version from worker_heartbeats");
    expect(result.rows).toEqual([{ worker_id: "worker-a", seen_at: new Date(now.getTime() + 1_000), version: "0.1.1" }]);
  });

  it("deletes only terminal rows older than each retention boundary", async () => {
    const item = await pool.query<{ id: string }>(
      `insert into items (url, url_canonical, type, source) values ('https://example.com/a', 'https://example.com/a', 'web', 'admin') returning id`,
    );
    const itemId = item.rows[0]!.id;
    await pool.query(
      `insert into ask_counters (day, scope, count) values
        ('2026-07-07', 'old', 1), ('2026-07-08', 'boundary', 1)`,
    );
    await pool.query(
      `insert into login_attempts (ip_hash, at, success) values
        ('old', $1::timestamptz - interval '30 days 1 second', false),
        ('boundary', $1::timestamptz - interval '30 days', false)`, [now],
    );
    await pool.query(
      `insert into processing_requests (item_id, process_generation, emb_version, status, next_attempt_at) values
        ($2, 1, 1, 'done', $1::timestamptz - interval '30 days 1 second'),
        ($2, 2, 1, 'failed', $1::timestamptz - interval '30 days'),
        ($2, 3, 1, 'running', $1::timestamptz - interval '90 days')`, [now, itemId],
    );
    await pool.query(
      `insert into telegram_receipts (item_id, process_generation, chat_id_hash, chat_id_enc, outcome, status, next_attempt_at, sent_at) values
        ($2, 1, 'old', 'enc', 'completed', 'sent', $1, $1::timestamptz - interval '30 days 1 second'),
        ($2, 2, 'boundary', 'enc', 'failed', 'failed', $1::timestamptz - interval '30 days', null),
        ($2, 3, 'active', 'enc', null, 'waiting', $1::timestamptz - interval '90 days', null)`, [now, itemId],
    );
    await pool.query(
      `insert into daily_selections (day, rank, item_id) values
        ('2025-07-04', 1, $1), ('2025-07-05', 1, $1)`, [itemId],
    );

    await cleanupRetention(now, pool);

    expect((await pool.query("select scope from ask_counters order by scope")).rows).toEqual([{ scope: "boundary" }]);
    expect((await pool.query("select ip_hash from login_attempts order by ip_hash")).rows).toEqual([{ ip_hash: "boundary" }]);
    expect((await pool.query("select process_generation from processing_requests order by process_generation")).rows).toEqual([{ process_generation: 2 }, { process_generation: 3 }]);
    expect((await pool.query("select chat_id_hash from telegram_receipts order by chat_id_hash")).rows).toEqual([{ chat_id_hash: "active" }, { chat_id_hash: "boundary" }]);
    expect((await pool.query("select day::text from daily_selections")).rows).toEqual([{ day: "2025-07-05" }]);
  });
});
