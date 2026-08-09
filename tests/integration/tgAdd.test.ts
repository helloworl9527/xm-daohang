// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings, items, processingRequests, telegramReceipts } from "@/db/schema";
import { createTelegramReceipt, handleTelegramMessage } from "@/worker/bot/telegram";

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString("base64");
  process.env.TG_ID_HASH_KEY = "telegram-id-hash-key-with-at-least-32-bytes";
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("dedicated DB required");
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(telegramReceipts);
  await db.delete(processingRequests);
  await db.delete(items);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    llmBaseUrl: "https://models.example/v1", llmModel: "chat", llmKeyEnc: "configured",
    embBaseUrl: "https://models.example/v1", embModel: "emb", embKeyEnc: "configured", embDim: 3,
    tgAllowedIds: [42],
  });
});

afterAll(async () => pool.end());

describe("Telegram URL ingestion", () => {
  it("does not respond or inspect content for a non-allowlisted sender", async () => {
    const assertPublicUrl = vi.fn();
    const send = vi.fn();
    await handleTelegramMessage({ senderId: 7, chatId: "700", text: "https://example.com/private" }, { assertPublicUrl, send });
    expect(assertPublicUrl).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await db.select().from(items)).toEqual([]);
  });

  it("deduplicates URLs, processes at most ten, and sends an immediate reply for each", async () => {
    const urls = Array.from({ length: 11 }, (_, index) => `https://example.com/${index}`);
    const send = vi.fn();
    const assertPublicUrl = vi.fn(async (url: string) => url);
    await handleTelegramMessage(
      { senderId: 42, chatId: "4200", text: `${urls.join(" ")} ${urls[0]}` },
      { assertPublicUrl, send },
    );
    expect(assertPublicUrl).toHaveBeenCalledTimes(10);
    expect(await db.select().from(items)).toHaveLength(10);
    expect(await db.select().from(processingRequests)).toHaveLength(10);
    expect(await db.select().from(telegramReceipts)).toHaveLength(10);
    expect(send.mock.calls.filter((call) => call[1] === "已加入，正在抓取总结中")).toHaveLength(10);
    expect(send).toHaveBeenCalledWith("4200", "每条消息最多处理 10 个链接");
  });

  it("reports invalid and existing links without creating duplicate work", async () => {
    const send = vi.fn();
    const assertPublicUrl = vi.fn(async (url: string) => {
      if (url.includes("bad")) throw new Error("invalid");
      return url;
    });
    await handleTelegramMessage({ senderId: 42, chatId: "4200", text: "https://example.com/good" }, { assertPublicUrl, send });
    await handleTelegramMessage({ senderId: 42, chatId: "4200", text: "https://example.com/good https://bad.example" }, { assertPublicUrl, send });
    expect(await db.select().from(items)).toHaveLength(1);
    expect(await db.select().from(processingRequests)).toHaveLength(1);
    expect(send).toHaveBeenCalledWith("4200", "该链接已收藏");
    expect(send).toHaveBeenCalledWith("4200", "链接无效或不可公开访问");
  });

  it("uses stable chat HMAC with randomized ciphertext", () => {
    const left = createTelegramReceipt("4200");
    const right = createTelegramReceipt("4200");
    expect(left.chatIdHash).toBe(right.chatIdHash);
    expect(left.chatIdEnc).not.toBe(right.chatIdEnc);
    expect(left.chatIdEnc).not.toContain("4200");
  });
});
