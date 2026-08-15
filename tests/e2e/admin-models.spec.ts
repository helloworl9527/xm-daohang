import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";
import argon2 from "argon2";
import { Pool } from "pg";

import { assertTestDatabaseUrl, TEST_DATABASE_URL } from "./testDatabase";

const databaseUrl = assertTestDatabaseUrl(TEST_DATABASE_URL);
const mockModelUrl = "http://127.0.0.1:4010/v1";
let modelServer: Server;

function embeddingVectors(): number[][] {
  return [
    [1, 0, 0, 0, 0, 0, 0, 0],
    [0.95, 0.05, 0, 0, 0, 0, 0, 0],
    [0.85, 0.15, 0, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0, 0, 0],
    [-1, 0, 0, 0, 0, 0, 0, 0],
  ];
}

test.beforeAll(async () => {
  modelServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/chat/completions") {
      response.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          model: "chat-test",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "连接成功" },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }
    if (request.url === "/v1/embeddings") {
      response.end(
        JSON.stringify({
          object: "list",
          model: "embedding-test",
          data: embeddingVectors().map((embedding, index) => ({
            object: "embedding",
            index,
            embedding,
          })),
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise<void>((resolve) => modelServer.listen(4010, "127.0.0.1", resolve));
});

test.beforeEach(async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "delete from processing_requests; delete from sessions; delete from login_attempts; delete from admin_user; delete from app_settings",
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
  } finally {
    await pool.end();
  }
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    modelServer.close((error) => (error ? reject(error) : resolve())),
  );
});

test("admin tests and saves independent model configurations", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const browserRequestOrigins: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().startsWith("http")) browserRequestOrigins.push(new URL(request.url()).origin);
  });

  const loginResponse = await page.goto("/admin/login");
  const csp = loginResponse?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).not.toContain("'unsafe-inline'");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("correct-password-123");
  await page.getByRole("button", { name: "登录管理端" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: "模型设置" }).click();
  await expect(page.getByRole("heading", { name: "模型配置" })).toBeVisible();

  await page.locator('input[name="llm-base-url"]').fill(mockModelUrl);
  await page.locator('input[name="llm-api-key"]').fill("sk-llm-e2e-aaaa");
  await page.locator('input[name="llm-model"]').fill("chat-test");
  await page.getByRole("button", { name: "测试对话模型" }).click();
  await expect(page.getByText("连接成功")).toBeVisible();
  await page
    .getByRole("region", { name: "对话模型" })
    .getByRole("button", { name: "保存对话模型" })
    .click();
  await expect(page.getByPlaceholder("sk-…aaaa")).toBeVisible();

  await page.locator('input[name="embedding-base-url"]').fill(mockModelUrl);
  await page.locator('input[name="embedding-api-key"]').fill("sk-embedding-e2e-bbbb");
  await page.locator('input[name="embedding-model"]').fill("embedding-test");
  await page.getByRole("button", { name: "测试嵌入模型" }).click();
  await expect(page.getByText(/实测 8 维 · 阈值/)).toBeVisible();
  await page
    .getByRole("region", { name: "嵌入模型" })
    .getByRole("button", { name: "保存嵌入模型" })
    .click();
  await expect(page.getByText(/向量重建中/)).toBeVisible();
  await expect(page.getByRole("button", { name: "测试嵌入模型" })).toBeDisabled();

  const suffix = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.screenshot({
    path: `.workflow/screenshots/t08-model-settings-${suffix}.png`,
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(new Set(browserRequestOrigins)).toEqual(new Set(["http://127.0.0.1:3100"]));
});
