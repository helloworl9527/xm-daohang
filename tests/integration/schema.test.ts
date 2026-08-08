// @vitest-environment node

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import {
  adminUser,
  appSettings,
  askCounters,
  dailySelections,
  items,
  loginAttempts,
  processingRequests,
  sessions,
  telegramReceipts,
  workerHeartbeats,
} from "@/db/schema";

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Integration migrations require the dedicated collection_system_test database");
  }

  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

afterAll(async () => {
  await pool.end();
});

describe("database schema", () => {
  it("exports every canonical table", () => {
    expect([
      items,
      appSettings,
      adminUser,
      sessions,
      loginAttempts,
      askCounters,
      dailySelections,
      processingRequests,
      telegramReceipts,
      workerHeartbeats,
    ]).toHaveLength(10);
  });

  it("migrates and inserts an item", async () => {
    const [inserted] = await db
      .insert(items)
      .values({
        url: "https://example.com/article",
        urlCanonical: "https://example.com/article",
        type: "web",
        source: "admin",
      })
      .returning();

    const [readBack] = await db.select().from(items);
    expect(readBack).toMatchObject({
      id: inserted.id,
      status: "processing",
      processGeneration: 0,
      shownCount: 0,
    });
  });

  it("enforces canonical URL uniqueness", async () => {
    const value = {
      url: "https://example.com/duplicate",
      urlCanonical: "https://example.com/duplicate",
      type: "web" as const,
      source: "admin" as const,
    };
    await db.insert(items).values(value);
    await expect(db.insert(items).values(value)).rejects.toMatchObject({
      cause: { code: "23505", constraint: "items_url_canonical_unique" },
    });
  });
});
