// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db/client";
import { searchPublicCorpus } from "@/lib/items/publicCorpus";

const insert = async (id: string, type: "web" | "github" | "doc", title: string, summary: string, tags: string[], status = "completed") => {
  await pool.query(
    `insert into items (id,url,url_canonical,type,title,summary,tags,status,source)
     values ($1,$2,$2,$3,$4,$5,$6,$7,'admin')`,
    [id, `https://keyword.example/${id}`, type, title, summary, tags, status],
  );
};

describe("literal public corpus search", () => {
  beforeAll(async () => {
    const database = await pool.query<{ current_database: string }>("select current_database()");
    if (database.rows[0]?.current_database !== "collection_system_test") throw new Error("requires collection_system_test");
  });
  beforeEach(async () => pool.query("delete from items where url like 'https://keyword.example/%'; delete from categories where slug='search-category'"));
  afterAll(async () => { await pool.query("delete from items where url like 'https://keyword.example/%'"); await pool.end(); });

  it("matches title, summary, and tags case-insensitively while excluding docs and unfinished items", async () => {
    await insert("91000000-0000-4000-8000-000000000001", "web", "Alpha 标题", "无", ["甲", "乙", "丙"]);
    await insert("91000000-0000-4000-8000-000000000002", "github", "无", "ALPHA summary", ["甲", "乙", "丙"]);
    await insert("91000000-0000-4000-8000-000000000003", "web", "无", "无", ["alpha-tag", "乙", "丙"]);
    await insert("91000000-0000-4000-8000-000000000004", "doc", "alpha doc", "无", ["甲", "乙", "丙"]);
    await insert("91000000-0000-4000-8000-000000000005", "web", "alpha pending", "无", ["甲", "乙", "丙"], "processing");
    expect((await searchPublicCorpus("alpha")).map((item) => item.id).sort()).toEqual([
      "91000000-0000-4000-8000-000000000001",
      "91000000-0000-4000-8000-000000000002",
      "91000000-0000-4000-8000-000000000003",
    ]);
  });

  it.each(["%", "_", "\\"])("treats %s as a literal substring", async (literal) => {
    await insert("92000000-0000-4000-8000-000000000001", "web", `literal${literal}value`, "无", ["甲", "乙", "丙"]);
    await insert("92000000-0000-4000-8000-000000000002", "web", "literalXvalue", "无", ["甲", "乙", "丙"]);
    expect((await searchPublicCorpus(literal)).map((item) => item.id)).toEqual(["92000000-0000-4000-8000-000000000001"]);
  });

  it("treats an SQL injection sample as ordinary data", async () => {
    await insert("93000000-0000-4000-8000-000000000001", "web", "ordinary title", "无", ["甲", "乙", "丙"]);
    expect(await searchPublicCorpus("' OR true --")).toEqual([]);
  });

  it("returns the complete SiteCard DTO and deterministic title order", async () => {
    const category = await pool.query<{ id: string }>("insert into categories (name,slug,sort) values ('搜索分类','search-category',0) returning id");
    await insert("94000000-0000-4000-8000-000000000001", "web", "Alpha match", "无", ["甲", "乙", "丙"]);
    await insert("94000000-0000-4000-8000-000000000002", "web", "zulu match", "无", ["甲", "乙", "丙"]);
    await pool.query("update items set category_id=$1 where id=$2", [category.rows[0]!.id, "94000000-0000-4000-8000-000000000001"]);
    const matches = await searchPublicCorpus("match");
    expect(matches.map((item) => item.id)).toEqual([
      "94000000-0000-4000-8000-000000000001",
      "94000000-0000-4000-8000-000000000002",
    ]);
    expect(matches[0]).toEqual({
      id: "94000000-0000-4000-8000-000000000001",
      title: "Alpha match",
      summary: "无",
      url: "https://keyword.example/94000000-0000-4000-8000-000000000001",
      tags: ["甲", "乙", "丙"],
      categoryName: "搜索分类",
      faviconPath: "/favicon/94000000-0000-4000-8000-000000000001",
    });
    await pool.query("delete from categories where id=$1", [category.rows[0]!.id]);
  });
});
