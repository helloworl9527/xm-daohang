// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings } from "@/db/schema";
import {
  getDecryptedSecret,
  getSettings,
  updateSettings,
} from "@/lib/config/settings";

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Settings integration tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(appSettings);
});

afterAll(async () => {
  await pool.end();
});

describe("settings service", () => {
  it("returns masked keys without plaintext or ciphertext", async () => {
    await updateSettings({
      llmBaseUrl: "https://models.example/v1",
      llmModel: "chat-model",
      llmKey: "sk-sensitive-abcd",
    });
    const settings = await getSettings();
    const [stored] = await db.select().from(appSettings);

    expect(settings).toMatchObject({
      llmBaseUrl: "https://models.example/v1",
      llmModel: "chat-model",
      llmKeyMasked: "sk-…abcd",
    });
    expect(settings).not.toHaveProperty("llmKeyEnc");
    expect(JSON.stringify(settings)).not.toContain("sk-sensitive-abcd");
    expect(stored.llmKeyEnc).not.toContain("sk-sensitive-abcd");
    await expect(getDecryptedSecret("llmKey")).resolves.toBe("sk-sensitive-abcd");
  });

  it("preserves an existing key when an update omits it", async () => {
    await updateSettings({ llmKey: "sk-original-wxyz", llmModel: "old-model" });
    const before = await getDecryptedSecret("llmKey");

    await updateSettings({ llmModel: "new-model" });

    await expect(getDecryptedSecret("llmKey")).resolves.toBe(before);
    await expect(getSettings()).resolves.toMatchObject({
      llmModel: "new-model",
      llmKeyMasked: "sk-…wxyz",
    });
  });

  it("keeps LLM, embedding, and Telegram secrets isolated", async () => {
    await updateSettings({
      llmKey: "sk-llm-aaaa",
      embKey: "sk-embedding-bbbb",
      telegramToken: "123456:telegram-cccc",
    });

    await expect(getDecryptedSecret("llmKey")).resolves.toBe("sk-llm-aaaa");
    await expect(getDecryptedSecret("embKey")).resolves.toBe("sk-embedding-bbbb");
    await expect(getDecryptedSecret("telegramToken")).resolves.toBe("123456:telegram-cccc");
  });
});
