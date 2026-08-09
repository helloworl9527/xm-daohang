import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

import { encryptSecret } from "../../src/lib/crypto/secretbox";

const databaseUrl = "postgresql://apple@127.0.0.1:5432/collection_system_test";
const itemId = "00000000-0000-4000-8000-000000000031";

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
               'https://models.example/v1', 'embedding', $2, 3, 7, 'ready')`,
      [encryptSecret("sk-llm-e2e"), encryptSecret("sk-emb-e2e")],
    );
    await pool.query(
      `insert into items
        (id, url, url_canonical, type, title, summary, tags, status, source,
         embedding, embedding_dim, embedding_version)
       values ($1, 'https://example.com/detail', 'https://example.com/detail', 'web',
               '条目详情', '原总结第一句。原总结第二句。', array['标签一','标签二','标签三'],
               'completed', 'admin', '[1,0,0]', 3, 7)`,
      [itemId],
    );
    await pool.query(
      "insert into daily_selections (day, rank, item_id) values ('2026-08-09', 1, $1)",
      [itemId],
    );
  } finally {
    await pool.end();
  }
});

test("admin edits, refetches, and deletes an item", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("correct-password-123");
  await page.getByRole("button", { name: "登录管理端" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/library");
  await page.getByRole("link", { name: "查看 条目详情" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/library/${itemId}$`));

  const editor = page.getByRole("textbox", { name: "总结", exact: true });
  await editor.fill("人工修订的总结。");
  await page.getByRole("button", { name: "保存总结" }).click();
  await expect(page.getByText("总结已保存。")).toBeVisible();
  await expect(page.getByText("已标记为人工编辑")).toBeVisible();

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const saved = await pool.query<{ summary: string; summary_manual: boolean }>(
      "select summary, summary_manual from items where id = $1",
      [itemId],
    );
    expect(saved.rows[0]).toEqual({ summary: "人工修订的总结。", summary_manual: true });
  } finally {
    await pool.end();
  }

  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.screenshot({
    path: `.workflow/screenshots/t16-admin-detail-${suffix}.png`,
    fullPage: true,
  });

  const deleteButton = page.getByRole("button", { name: "删除条目" });
  await deleteButton.click();
  const dialog = page.getByRole("dialog", { name: "确认删除条目" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeFocused();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(deleteButton).toBeFocused();

  await page.getByRole("button", { name: "手动重抓" }).click();
  await expect(page.getByText("已加入重抓队列。")).toBeVisible();
  await expect(page.getByRole("button", { name: "正在处理" })).toBeDisabled();

  await deleteButton.click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/admin\/library$/);
  await expect(page.getByText("收藏库还没有条目")).toBeVisible();

  const verifyPool = new Pool({ connectionString: databaseUrl });
  try {
    const counts = await verifyPool.query<{ items: string; requests: string; selections: string }>(
      `select (select count(*) from items)::text items,
              (select count(*) from processing_requests)::text requests,
              (select count(*) from daily_selections)::text selections`,
    );
    expect(counts.rows[0]).toEqual({ items: "0", requests: "0", selections: "0" });
  } finally {
    await verifyPool.end();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});
