// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings, items, processingRequests } from "@/db/schema";
import { manualRefetch } from "@/lib/items/refetch";

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Refetch tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  await db.delete(processingRequests);
  await db.delete(items);
  await db.delete(appSettings);
  await db.insert(appSettings).values({ id: 1, embVersion: 4 });
});

afterAll(async () => {
  await pool.end();
});

async function insertItem(status: "completed" | "failed" | "processing") {
  const [item] = await db.insert(items).values({
    url: `https://example.com/${status}`,
    urlCanonical: `https://example.com/${status}`,
    type: "web",
    source: "admin",
    status,
    ...(status === "completed" ? {
      summary: "原总结第一句。原总结第二句。",
      tags: ["标签一", "标签二", "标签三"],
      embedding: [1, 0, 0],
      embeddingDim: 3,
      embeddingVersion: 3,
    } : {}),
  }).returning();
  return item;
}

describe("manualRefetch", () => {
  it.each(["completed", "failed"] as const)("queues a new generation for a %s item", async (status) => {
    const item = await insertItem(status);
    await expect(manualRefetch(item.id)).resolves.toEqual({ processGeneration: 1 });

    const [saved] = await db.select().from(items).where(eq(items.id, item.id));
    expect(saved).toMatchObject({ status: "processing", processGeneration: 1, failReason: null });
    const requests = await db.select().from(processingRequests);
    expect(requests).toEqual([expect.objectContaining({
      itemId: item.id,
      processGeneration: 1,
      embVersion: 4,
      attempt: 0,
      status: "pending",
    })]);
  });

  it("rejects an already processing item without adding another request", async () => {
    const item = await insertItem("failed");
    await manualRefetch(item.id);
    await expect(manualRefetch(item.id)).rejects.toMatchObject({ code: "ITEM_ALREADY_PROCESSING" });

    expect(await db.select().from(processingRequests)).toHaveLength(1);
    const [saved] = await db.select().from(items).where(eq(items.id, item.id));
    expect(saved.processGeneration).toBe(1);
  });
});
