import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

const databaseUrl = "postgresql://apple@127.0.0.1:5432/collection_system_test";
const CATEGORY_A = "40000000-0000-4000-8000-000000000001";
const CATEGORY_B = "40000000-0000-4000-8000-000000000002";
const ITEM_ID = "40000000-0000-4000-8000-000000000010";

test.beforeEach(async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`
      delete from category_run_retry_requests;
      delete from category_reclassify_failures;
      delete from category_change_runs;
      delete from telegram_receipts;
      delete from processing_requests;
      delete from daily_selections;
      delete from items;
      delete from categories;
      delete from sessions;
      delete from login_attempts;
      delete from admin_user;
      delete from app_settings
    `);
    const passwordHash = await argon2.hash("correct-password-123", {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await pool.query("insert into admin_user (id, username, password_hash) values (1, 'admin', $1)", [passwordHash]);
    await pool.query("insert into app_settings (id, categories_initialized, category_version) values (1, true, 2)");
    await pool.query(
      `insert into categories (id, name, slug, sort) values
        ($1, '开发工具', 'dev', 0),
        ($2, '人工智能', 'ai', 1)`,
      [CATEGORY_A, CATEGORY_B],
    );
    await pool.query(
      `insert into items
        (id, url, url_canonical, type, title, summary, tags, status, source, category_id)
       values ($1, 'https://example.com/categories', 'https://example.com/categories', 'web',
               '分类工作台条目', '用于验证人工分类。', array['分类','工作台','测试'],
               'completed', 'admin', $2)`,
      [ITEM_ID, CATEGORY_A],
    );
  } finally {
    await pool.end();
  }
});

test("admin reviews category diffs, handles manual conflict, manages categories, and saves manual NULL", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const applyBodies: Array<{ requestKey: string }> = [];
  await page.route("**/admin/api/categories/propose", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        mode: "full",
        baseVersion: 2,
        snapshotAt: "2026-08-11T00:00:00.000Z",
        diffs: [
          { kind: "add", proposalId: "new-data", name: "数据工具", autoCount: 0, manualCount: 0 },
          { kind: "rename", proposalId: "rename-ai", sourceCategoryId: CATEGORY_B, name: "AI 工具", autoCount: 0, manualCount: 0 },
          { kind: "merge", proposalId: "merge-dev", sourceCategoryId: CATEGORY_A, target: { kind: "existing", categoryId: CATEGORY_B }, autoCount: 1, manualCount: 0 },
          { kind: "delete", proposalId: "delete-ai", sourceCategoryId: CATEGORY_B, autoCount: 0, manualCount: 1 },
        ],
      }),
    });
  });
  await page.route("**/admin/api/categories/apply", async (route) => {
    applyBodies.push(route.request().postDataJSON() as { requestKey: string });
    if (applyBodies.length === 1) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "MANUAL_CATEGORY_CONFLICT", message: "redacted" } }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runId: "40000000-0000-4000-8000-000000000020",
        status: "completed",
        counts: { added: 1, renamed: 1, merged: 1, deleted: 0, ignored: 1 },
      }),
    });
  });

  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("correct-password-123");
  await page.getByRole("button", { name: "登录管理端" }).click();
  await page.getByRole("link", { name: "分类管理" }).click();
  await expect(page).toHaveURL(/\/admin\/categories$/);
  await expect(page.getByRole("note")).toContainText("人工分类始终保护");

  await page.getByRole("button", { name: /全量重拟/ }).click();
  await expect(page.locator(".category-diff-row")).toHaveCount(4);
  await page.getByRole("textbox", { name: "新分类", exact: true }).fill("数据工程");
  await page.getByRole("combobox", { name: "自动条目去向" }).first().selectOption(`existing:${CATEGORY_B}`);

  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.screenshot({
    path: `.workflow/screenshots/nav-enhancement/admin-c-diff-${suffix}.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "检查并应用 4 项" }).click();
  const confirm = page.getByRole("dialog", { name: "确认应用分类变更" });
  await expect(confirm).toContainText("应用 4 / 忽略 0 / 人工保护 1");
  await expect(confirm.getByRole("checkbox")).toBeChecked();
  await confirm.getByRole("button", { name: "确认应用" }).click();
  await expect(page.getByText("此处有人工分类条目，请先迁移或在预览忽略该项。", { exact: true })).toBeVisible();
  consoleErrors.length = 0;
  await confirm.getByRole("button", { name: "取消" }).click();

  const deleteDiff = page.locator(".category-diff-row--delete");
  await deleteDiff.getByRole("button", { name: "忽略" }).click();
  await page.getByRole("button", { name: "检查并应用 3 项" }).click();
  await page.getByRole("dialog", { name: "确认应用分类变更" }).getByRole("button", { name: "确认应用" }).click();
  await expect(page.getByRole("heading", { name: "应用完成" })).toBeVisible();
  expect(applyBodies).toHaveLength(2);
  expect(applyBodies[1]!.requestKey).toBe(applyBodies[0]!.requestKey);

  await page.getByRole("textbox", { name: "新分类名称" }).fill("研究资料");
  await page.getByRole("button", { name: "新增分类", exact: true }).click();
  await expect(page.getByText("分类已新增。", { exact: true })).toBeVisible();
  await expect(page.getByText("研究资料", { exact: true })).toBeVisible();

  const renameButton = page.getByRole("button", { name: "重命名 人工智能" });
  const deleteButton = page.getByRole("button", { name: "删除 人工智能" });
  const [renameBox, deleteBox] = await Promise.all([renameButton.boundingBox(), deleteButton.boundingBox()]);
  expect(renameBox).not.toBeNull();
  expect(deleteBox).not.toBeNull();
  expect(renameBox!.x + renameBox!.width).toBeLessThanOrEqual(deleteBox!.x);
  if (testInfo.project.name.includes("mobile")) {
    await deleteButton.focus();
    await page.keyboard.press("Enter");
  } else {
    await deleteButton.click();
  }
  const deleteDialog = page.getByRole("dialog", { name: "确认删除分类" });
  await expect(deleteDialog).toContainText("转为未分类");
  await deleteDialog.getByRole("button", { name: "删除并转未分类" }).click();
  await expect(page.getByText("分类已删除，关联内容已转为未分类。", { exact: true })).toBeVisible();

  await page.goto(`/admin/library/${ITEM_ID}`);
  const selector = page.getByRole("combobox", { name: "选择单一主分类" });
  await expect(selector).toHaveValue(CATEGORY_A);
  await selector.selectOption("");
  await page.getByRole("button", { name: "保存分类" }).click();
  await expect(page.getByText("人工分类已保存，后续 AI 不覆盖。", { exact: true })).toBeVisible();

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const saved = await pool.query<{ category_id: string | null; category_manual: boolean }>(
      "select category_id, category_manual from items where id = $1",
      [ITEM_ID],
    );
    expect(saved.rows[0]).toEqual({ category_id: null, category_manual: true });
  } finally {
    await pool.end();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
