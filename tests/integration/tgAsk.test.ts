// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings, askCounters, items, processingRequests, telegramReceipts } from "@/db/schema";
import type { SearchHit } from "@/lib/search/retrieve";
import { handleTelegramMessage } from "@/worker/bot/telegram";

const hit: SearchHit = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "PostgreSQL 检索",
  summary: "介绍 pgvector 的语义检索方法。",
  url: "https://example.com/search",
  tags: ["PostgreSQL", "pgvector", "检索"],
  score: 0.91,
};

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 22).toString("base64");
  process.env.TG_ID_HASH_KEY = "telegram-id-hash-key-with-at-least-32-bytes";
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("dedicated DB required");
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(telegramReceipts);
  await db.delete(processingRequests);
  await db.delete(askCounters);
  await db.delete(items);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    llmBaseUrl: "https://models.example/v1", llmModel: "chat", llmKeyEnc: "configured",
    embBaseUrl: "https://models.example/v1", embModel: "emb", embKeyEnc: "configured", embDim: 3,
    embVersion: 1, embRebuildStatus: "ready", searchMinCosine: 0.5,
    tgAllowedIds: [42],
  });
});

afterAll(async () => pool.end());

describe("Telegram private ask", () => {
  it("does not respond to or search for a non-allowlisted sender", async () => {
    const retrieve = vi.fn();
    const answer = vi.fn();
    const send = vi.fn();
    await handleTelegramMessage(
      { senderId: 7, chatId: "700", text: "如何做语义检索？" },
      { send, retrieve, answer },
    );
    expect(retrieve).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("answers from server-owned hits and never consumes public counters", async () => {
    const retrieve = vi.fn(async () => [hit]);
    const answer = vi.fn(async () => ({ answer: "可以使用 pgvector 做语义检索。", citationIds: [hit.id] }));
    const send = vi.fn<(chatId: string, text: string) => Promise<void>>(async () => undefined);
    await handleTelegramMessage(
      { senderId: 42, chatId: "4200", text: "如何做语义检索？" },
      { send, retrieve, answer },
    );
    expect(retrieve).toHaveBeenCalledWith("如何做语义检索？");
    expect(answer).toHaveBeenCalledWith("如何做语义检索？", [hit]);
    expect(send).toHaveBeenNthCalledWith(1, "4200", "正在检索收藏库…");
    expect(send.mock.calls[1]?.[1]).toBe(
      "可以使用 pgvector 做语义检索。\n\n来源（最多 10 条）：\n1. PostgreSQL 检索 https://example.com/search",
    );
    expect(await db.select().from(askCounters)).toEqual([]);
  });

  it("returns the fixed empty response without calling the answer model", async () => {
    const retrieve = vi.fn(async () => []);
    const answer = vi.fn();
    const send = vi.fn(async () => undefined);
    await handleTelegramMessage(
      { senderId: 42, chatId: "4200", text: "没有答案的问题" },
      { send, retrieve, answer },
    );
    expect(answer).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith("4200", "收藏库中没有相关内容。");
  });

  it("fails closed before retrieval while embeddings are rebuilding", async () => {
    await db.update(appSettings).set({ embRebuildStatus: "building" });
    const retrieve = vi.fn();
    const answer = vi.fn();
    const send = vi.fn(async () => undefined);
    await handleTelegramMessage(
      { senderId: 42, chatId: "4200", text: "会不会调模型？" },
      { send, retrieve, answer },
    );
    expect(retrieve).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("4200", "问答服务暂未就绪。");
  });
});
