import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

import { encryptSecret } from "../../src/lib/crypto/secretbox";

const databaseUrl = "postgresql://apple@127.0.0.1:5432/collection_system_test";

test.beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
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
      `insert into app_settings
        (id, llm_base_url, llm_model, llm_key_enc, emb_base_url, emb_model, emb_key_enc,
         emb_dim, emb_version, emb_rebuild_status)
       values (1, 'https://models.example/v1', 'chat', $1,
               'https://models.example/v1', 'embedding', $2, 3, 1, 'ready')`,
      [encryptSecret("sk-llm-e2e"), encryptSecret("sk-emb-e2e")],
    );
  } finally {
    await pool.end();
  }
});

test("admin adds and recognizes a duplicate public URL", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("correct-password-123");
  await page.getByRole("button", { name: "登录管理端" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "添加内容" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "管理端主导航" })).toBeVisible();

  const input = page.getByLabel("公开链接");
  await input.fill("https://93.184.216.34/e2e-article?b=2&a=1#section");
  await page.getByRole("button", { name: "添加到收藏库" }).click();
  await expect(page.getByText("已加入，正在抓取总结中。")).toBeVisible();

  await page.getByRole("button", { name: "添加到收藏库" }).click();
  await expect(page.getByText("该链接已收藏。")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看条目" })).toBeVisible();

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const counts = await pool.query<{ items: string; requests: string }>(
      "select (select count(*) from items)::text items, (select count(*) from processing_requests)::text requests",
    );
    expect(counts.rows[0]).toEqual({ items: "1", requests: "1" });
  } finally {
    await pool.end();
  }

  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.screenshot({
    path: `.workflow/screenshots/t14-admin-add-${suffix}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
