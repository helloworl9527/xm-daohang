import { createHmac } from "node:crypto";

import { Bot } from "grammy";

import { pool } from "@/db/client";
import { answerFromHits } from "@/lib/ai/answer";
import { getDecryptedSecret } from "@/lib/config/settings";
import { encryptSecret } from "@/lib/crypto/secretbox";
import { parsePublicGitHubUrl } from "@/lib/fetch/github";
import { assertPublicUrl as defaultAssertPublicUrl } from "@/lib/fetch/urlGuard";
import { manualRefetch } from "@/lib/items/refetch";
import {
  ProcessingRequestError,
  requestProcessingWithClient,
  type ProcessingReceipt,
} from "@/lib/items/processing";
import { getPublicAskReadiness } from "@/lib/ratelimit/publicAsk";
import { logger } from "@/lib/log/logger";
import { retrieve, type SearchHit } from "@/lib/search/retrieve";

export interface TelegramMessage {
  senderId: number;
  chatId: string;
  text: string;
}

export interface TelegramMessageDependencies {
  assertPublicUrl?: (url: string) => Promise<string>;
  send: (chatId: string, text: string) => Promise<void>;
  readiness?: () => Promise<void>;
  retrieve?: (question: string) => Promise<SearchHit[]>;
  answer?: (
    question: string,
    hits: readonly SearchHit[],
  ) => Promise<{ answer: string; citationIds: string[] }>;
  refetch?: (itemId: string) => Promise<{ processGeneration: number }>;
}

function hashKey(): string {
  const key = process.env.TG_ID_HASH_KEY;
  if (!key || Buffer.byteLength(key) < 32) throw new Error("TG_ID_HASH_KEY_INVALID");
  return key;
}

export function createTelegramReceipt(chatId: string): ProcessingReceipt {
  return {
    chatIdHash: createHmac("sha256", hashKey()).update(chatId).digest("hex"),
    chatIdEnc: encryptSecret(chatId),
  };
}

function urlsIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>()]+/gi) ?? [];
  return [...new Set(found.map((url) => url.replace(/[.,;!?\]\u3002，！？；]+$/u, "")))];
}

function itemType(canonicalUrl: string): "web" | "doc" | "github" {
  const url = new URL(canonicalUrl);
  if (url.hostname.toLowerCase() === "github.com") {
    parsePublicGitHubUrl(canonicalUrl);
    return "github";
  }
  return /\.(?:pdf|txt)$/i.test(url.pathname) ? "doc" : "web";
}

async function allowed(senderId: number): Promise<boolean> {
  const result = await pool.query<{ tg_allowed_ids: Array<number | string> }>(
    "select tg_allowed_ids from app_settings where id = 1",
  );
  const expected = String(senderId);
  return result.rows[0]?.tg_allowed_ids.some((id) => String(id) === expected) ?? false;
}

async function addFromTelegram(
  rawUrl: string,
  chatId: string,
  assertPublicUrl: (url: string) => Promise<string>,
): Promise<
  | { kind: "added" }
  | { kind: "duplicate"; itemId: string }
  | { kind: "invalid" }
  | { kind: "unavailable" }
