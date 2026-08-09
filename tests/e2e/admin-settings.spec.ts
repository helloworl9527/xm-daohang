import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

import { encryptSecret } from "../../src/lib/crypto/secretbox";

const databaseUrl = "postgresql://apple@127.0.0.1:5432/collection_system_test";
const encryptionKey = Buffer.alloc(32, 13).toString("base64");

test.beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = encryptionKey;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "delete from telegram_receipts; delete from processing_requests; delete from daily_selections; delete from ask_counters; delete from items; delete from sessions; delete from login_attempts; delete from admin_user; delete from app_settings",
    );
    const passwordHash = await argon2.hash("current-password-123", {
      type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1,
    });
    await pool.query("insert into admin_user (id, username, password_hash) values (1, 'admin', $1)", [passwordHash]);
    await pool.query(
      `insert into app_settings
        (id, llm_base_url, llm_model, llm_key_enc, emb_base_url, emb_model, emb_key_enc,
         emb_dim, emb_version, emb_rebuild_status, search_min_cosine, refetch_enabled, refetch_interval_days)
       values (1, 'https://models.example/v1', 'chat', $1,
               'https://models.example/v1', 'embedding', $2, 3, 1, 'ready', 0.5, true, 30)`,
      [encryptSecret("sk-llm-e2e"), encryptSecret("sk-emb-e2e")],
    );
    await pool.query("insert into ask_counters (day, scope, count) values ('2026-08-09', 'global', 1)");
  } finally {
    await pool.end();
  }
});

test("admin configures operations, language, Telegram, and revokes sessions on password change", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("current-password-123");
  await page.getByRole("button", { name: "登录管理端" }).click();
  await page.getByRole("link", { name: "设置" }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator(".settings-panel")).toHaveCount(6);

  const refetch = page.locator("#settings-refetch");
  await refetch.getByRole("checkbox").uncheck();
  await refetch.getByRole("button", { name: "保存定时设置" }).click();
  await expect(refetch.getByText("定时设置已保存。")).toBeVisible();

  const rate = page.locator("#settings-rate");
  await rate.locator('input[name="rate-ip"]').fill("1");
  await rate.locator('input[name="rate-global"]').fill("1");
  await rate.getByRole("button", { name: "保存限流设置" }).click();
  await expect(rate.getByText("限流设置已保存。")).toBeVisible();
  const limited = await page.request.post("/ask", { data: { question: "这次不应调用模型" } });
  expect(limited.status()).toBe(429);

  const telegram = page.locator("#settings-telegram");
  await telegram.locator('input[name="telegram-token"]').fill("123456:e2e-telegram-secret");
  await telegram.locator('textarea[name="telegram-allowed-ids"]').fill("42, 99");
  await telegram.getByRole("button", { name: "保存 Telegram 设置" }).click();
  await expect(telegram.getByText("Telegram 设置已保存。")).toBeVisible();
  await expect(telegram.locator('input[name="telegram-token"]')).not.toHaveAttribute("placeholder", /e2e-telegram-secret/);

  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.screenshot({ path: `.workflow/screenshots/t24-admin-settings-${suffix}.png`, fullPage: true });

  const locale = page.locator("#settings-locale");
  await locale.getByRole("combobox").selectOption("en");
  await locale.getByRole("button", { name: "保存语言" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  const security = page.locator("#settings-security");
  await security.locator('input[name="current-password"]').fill("current-password-123");
  await security.locator('input[name="new-password"]').fill("new-password-456");
  await security.getByRole("button", { name: "Change password and revoke sessions" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("current-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/incorrect/i)).toBeVisible();
  await page.reload();
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("new-password-456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const state = await pool.query<{ refetch_enabled: boolean; ratelimit_ip_daily: number; ratelimit_global_daily: number; tg_allowed_ids: string[]; tg_token_enc: string }>(
      "select refetch_enabled, ratelimit_ip_daily, ratelimit_global_daily, tg_allowed_ids, tg_token_enc from app_settings where id = 1",
    );
    expect(state.rows[0]).toMatchObject({ refetch_enabled: false, ratelimit_ip_daily: 1, ratelimit_global_daily: 1 });
    expect(state.rows[0].tg_allowed_ids.map(Number)).toEqual([42, 99]);
    expect(state.rows[0].tg_token_enc).not.toContain("e2e-telegram-secret");
  } finally {
    await pool.end();
  }
  expect(errors).toEqual([]);
});
