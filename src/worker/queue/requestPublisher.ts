import { pool } from "@/db/client";
import { PROCESS_ITEM_QUEUE } from "@/lib/queue/boss";

export interface ProcessingJobPayload {
  itemId: string;
  processGeneration: number;
  embVersion: number;
  attempt: number;
}

export interface ProcessingBoss {
  send(
    name: string,
    payload: ProcessingJobPayload,
    options: { singletonKey: string; retryLimit: number; startAfter: Date },
  ): Promise<string | null>;
}

export interface PublisherOptions {
  limit?: number;
  now?: Date;
  afterSend?: (payload: ProcessingJobPayload) => Promise<void>;
}

export async function publishPendingRequests(
  boss: ProcessingBoss,
  options: PublisherOptions = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const result = await pool.query<{
    item_id: string;
    process_generation: number;
    emb_version: number;
    attempt: number;
    next_attempt_at: Date;
  }>(
    `select r.item_id, r.process_generation, r.emb_version, r.attempt, r.next_attempt_at
       from processing_requests r
       join items i on i.id = r.item_id
       join app_settings s on s.id = 1
      where r.status = 'pending' and r.next_attempt_at <= $1
        and (i.type <> 'github' or s.github_backoff_until is null or s.github_backoff_until <= $1)
      order by r.next_attempt_at, r.item_id, r.attempt
      limit $2`,
    [now, options.limit ?? 100],
  );

  let published = 0;
  for (const row of result.rows) {
    const payload: ProcessingJobPayload = {
      itemId: row.item_id,
      processGeneration: row.process_generation,
      embVersion: row.emb_version,
      attempt: row.attempt,
    };
    const singletonKey = `${payload.itemId}:${payload.processGeneration}:${payload.attempt}`;
    await boss.send(PROCESS_ITEM_QUEUE, payload, {
      singletonKey,
      retryLimit: 0,
      startAfter: row.next_attempt_at,
    });
    await options.afterSend?.(payload);
    const marked = await pool.query(
      `update processing_requests set status = 'queued'
        where item_id = $1 and process_generation = $2 and attempt = $3 and status = 'pending'`,
      [payload.itemId, payload.processGeneration, payload.attempt],
    );
    published += marked.rowCount ?? 0;
  }
  return published;
}
