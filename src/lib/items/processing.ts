import { pool } from "@/db/client";

export interface ProcessingReceipt {
  chatIdHash: string;
  chatIdEnc: string;
}

export class ProcessingRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ProcessingRequestError";
  }
}

export async function requestProcessing(
  itemId: string,
  options: { receipt?: ProcessingReceipt } = {},
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const itemResult = await client.query<{ status: string; process_generation: number }>(
      "select status, process_generation from items where id = $1 for update",
      [itemId],
    );
    const item = itemResult.rows[0];
    if (!item) throw new ProcessingRequestError("ITEM_NOT_FOUND");

    if (item.status === "processing") {
      const active = await client.query(
        `select 1 from processing_requests
          where item_id = $1 and process_generation = $2
            and status in ('pending','queued','running') limit 1`,
        [itemId, item.process_generation],
      );
      if (active.rowCount) throw new ProcessingRequestError("ITEM_ALREADY_PROCESSING");
    }

    const settings = await client.query<{ emb_version: number }>(
      "select emb_version from app_settings where id = 1 for share",
    );
    const embVersion = settings.rows[0]?.emb_version;
    if (embVersion === undefined) throw new ProcessingRequestError("MODEL_NOT_CONFIGURED");
    const generation = item.process_generation + 1;
    await client.query(
      `update items set process_generation = $2, status = 'processing', fail_reason = null,
              updated_at = now() where id = $1`,
      [itemId, generation],
    );
    await client.query(
      `insert into processing_requests
        (item_id, process_generation, emb_version, attempt, status, next_attempt_at)
       values ($1, $2, $3, 0, 'pending', now())`,
      [itemId, generation, embVersion],
    );
    if (options.receipt) {
      await client.query(
        `insert into telegram_receipts
          (item_id, process_generation, chat_id_hash, chat_id_enc, outcome, status)
         values ($1, $2, $3, $4, null, 'waiting')
         on conflict (item_id, process_generation, chat_id_hash) do nothing`,
        [itemId, generation, options.receipt.chatIdHash, options.receipt.chatIdEnc],
      );
    }
    await client.query("commit");
    return generation;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
