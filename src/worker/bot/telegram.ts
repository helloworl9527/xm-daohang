import { createHmac } from "node:crypto";

import { Bot } from "grammy";

import { pool } from "@/db/client";
import { getDecryptedSecret } from "@/lib/config/settings";
import { encryptSecret } from "@/lib/crypto/secretbox";
import { parsePublicGitHubUrl } from "@/lib/fetch/github";
import { assertPublicUrl as defaultAssertPublicUrl } from "@/lib/fetch/urlGuard";
import { requestProcessingWithClient, type ProcessingReceipt } from "@/lib/items/processing";

export interface TelegramMessage {
  senderId: number;
  chatId: string;
  text: string;
}

export interface TelegramMessageDependencies {
  assertPublicUrl?: (url: string) => Promise<string>;
  send: (chatId: string, text: string) => Promise<void>;
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
): Promise<"added" | "duplicate" | "invalid" | "unavailable"> {
  let canonicalUrl: string;
  let type: "web" | "doc" | "github";
  try {
    canonicalUrl = await assertPublicUrl(rawUrl);
    type = itemType(canonicalUrl);
  } catch {
    return "invalid";
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
      return "unavailable";
    }
    const inserted = await client.query<{ id: string }>(
      `insert into items (url, url_canonical, type, source, status)
       values ($1, $1, $2, 'telegram', 'processing')
       on conflict (url_canonical) do nothing returning id`,
      [canonicalUrl, type],
    );
    const item = inserted.rows[0];
    if (!item) {
      await client.query("commit");
      return "duplicate";
    }
    await requestProcessingWithClient(client, item.id, { receipt: createTelegramReceipt(chatId) });
    await client.query("commit");
    return "added";
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function handleTelegramMessage(
  message: TelegramMessage,
  dependencies: TelegramMessageDependencies,
): Promise<void> {
  if (!(await allowed(message.senderId))) return;
  const allUrls = urlsIn(message.text);
  if (allUrls.length === 0) return;
  const selected = allUrls.slice(0, 10);
  for (const url of selected) {
    const outcome = await addFromTelegram(url, message.chatId, dependencies.assertPublicUrl ?? defaultAssertPublicUrl);
    const text = {
      added: "已加入，正在抓取总结中",
      duplicate: "该链接已收藏",
      invalid: "链接无效或不可公开访问",
      unavailable: "模型配置暂不可用",
    }[outcome];
    await dependencies.send(message.chatId, text);
  }
  if (allUrls.length > 10) await dependencies.send(message.chatId, "每条消息最多处理 10 个链接");
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
