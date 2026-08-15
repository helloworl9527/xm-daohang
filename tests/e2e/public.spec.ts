import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

import { assertTestDatabaseUrl, TEST_DATABASE_URL } from "./testDatabase";

const pool = new Pool({ connectionString: assertTestDatabaseUrl(TEST_DATABASE_URL) });
const CAT = "b1000000-0000-4000-8000-000000000001";
const ITEM = "b2000000-0000-4000-8000-000000000001";

async function seed(type: "web" | "doc" = "web") {
  await pool.query("delete from daily_selections; delete from items; delete from categories; delete from app_settings");
  await pool.query(`insert into app_settings (id,llm_base_url,llm_model,llm_key_enc,emb_base_url,emb_model,emb_key_enc,emb_dim,emb_version,emb_rebuild_status,search_min_cosine) values (1,'https://models.example/v1','chat','configured','https://models.example/v1','emb','configured',3,1,'ready',0.5)`);
  await pool.query(`insert into categories (id,name,slug,sort) values ($1,'工具','e2e-tools',0),('b1000000-0000-4000-8000-000000000002','空分类','e2e-empty',1)`, [CAT]);
  await pool.query(`insert into items (id,url,url_canonical,type,source,status,title,summary,tags,category_id) values ($1,'https://example.com/site','https://example.com/site',$2,'admin','completed','字面检索工具','用于验证公开目录与搜索结果。',array['目录','搜索','工具'],$3)`, [ITEM, type, type === "web" ? CAT : null]);
}

function errors(page: Page) { const list: string[] = []; page.on("console", (m) => { if (m.type() === "error") list.push(m.text()); }); page.on("pageerror", (e) => list.push(e.message)); return list; }

test.beforeEach(async () => seed());
test.afterAll(async () => pool.end());

test("renders the C directory, anchors, favicon fallback, and safe cards", async ({ page }, info) => {
  const consoleErrors = errors(page); await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "找到值得再次打开的内容" })).toBeVisible();
  await expect(page.locator(".public-intro,.public-daily-grid,.public-item-rank")).toHaveCount(0);
  const search = await page.getByRole("form", { name: "关键词找站点" }).boundingBox();
  expect(search).not.toBeNull();
  if (!info.project.name.includes("mobile")) await expect(page.locator(".directory-view")).toHaveCSS("display", "grid");
  if (info.project.name.includes("mobile")) { expect(search!.width).toBeGreaterThan(340); const button = await page.getByRole("button", { name: "搜索", exact: true }).boundingBox(); expect(button!.height).toBeGreaterThanOrEqual(44); }
  await expect(page.getByRole("heading", { name: "空分类" })).toBeVisible(); await expect(page.getByRole("heading", { name: "未分类" })).toBeVisible();
  const headings = page.locator(".directory-group h2"); await expect(headings.last()).toHaveText("未分类");
  const card = page.getByRole("link", { name: /字面检索工具/ }); await expect(card).toHaveAttribute("target", "_blank"); await expect(card).toHaveAttribute("rel", "noopener nofollow");
  await card.locator("img").evaluate((image: HTMLImageElement) => image.dispatchEvent(new Event("error"))); await expect(card.locator(".directory-favicon svg")).toBeVisible();
  const anchor = page.getByRole("navigation", { name: "分类索引" }).getByRole("link", { name: /工具/ }); await anchor.click(); await expect(anchor).toHaveAttribute("aria-current", "location"); await expect(page.getByRole("heading", { name: "工具" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: `.workflow/screenshots/ink-signal/phase2-public-${info.project.name}.png`, fullPage: true });
});

test("honors reduced motion, reduced transparency, and increased contrast", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" }); await page.goto("/");
  await page.getByRole("tab", { name: "AI 问答" }).click();
  const styles = await page.evaluate(() => { const card = document.querySelector(".directory-card")!; const dock = document.querySelector(".public-ask-dock")!; return { transition: getComputedStyle(card).transitionDuration, border: getComputedStyle(card).borderTopColor, dockPosition: getComputedStyle(dock).position, dockTransform: getComputedStyle(dock).transform }; });
  expect(styles.transition).toMatch(/0s|0\.001s/); expect(styles.border).toBe("rgb(23, 24, 26)"); expect(styles.dockPosition).toBe("static"); expect(styles.dockTransform).toBe("none");
});

