import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

const databaseUrl = "postgresql://apple@127.0.0.1:5432/collection_system_test";

test.beforeEach(async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "delete from telegram_receipts; delete from processing_requests; delete from daily_selections; delete from items; delete from sessions; delete from login_attempts; delete from admin_user; delete from app_settings",
    );
    const passwordHash = await argon2.hash("correct-password-123", {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await pool.query(
      "insert into admin_user (id, username, password_hash) values (1, 'admin', $1)",
      [passwordHash],
    );
    await pool.query(
      `insert into items
        (id, url, url_canonical, type, title, summary, tags, status, source, created_at, updated_at)
       values
        ('00000000-0000-4000-8000-000000000011', 'https://example.com/postgresql',
         'https://example.com/postgresql', 'web', 'PostgreSQL 设计', '数据库索引与事务指南。',
         array['数据库','PostgreSQL','后端'], 'completed', 'admin', '2026-01-01', '2026-01-03'),
        ('00000000-0000-4000-8000-000000000012', 'https://github.com/example/vector',
         'https://github.com/example/vector', 'github', '向量检索', '使用 pgvector 搜索收藏内容。',
         array['检索','pgvector','GitHub'], 'completed', 'telegram', '2026-01-02', '2026-01-04'),
        ('00000000-0000-4000-8000-000000000013', 'https://example.com/processing',
         'https://example.com/processing', 'web', '处理中条目', null,
         array[]::text[], 'processing', 'admin', '2026-01-03', '2026-01-05')`,
    );
  } finally {
    await pool.end();
  }
});

test("admin filters the library and recovers from a list error", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("correct-password-123");
  await page.getByRole("button", { name: "登录管理端" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  let listRequests = 0;
  let releaseFirstRequest!: () => void;
  let markFirstRequestStarted!: () => void;
  const firstRequestGate = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const firstRequestStarted = new Promise<void>((resolve) => {
    markFirstRequestStarted = resolve;
  });
  await page.route(/\/admin\/api\/items(?:\?.*)?$/, async (route) => {
    listRequests += 1;
    if (listRequests === 1) {
      markFirstRequestStarted();
      await firstRequestGate;
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await page.goto("/admin/library");
  await firstRequestStarted;
  await expect(page.locator(".library-skeleton-row")).toHaveCount(3);
  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.screenshot({
    path: `.workflow/screenshots/t15-admin-library-loading-${suffix}.png`,
    fullPage: true,
  });
  releaseFirstRequest();
  await expect(page.getByText("收藏库暂时无法读取。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: "PostgreSQL 设计" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "向量检索" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "处理中条目" })).toBeVisible();
  consoleErrors.length = 0;

  await page.getByLabel("关键词").fill("PostgreSQL");
  await page.getByRole("textbox", { name: "标签", exact: true }).fill("数据库, 后端");
  await page.getByLabel("状态").selectOption("completed");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page).toHaveURL(
    /\/admin\/library\?q=PostgreSQL&tag=%E6%95%B0%E6%8D%AE%E5%BA%93&tag=%E5%90%8E%E7%AB%AF&status=completed/,
  );
  await expect(page.getByRole("heading", { name: "PostgreSQL 设计" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "向量检索" })).toHaveCount(0);

  await page.screenshot({
    path: `.workflow/screenshots/t15-admin-library-${suffix}.png`,
    fullPage: true,
  });

  await page.getByLabel("关键词").fill("不存在的条目");
  await page.getByRole("button", { name: "筛选" }).click();
  await expect(page.getByText("没有符合当前筛选的条目")).toBeVisible();
  await expect(page.getByRole("button", { name: "清除筛选" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
