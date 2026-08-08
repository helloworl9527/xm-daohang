import type PgBoss from "pg-boss";

import { pool } from "@/db/client";
import { ProcessingRequestError, requestProcessing } from "@/lib/items/processing";

const GITHUB_BUDGET = 50;
const HOUR_MS = 60 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 100;
export const SCHEDULED_REFETCH_QUEUE = "scheduled-refetch";
export const SCHEDULED_REFETCH_SINGLETON = "scheduled-refetch-round";

export interface ScheduledRefetchOptions {
  now?: Date;
  batchSize?: number;
  hasGitHubToken?: boolean;
  random?: () => number;
  afterSnapshot?: () => Promise<void>;
  afterScheduled?: (itemId: string, processGeneration: number) => Promise<void>;
}

export interface ScheduledRefetchResult {
  status: "scheduled" | "disabled" | "already_ran";
  scheduled: number;
  skipped: number;
  deferredGitHub: number;
  snapshotAt: Date;
}

interface ScheduledItemRow {
  id: string;
  type: string;
  created_at: Date;
}

async function declareRound(now: Date): Promise<{
  status: "scheduled" | "disabled" | "already_ran";
  intervalDays: number;
  githubBackoffUntil: Date | null;
}> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<{
      refetch_enabled: boolean;
      refetch_interval_days: number;
      refetch_last_run: Date | null;
      github_backoff_until: Date | null;
    }>(
      `select refetch_enabled, refetch_interval_days, refetch_last_run, github_backoff_until
         from app_settings where id = 1 for update`,
    );
    const settings = result.rows[0];
    if (!settings) throw new Error("SETTINGS_NOT_FOUND");
    if (!settings.refetch_enabled) {
      await client.query("commit");
      return { status: "disabled", intervalDays: settings.refetch_interval_days, githubBackoffUntil: settings.github_backoff_until };
    }
    const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    if (settings.refetch_last_run && settings.refetch_last_run >= minuteStart) {
      await client.query("commit");
      return { status: "already_ran", intervalDays: settings.refetch_interval_days, githubBackoffUntil: settings.github_backoff_until };
    }
    await client.query("update app_settings set refetch_last_run = $1 where id = 1", [now]);
    await client.query("commit");
    return { status: "scheduled", intervalDays: settings.refetch_interval_days, githubBackoffUntil: settings.github_backoff_until };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function githubNextAttempt(
  index: number,
  now: Date,
  backoffUntil: Date | null,
  hasToken: boolean,
  random: () => number,
): { at: Date; deferred: boolean } {
  if (backoffUntil && backoffUntil > now) {
    return { at: new Date(backoffUntil.getTime() + random() * 6_000), deferred: true };
  }
  if (hasToken) return { at: now, deferred: false };
  const delay = Math.floor(index * HOUR_MS / GITHUB_BUDGET);
  const jitter = delay === 0 ? 0 : random() * Math.min(6_000, delay * 0.1);
  return { at: new Date(now.getTime() + delay + jitter), deferred: index >= GITHUB_BUDGET };
}

export async function runScheduledRefetch(
  options: ScheduledRefetchOptions = {},
): Promise<ScheduledRefetchResult> {
  const now = options.now ?? new Date();
  const round = await declareRound(now);
  const result: ScheduledRefetchResult = {
    status: round.status,
    scheduled: 0,
    skipped: 0,
    deferredGitHub: 0,
    snapshotAt: now,
  };
  if (round.status !== "scheduled") return result;
  await options.afterSnapshot?.();

  const cutoff = new Date(now.getTime() - round.intervalDays * 24 * 60 * 60 * 1_000);
  const hasToken = options.hasGitHubToken ?? Boolean(process.env.GITHUB_PUBLIC_API_TOKEN);
  const random = options.random ?? Math.random;
  let githubIndex = 0;
  let cursorCreatedAt: Date | null = null;
  let cursorId: string | null = null;

  while (true) {
    const page: ScheduledItemRow[] = (await pool.query<ScheduledItemRow>(
      `select id, type, created_at from items
        where status in ('completed','failed')
          and created_at <= $1 and updated_at <= $2
          and ($3::timestamptz is null or (created_at, id) > ($3, $4::uuid))
        order by created_at, id
        limit $5`,
      [now, cutoff, cursorCreatedAt, cursorId, options.batchSize ?? DEFAULT_BATCH_SIZE],
    )).rows;
    if (page.length === 0) break;

    for (const item of page) {
      let nextAttemptAt = now;
      let deferred = false;
      if (item.type === "github") {
        const schedule = githubNextAttempt(
          githubIndex,
          now,
          round.githubBackoffUntil,
          hasToken,
          random,
        );
        githubIndex += 1;
        nextAttemptAt = schedule.at;
        deferred = schedule.deferred;
      }
      let processGeneration: number;
      try {
        processGeneration = await requestProcessing(item.id, { nextAttemptAt });
      } catch (error) {
        if (error instanceof ProcessingRequestError && error.code === "ITEM_ALREADY_PROCESSING") {
          result.skipped += 1;
          continue;
        }
        result.skipped += 1;
        continue;
      }
      result.scheduled += 1;
      if (deferred) result.deferredGitHub += 1;
      await options.afterScheduled?.(item.id, processGeneration);
    }
    const last: ScheduledItemRow | undefined = page.at(-1);
    if (!last || page.length < (options.batchSize ?? DEFAULT_BATCH_SIZE)) break;
    cursorCreatedAt = last.created_at;
    cursorId = last.id;
  }
  return result;
}

export async function registerScheduledRefetch(boss: PgBoss): Promise<void> {
  await boss.createQueue(SCHEDULED_REFETCH_QUEUE, {
    name: SCHEDULED_REFETCH_QUEUE,
    policy: "short",
    retryLimit: 0,
  });
  await boss.schedule(SCHEDULED_REFETCH_QUEUE, "0 * * * *", {}, {
    tz: "UTC",
    singletonKey: SCHEDULED_REFETCH_SINGLETON,
    retryLimit: 0,
  });
}
