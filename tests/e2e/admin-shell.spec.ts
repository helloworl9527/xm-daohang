import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

import { assertTestDatabaseUrl, TEST_DATABASE_URL } from "./testDatabase";

const databaseUrl = assertTestDatabaseUrl(TEST_DATABASE_URL);

test.beforeEach(async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("delete from sessions; delete from login_attempts; delete from admin_user");
    const passwordHash = await argon2.hash("correct-password-123", {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await pool.query("insert into admin_user (id, username, password_hash) values (1, 'admin', $1)", [passwordHash]);
  } finally {
    await pool.end();
  }
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("correct-password-123");
  await page.getByRole("button", { name: "登录管理端" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/library");
}

test("keeps the admin chrome current, bounded, and keyboard-safe", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);

  const sidebar = page.getByRole("complementary", { name: "管理端主导航", includeHidden: true });
  const mobile = testInfo.project.name.includes("mobile");
  if (!mobile) {
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(240);
    await expect(sidebar).toHaveCSS("position", "fixed");
    await expect(page.getByRole("link", { name: "收藏库" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "打开导航" })).toBeHidden();
  } else {
    const trigger = page.getByRole("button", { name: "打开导航" });
    await expect(trigger).toBeVisible();
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await trigger.click();
    await expect(page.getByRole("button", { name: "关闭导航" }).first()).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    await expect.poll(() => sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("A");
    expect(await page.locator("#admin-main").evaluate((element) => (element as HTMLElement).inert)).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
    await page.screenshot({ path: `.workflow/screenshots/ink-signal/phase3-admin-drawer-${testInfo.project.name}.png` });

    const localeButtons = page.locator(".locale-switcher button");
    await localeButtons.last().focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(await page.locator("#admin-main").evaluate((element) => (element as HTMLElement).inert)).toBe(false);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    await trigger.click();
    await page.locator(".admin-drawer-scrim").click({ position: { x: 380, y: 420 } });
    await expect(trigger).toBeFocused();
  }

  await page.screenshot({ path: `.workflow/screenshots/ink-signal/phase3-admin-shell-${testInfo.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
