// @vitest-environment node

import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";

async function createM1MigrationsFolder() {
  const folder = await mkdtemp(path.join(tmpdir(), "collection-m1-migrations-"));
  await cp("src/db/migrations", folder, { recursive: true });
  const journalPath = path.join(folder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number }>;
  };
  journal.entries = journal.entries.filter((entry) => entry.idx <= 2);
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Migration upgrade tests require the dedicated collection_system_test database");
  }
});

afterAll(async () => {
  await pool.end();
});

describe("M1 to M2 taxonomy migration", () => {
  it("preserves old rows, vectors, and constraints and is migrator-idempotent", async () => {
    await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
    const m1Folder = await createM1MigrationsFolder();
    await migrate(db, { migrationsFolder: m1Folder });
    await db.execute(sql`
      insert into items
        (url, url_canonical, type, title, summary, tags, status, source, embedding, embedding_dim, embedding_version)
      values
        ('https://example.com/vector', 'https://example.com/vector', 'web', 'Vector', 'summary',
         array['a','b','c'], 'completed', 'admin', '[1,0,0]'::vector, 3, 0),
        ('https://example.com/doc', 'https://example.com/doc', 'doc', 'Doc', null,
         array[]::text[], 'failed', 'admin', null, null, null)
    `);

    await migrate(db, { migrationsFolder: "src/db/migrations" });
    const rows = await pool.query<{
      url_canonical: string;
      type: string;
      status: string;
      embedding: string | null;
      category_id: string | null;
      category_manual: boolean;
    }>("select url_canonical, type, status, embedding::text, category_id, category_manual from items order by url_canonical");
    expect(rows.rows).toEqual([
      {
        url_canonical: "https://example.com/doc",
        type: "doc",
        status: "failed",
        embedding: null,
        category_id: null,
        category_manual: false,
      },
      {
        url_canonical: "https://example.com/vector",
        type: "web",
        status: "completed",
        embedding: "[1,0,0]",
        category_id: null,
        category_manual: false,
      },
    ]);

    await expect(
      pool.query(
        `insert into items (url, url_canonical, type, tags, status, source)
         values ('https://example.com/invalid-type', 'https://example.com/invalid-type',
                 'video', array['a','b','c'], 'completed', 'admin')`,
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "items_type_check" });
    await expect(
      pool.query(
        `insert into items (url, url_canonical, type, tags, status, source)
         values ('https://example.com/invalid-status', 'https://example.com/invalid-status',
                 'web', array['a','b','c'], 'archived', 'admin')`,
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "items_status_check" });
    await expect(
      pool.query("update items set tags = array['a','b'] where url_canonical = $1", [
        "https://example.com/vector",
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "items_completed_tags_check" });
    await expect(
      pool.query("update items set embedding_dim = null where url_canonical = $1", [
        "https://example.com/vector",
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "items_embedding_metadata_check" });
    await expect(
      pool.query("update items set embedding_dim = 2 where url_canonical = $1", [
        "https://example.com/vector",
      ]),
    ).rejects.toMatchObject({ code: "23514", constraint: "items_embedding_dimension_check" });

    const before = await pool.query<{ count: string }>("select count(*) from drizzle.__drizzle_migrations");
    await migrate(db, { migrationsFolder: "src/db/migrations" });
    const after = await pool.query<{ count: string }>("select count(*) from drizzle.__drizzle_migrations");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