> {
  let canonicalUrl: string;
  let type: "web" | "doc" | "github";
  try {
    canonicalUrl = await assertPublicUrl(rawUrl);
    type = itemType(canonicalUrl);
  } catch {
    return { kind: "invalid" };
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const settings = await client.query<Record<string, unknown>>(
      `select llm_base_url, llm_model, llm_key_enc, emb_base_url, emb_model, emb_key_enc, emb_dim
         from app_settings where id = 1 for share`,
    );
    const configured = settings.rows[0];
    if (!configured?.llm_base_url || !configured.llm_model || !configured.llm_key_enc ||
        !configured.emb_base_url || !configured.emb_model || !configured.emb_key_enc || !configured.emb_dim) {
      await client.query("rollback");
      return { kind: "unavailable" };
    }
    const inserted = await client.query<{ id: string }>(
      `insert into items (url, url_canonical, type, source, status)
       values ($1, $1, $2, 'telegram', 'processing')
       on conflict (url_canonical) do nothing returning id`,
      [canonicalUrl, type],
    );
    const item = inserted.rows[0];
    if (!item) {
      const existing = await client.query<{ id: string }>(
        "select id from items where url_canonical = $1",
        [canonicalUrl],
      );
      await client.query("commit");
      const existingId = existing.rows[0]?.id;
      return existingId ? { kind: "duplicate", itemId: existingId } : { kind: "unavailable" };
    }
    await requestProcessingWithClient(client, item.id, { receipt: createTelegramReceipt(chatId) });
    await client.query("commit");
    return { kind: "added" };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function shortId(itemId: string): string {
  return itemId.slice(0, 8);
}

async function resolveShortId(value: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    "select id from items where left(id::text, 8) = $1 order by id limit 2",
    [value.toLowerCase()],
  );
  return result.rows.length === 1 ? result.rows[0].id : null;
}

async function handleProcessingCommand(
  command: RegExpMatchArray,
  message: TelegramMessage,
  dependencies: TelegramMessageDependencies,
): Promise<void> {
  const itemId = await resolveShortId(command[2]);
  if (!itemId) {
    await dependencies.send(message.chatId, "未找到该条目。");
    return;
  }
  try {
    await (dependencies.refetch ?? manualRefetch)(itemId);
    await dependencies.send(message.chatId, "已开始重新抓取。");
  } catch (error) {
    const text = error instanceof ProcessingRequestError && error.code === "ITEM_ALREADY_PROCESSING"
      ? "该条目正在处理中。"
      : "暂时无法重新抓取。";
    await dependencies.send(message.chatId, text);
  }
}

function formatAnswer(answer: string, hits: readonly SearchHit[]): string {
  const sources = hits
    .slice(0, 10)
    .map((hit, index) => `${index + 1}. ${hit.title?.trim() || hit.url} ${hit.url}`)
    .join("\n");
  return `${answer}\n\n来源（最多 10 条）：\n${sources}`;
}

async function handleQuestion(
  question: string,
  message: TelegramMessage,
  dependencies: TelegramMessageDependencies,
): Promise<void> {
  try {
    await (dependencies.readiness ?? getPublicAskReadiness)();
  } catch {
    logger.info("tg_ask", { hit: false, ok: false });
    await dependencies.send(message.chatId, "问答服务暂未就绪。");
    return;
  }
  await dependencies.send(message.chatId, "正在检索收藏库…");
  try {
    const hits = await (dependencies.retrieve ?? retrieve)(question);
    if (hits.length === 0) {
      logger.info("tg_ask", { hit: false, ok: true });
      await dependencies.send(message.chatId, "收藏库中没有相关内容。");
      return;
    }
    const result = await (dependencies.answer ?? answerFromHits)(question, hits);
    logger.info("tg_ask", { hit: true, ok: true });
    await dependencies.send(message.chatId, formatAnswer(result.answer, hits));
  } catch {
    logger.info("tg_ask", { hit: false, ok: false });
    await dependencies.send(message.chatId, "检索暂时失败，请稍后重试。");
  }
}

export async function handleTelegramMessage(
  message: TelegramMessage,
  dependencies: TelegramMessageDependencies,
): Promise<void> {
  if (!(await allowed(message.senderId))) return;
  const text = message.text.trim();
  const command = text.match(/^\/(refetch|retry)\s+([0-9a-f]{8})$/i);
  if (command) {
    await handleProcessingCommand(command, message, dependencies);
    return;
  }
  if (/^\/(?:refetch|retry)\b/i.test(text)) {
    await dependencies.send(message.chatId, "未找到该条目。");
    return;
  }
  const allUrls = urlsIn(message.text);
  if (allUrls.length > 0) {
    const selected = allUrls.slice(0, 10);
    for (const url of selected) {
      const outcome = await addFromTelegram(url, message.chatId, dependencies.assertPublicUrl ?? defaultAssertPublicUrl);
      if (outcome.kind === "added" || outcome.kind === "duplicate") {
        logger.info("item_added", { source: "telegram", deduped: outcome.kind === "duplicate" });
      }
      const response = outcome.kind === "duplicate"
        ? `该链接已收藏。回复 /refetch ${shortId(outcome.itemId)} 可重新抓取更新。`
        : {
            added: "已加入，正在抓取总结中。",
            invalid: "没有识别到有效链接。请发送公开网页、文档或 GitHub 仓库链接。",
            unavailable: "模型配置暂不可用。",
          }[outcome.kind];
      await dependencies.send(message.chatId, response);
    }
    if (allUrls.length > 10) await dependencies.send(message.chatId, "每条消息最多处理 10 个链接。");
    return;
  }
  if (text) await handleQuestion(text, message, dependencies);
}

export async function startTelegramBot(): Promise<void> {
  const token = await getDecryptedSecret("telegramToken");
  if (!token) throw new Error("TELEGRAM_NOT_CONFIGURED");
  const bot = new Bot(token);
  bot.on("message:text", async (context) => {
    if (!context.from) return;
    await handleTelegramMessage(
      { senderId: context.from.id, chatId: String(context.chat.id), text: context.message.text },
      { send: async (chatId, text) => { await bot.api.sendMessage(chatId, text); } },
    );
  });
  await bot.start();
}