test("keeps URL query as truth across loading, results, empty, failure, and clearing", async ({ page }, info) => {
  const pending: Array<() => void> = []; let mode: "results" | "empty" | "error" = "results";
  await page.route("**/search", async (route) => { const q = (route.request().postDataJSON() as { query: string }).query; if (q === "slow") await new Promise<void>((resolve) => pending.push(resolve)); if (mode === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "SEARCH_UNAVAILABLE" } }) }); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ query: q, matches: mode === "empty" ? [] : [{ id: ITEM, title: `${q} result`, summary: "字面结果", url: "https://example.com/site", tags: ["一","二","三"], categoryName: "工具", faviconPath: `/favicon/${ITEM}` }] }) }); });
  await page.goto("/?q=slow"); await expect(page.locator(".keyword-search[data-interactive='true']")).toBeVisible(); const input = page.getByRole("textbox", { name: "输入字面关键词" }); await expect(input).toHaveValue("slow"); await expect(page.getByLabel("正在搜索站点")).toHaveAttribute("aria-busy", "true");
  await page.goto("/?q=fast"); await expect(page.getByRole("heading", { name: "关键词结果" })).toBeVisible(); pending.forEach((resolve) => resolve()); await expect(page.getByText("fast result")).toBeVisible(); await expect(page.getByText("slow result")).toHaveCount(0);
  await page.screenshot({ path: `.workflow/screenshots/ink-signal/phase2-keyword-results-${info.project.name}.png`, fullPage: true });
  mode = "empty"; await page.goto("/?q=none"); await expect(page.getByRole("heading", { name: "没有匹配的站点" })).toBeVisible(); await expect(page.getByText(/未调用 AI/)).toBeVisible();
  mode = "error"; await page.goto("/?q=fail"); await expect(page.locator(".keyword-search[data-interactive='true']")).toBeVisible(); await expect(page.locator(".directory-state[role='alert']")).toContainText("关键词搜索暂时失败"); await expect(page.getByRole("heading", { name: "没有匹配的站点" })).toHaveCount(0);
  const clear = page.getByRole("button", { name: "清空关键词" });
  await Promise.all([
    page.waitForURL((url) => !url.searchParams.has("q"), { timeout: 15_000 }),
    clear.click(),
  ]);
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByRole("navigation", { name: "分类索引" })).toBeVisible();
});

test("keeps ask enabled for doc-only corpus while the public directory has no sites", async ({ page }) => {
  await seed("doc"); await page.goto("/"); await expect(page.locator(".directory-card")).toHaveCount(0); await page.getByRole("tab", { name: "AI 问答" }).click(); await expect(page.getByRole("textbox", { name: "向收藏库提问" })).toBeEnabled();
});

test("keeps keyword and ask visible across a local directory failure and recovers", async ({ page }) => {
  await pool.query("alter table categories rename to categories_e2e_hidden");
  try { await page.goto("/"); await expect(page.locator(".directory-state[role='alert']")).toContainText("目录暂时无法读取"); await expect(page.getByRole("form", { name: "关键词找站点" })).toBeVisible(); await page.getByRole("tab", { name: "AI 问答" }).click(); await expect(page.getByRole("textbox", { name: "向收藏库提问" })).toBeVisible(); await page.getByRole("tab", { name: "关键词" }).click(); }
  finally { await pool.query("alter table categories_e2e_hidden rename to categories"); }
  await expect.poll(async () => Number((await pool.query("select count(*) count from categories")).rows[0]?.count)).toBe(2);
  const retry = page.getByRole("button", { name: "重试" });
  await expect(async () => {
    if (await retry.isVisible()) await retry.click();
    await expect(page.getByRole("navigation", { name: "分类索引" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ intervals: [0, 250, 500, 1_000], timeout: 15_000 });
});

test("retains the existing ask submission workflow", async ({ page }) => {
  await page.route("**/ask", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ answer: "来自收藏库的回答。", sources: [{ id: ITEM, title: "字面检索工具", summary: "摘要", url: "https://example.com/site", tags: [], score: .9, cited: true }] }) }));
  await page.goto("/"); await page.getByRole("tab", { name: "AI 问答" }).click(); await page.getByRole("textbox", { name: "向收藏库提问" }).fill("如何使用？"); await page.getByRole("button", { name: "提问" }).click(); await expect(page.getByText("来自收藏库的回答。")).toBeVisible(); await expect(page).not.toHaveURL(/q=/);
});
