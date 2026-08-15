import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

import { assertTestDatabaseUrl, TEST_DATABASE_URL } from "./testDatabase";

const databaseUrl = assertTestDatabaseUrl(TEST_DATABASE_URL);

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "delete from processing_requests; delete from daily_selections; delete from items; delete from sessions; delete from login_attempts; delete from admin_user; delete from app_settings",
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
        (url, url_canonical, type, title, summary, tags, status, source)
       values
        ('https://example.com/chinese-ai-content', 'https://example.com/chinese-ai-content',
         'web', '向量检索条目', '这是由 AI 生成的中文总结。',
         array['数据库', '向量', '检索'], 'completed', 'admin')`,
    );
  } finally {
    await pool.end();
  }
});

test("locale cookie persists from login into the protected admin UI", async ({ page }, testInfo) => {
  await page.goto("/admin/login");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();

  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("correct-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Add content" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();

  await page.getByRole("link", { name: "Library" }).click();
  await expect(page.getByText("这是由 AI 生成的中文总结。")).toBeVisible();

  await page.evaluate(() => localStorage.setItem("locale", "zh"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.evaluate(() => localStorage.getItem("locale"))).resolves.toBe("en");
  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.screenshot({
    path: `.workflow/screenshots/t19-i18n-en-${suffix}.png`,
    fullPage: true,
  });
});
