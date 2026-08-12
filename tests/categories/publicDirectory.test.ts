// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "@/db/client";
import { getPublicDirectory } from "@/lib/categories/publicDirectory";
import { hasCompletedAskCorpus } from "@/lib/items/publicCorpus";

const PREFIX = "directory-task10-";

async function insertItem(
  id: string,
  type: "web" | "github" | "doc",
  title: string,
  status = "completed",
  categoryId: string | null = null,
) {
  await pool.query(
    `insert into items (id,url,url_canonical,type,title,summary,tags,status,source,category_id)
     values ($1,$2,$2,$3,$4,'摘要',array['一','二','三'],$5,'admin',$6)`,
    [id, `https://${PREFIX}${id}.example/path`, type, title, status, categoryId],
  );
}

describe("public directory and ask corpus", () => {
  beforeAll(async () => {
    const database = await pool.query<{ current_database: string }>("select current_database()");
    if (database.rows[0]?.current_database !== "collection_system_test") {
      throw new Error("requires collection_system_test");
    }
  });

  beforeEach(async () => {
    await pool.query(`delete from items where url like 'https://${PREFIX}%'; delete from categories where slug like '${PREFIX}%'`);
  });

  afterAll(async () => {
    await pool.query(`delete from items where url like 'https://${PREFIX}%'; delete from categories where slug like '${PREFIX}%'`);
    await pool.end();
  });

  it("keeps empty categories, filters ineligible items, and fixes unclassified last", async () => {
    const categories = await pool.query<{ id: string; name: string }>(
      `insert into categories (name,slug,sort) values
       ('Zulu Empty','${PREFIX}zulu',0),('Alpha Filled','${PREFIX}alpha',0),('First','${PREFIX}first',0)
       returning id,name`,
    );
    const byName = new Map(categories.rows.map((row) => [row.name, row.id]));
    await insertItem("a1000000-0000-4000-8000-000000000001", "web", "Zulu", "completed", byName.get("Alpha Filled"));
    await insertItem("a1000000-0000-4000-8000-000000000002", "github", "Alpha", "completed", byName.get("Alpha Filled"));
    await insertItem("a1000000-0000-4000-8000-000000000003", "web", "Middle");
    await insertItem("a1000000-0000-4000-8000-000000000004", "doc", "Excluded doc");
    await insertItem("a1000000-0000-4000-8000-000000000005", "web", "Excluded pending", "processing");

    const groups = await getPublicDirectory();
    const ours = groups.filter((group) => group.name?.includes("Empty") || group.name?.includes("Filled") || group.name === "First");
    expect(ours.map((group) => group.name)).toEqual(["Alpha Filled", "First", "Zulu Empty"]);
    expect(ours.find((group) => group.name === "Zulu Empty")?.sites).toEqual([]);
    expect(ours.find((group) => group.name === "Alpha Filled")?.sites.map((site) => site.title)).toEqual(["Alpha", "Zulu"]);
    expect(groups.at(-1)).toMatchObject({ id: null, name: null });
    expect(groups.at(-1)?.sites.map((site) => site.id)).toEqual(["a1000000-0000-4000-8000-000000000003"]);
    expect(groups.at(-1)?.sites[0]?.faviconPath).toBe("/favicon/a1000000-0000-4000-8000-000000000003");
  });

  it("uses exactly two bounded directory queries", async () => {
    const calls: string[] = [];
    await getPublicDirectory({
      query: async <T extends object>(text: string) => {
        calls.push(text);
        return { rows: [] as T[] };
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("order by sort, name, id");
    expect(calls[1]).toContain("status = 'completed'");
    expect(calls[1]).toContain("order by items.title, items.url, items.id");
  });

  it("keeps ask corpus available for doc-only completed content while directory is empty", async () => {
    await insertItem("a2000000-0000-4000-8000-000000000001", "doc", "Only document");
    expect(await hasCompletedAskCorpus()).toBe(true);
    const groups = await getPublicDirectory();
    expect(groups.every((group) => group.sites.length === 0)).toBe(true);
    expect(groups.at(-1)).toMatchObject({ id: null, name: null, sites: [] });
  });
});
