// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { items, telegramReceipts } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto/secretbox";
import { dispatchTelegramReceipt, TelegramTransportError } from "@/worker/bot/receiptDispatcher";

let itemId: string;
beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString("base64");
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("dedicated DB required");
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(telegramReceipts); await db.delete(items);
  const [item] = await db.insert(items).values({
    url: "https://example.com/item", urlCanonical: "https://example.com/item", type: "web",
    title: "Title", summary: "这是一句中文总结。", tags: ["one", "two", "three"],
    status: "completed", source: "telegram", processGeneration: 1,
  }).returning({ id: items.id });
  itemId = item.id;
});
afterAll(async () => pool.end());

async function seed(outcome: "completed" | "failed" = "completed") {
  const [receipt] = await db.insert(telegramReceipts).values({
    itemId, processGeneration: 1, chatIdHash: "hash", chatIdEnc: encryptSecret("4200"),
    outcome, status: "ready", nextAttemptAt: new Date("2026-08-08T00:00:00Z"),
  }).returning();
  return receipt;
}

describe("Telegram receipt dispatcher", () => {
  it("allows only one concurrent dispatcher to claim and send a receipt", async () => {
    await seed();
    const send = vi.fn<(chatId: string, text: string, key: string) => Promise<void>>(async () => undefined);
    const results = await Promise.all([
      dispatchTelegramReceipt("worker-a", { send }),
      dispatchTelegramReceipt("worker-b", { send }),
    ]);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[1]).toBe(
      "✅ 已收藏\nTitle\n这是一句中文总结。\nhttps://example.com/item",
    );
    expect(results.filter((result) => result.sent)).toHaveLength(1);
    expect((await db.select().from(telegramReceipts))[0].status).toBe("sent");
  });

  it("recovers expired leases and marks a possible duplicate after a post-send crash", async () => {
    const receipt = await seed();
    const send = vi.fn(async () => undefined);
    await expect(dispatchTelegramReceipt("worker-a", {
      send,
      afterSend: async () => { throw new Error("crash"); },
      now: () => new Date("2026-08-09T00:00:00Z"),
    })).rejects.toThrow("crash");
    await pool.query("update telegram_receipts set lease_until = $1 where id = $2", [new Date("2026-08-08"), receipt.id]);
    const recovered = await dispatchTelegramReceipt("worker-b", { send, now: () => new Date("2026-08-09T00:01:00Z") });
    expect(send).toHaveBeenCalledTimes(2);
    expect(recovered).toMatchObject({ sent: true, duplicatePossible: true });
  });

  it("backs off on 429 and retries without losing the receipt", async () => {
    await seed("failed");
    const send = vi.fn().mockRejectedValueOnce(new TelegramTransportError(429, 60)).mockResolvedValueOnce(undefined);
    const now = new Date("2026-08-09T00:00:00Z");
    const first = await dispatchTelegramReceipt("worker-a", { send, now: () => now });
    expect(first.sent).toBe(false);
    const row = (await db.select().from(telegramReceipts))[0];
    expect(row.status).toBe("ready");
    expect(row.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    await expect(dispatchTelegramReceipt("worker-a", { send, now: () => new Date(now.getTime() + 30_000) })).resolves.toMatchObject({ sent: false });
    await expect(dispatchTelegramReceipt("worker-a", { send, now: () => new Date(now.getTime() + 60_000) })).resolves.toMatchObject({ sent: true });
  });

  it("does not claim a ready receipt without a terminal outcome", async () => {
    await db.insert(telegramReceipts).values({
      itemId,
      processGeneration: 1,
      chatIdHash: "invalid-ready",
      chatIdEnc: encryptSecret("4200"),
      outcome: null,
      status: "ready",
      nextAttemptAt: new Date("2026-08-08T00:00:00Z"),
    });
    const send = vi.fn();
    await expect(dispatchTelegramReceipt("worker-a", {
      send,
      now: () => new Date("2026-08-09T00:00:00Z"),
    })).resolves.toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });
});
