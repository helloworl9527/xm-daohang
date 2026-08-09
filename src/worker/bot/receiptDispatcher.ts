import { pool } from "@/db/client";
import { decryptSecret } from "@/lib/crypto/secretbox";

export class TelegramTransportError extends Error {
  constructor(public readonly status: number, public readonly retryAfterSeconds?: number) {
    super("TELEGRAM_TRANSPORT_FAILED");
  }
}

export interface ReceiptTransport {
  send(chatId: string, text: string, idempotencyKey: string): Promise<void>;
  afterSend?: () => Promise<void>;
  now?: () => Date;
}

export interface DispatchResult {
  sent: boolean;
  duplicatePossible?: boolean;
}

function firstSentence(summary: string | null): string {
  if (!summary) return "内容已完成处理。";
  const match = summary.match(/^.*?[。！？!?](?:\s|$)/u);
  return (match?.[0] ?? summary).trim();
}

export async function dispatchTelegramReceipt(
  workerId: string,
  transport: ReceiptTransport,
): Promise<DispatchResult> {
  const now = transport.now?.() ?? new Date();
  const leaseUntil = new Date(now.getTime() + 30_000);
  const claimed = await pool.query<{
    id: string; item_id: string; chat_id_enc: string; outcome: "completed" | "failed";
    attempts: number; title: string | null; summary: string | null;
  }>(
    `with candidate as (
       select id from telegram_receipts
        where ((status = 'ready' and next_attempt_at <= $1)
           or (status = 'sending' and lease_until < $1))
        order by next_attempt_at, id for update skip locked limit 1
     ), claimed as (
       update telegram_receipts receipt
          set status = 'sending', leased_by = $2, lease_until = $3, attempts = attempts + 1
         from candidate where receipt.id = candidate.id
       returning receipt.*
     )
     select claimed.id, claimed.item_id, claimed.chat_id_enc, claimed.outcome,
            claimed.attempts, item.title, item.summary
       from claimed join items item on item.id = claimed.item_id`,
    [now, workerId, leaseUntil],
  );
  const receipt = claimed.rows[0];
  if (!receipt) return { sent: false };
  const duplicatePossible = receipt.attempts > 1;
  const chatId = decryptSecret(receipt.chat_id_enc);
  const text = receipt.outcome === "completed"
    ? `✅ 已收藏\n${firstSentence(receipt.summary)}`
    : "❌ 收藏失败，请稍后手动重试";
  try {
    await transport.send(chatId, text, receipt.id);
  } catch (error) {
    const retrySeconds = error instanceof TelegramTransportError && error.status === 429
      ? Math.max(1, error.retryAfterSeconds ?? 30)
      : 30;
    await pool.query(
      `update telegram_receipts set status = 'ready', leased_by = null, lease_until = null,
              next_attempt_at = $1
        where id = $2 and status = 'sending' and leased_by = $3`,
      [new Date(now.getTime() + retrySeconds * 1_000), receipt.id, workerId],
    );
    return { sent: false, duplicatePossible };
  }
  await transport.afterSend?.();
  await pool.query(
    `update telegram_receipts set status = 'sent', sent_at = $1, leased_by = null, lease_until = null
      where id = $2 and status = 'sending' and leased_by = $3`,
    [now, receipt.id, workerId],
  );
  return { sent: true, duplicatePossible };
}
