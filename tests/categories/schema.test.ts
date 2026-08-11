// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import {
  appSettings,
  categories,
  categoryChangeRuns,
  categoryReclassifyFailures,
  categoryRunRetryRequests,
  items,
} from "@/db/schema";

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Category schema tests require the dedicated collection_system_test database");
  }

  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

afterAll(async () => {
  await pool.end();
});

describe("category schema", () => {
  it("exports the taxonomy and durable run tables", () => {
    expect([
      categories,
      categoryChangeRuns,
      categoryReclassifyFailures,
      categoryRunRetryRequests,
    ]).toHaveLength(4);
  });

  it("uses uninitialized taxonomy defaults and nullable automatic item categories", async () => {
    const [settings] = await db.insert(appSettings).values({ id: 1 }).returning();
    const [item] = await db
      .insert(items)
      .values({
        url: "https://example.com/default-category",
        urlCanonical: "https://example.com/default-category",
        type: "web",
        source: "admin",
      })
      .returning();

    expect(settings).toMatchObject({ categoriesInitialized: false, categoryVersion: 0 });
    expect(item).toMatchObject({ categoryId: null, categoryManual: false });
  });

  it("rejects blank and normalized duplicate names while accepting a stable slug", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const [category] = await db
      .insert(categories)
      .values({ id, name: "开发工具", slug: `cat-${id.replaceAll("-", "")}` })
      .returning();

    expect(category.slug).toBe("cat-10000000000040008000000000000001");
    await expect(
      db.insert(categories).values({ name: "   ", slug: "cat-blank" }),
    ).rejects.toMatchObject({ cause: { code: "23514", constraint: "categories_name_not_blank_check" } });
    await expect(
      db.insert(categories).values({ name: "  开发工具  ", slug: "cat-duplicate" }),
    ).rejects.toMatchObject({ cause: { code: "23505", constraint: "categories_name_normalized_unique" } });
  });

  it.each([false, true])("sets category to null without changing manual=%s", async (manual) => {
    const [category] = await db
      .insert(categories)
      .values({ name: `待删除-${manual}`, slug: `cat-delete-${manual}` })
      .returning();
    const [item] = await db
      .insert(items)
      .values({
        url: `https://example.com/delete-${manual}`,
        urlCanonical: `https://example.com/delete-${manual}`,
        type: "web",
        source: "admin",
        categoryId: category.id,
        categoryManual: manual,
      })
      .returning();

    await db.delete(categories).where(eq(categories.id, category.id));

    const [afterDelete] = await db.select().from(items).where(eq(items.id, item.id));
    expect(afterDelete).toMatchObject({ categoryId: null, categoryManual: manual });
  });

  it("keeps existing item constraints active", async () => {
    await expect(
      db.insert(items).values({
        url: "https://example.com/invalid-type",
        urlCanonical: "https://example.com/invalid-type",
        type: "video",
        source: "admin",
      }),
    ).rejects.toMatchObject({ cause: { code: "23514", constraint: "items_type_check" } });
  });
});
