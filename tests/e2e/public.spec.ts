import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

const pool = new Pool({ connectionString: "postgresql://apple@127.0.0.1:5432/collection_system_test" });

async function seedPublicHome() {
  await pool.query("delete from daily_selections; delete from items; delete from app_settings");
  await pool.query(
    `insert into app_settings
       (id, llm_base_url, llm_model, llm_key_enc, emb_base_url, emb_model, emb_key_enc,
        emb_dim, emb_version, emb_rebuild_status, search_min_cosine)
     values (1, 'https://models.example/v1', 'chat', 'configured',
             'https://models.example/v1', 'emb', 'configured', 3, 1, 'ready', 0.5)`,
  );
  await pool.query(
    `insert into items (id, url, url_canonical, type, source, status, title, summary, tags)
     values
       ('10000000-0000-4000-8000-000000000001', 'https://example.com/one', 'https://example.com/one', 'web', 'admin', 'completed', '精确余弦检索', '介绍 PostgreSQL 与 pgvector 的精确检索。适合小型收藏库。', array['PostgreSQL','pgvector','检索']),
       ('20000000-0000-4000-8000-000000000002', 'https://example.com/two', 'https://example.com/two', 'web', 'telegram', 'completed', '可靠任务队列', '总结持久队列的租约、重试与幂等边界。内容保持中文。', array['队列','可靠性','重试']),
       ('30000000-0000-4000-8000-000000000003', 'https://example.com/three', 'https://example.com/three', 'web', 'admin', 'completed', '安全抓取边界', '说明 SSRF 防护、重定向和内容上限。外部内容始终视为不可信。', array['安全','SSRF','抓取'])`,
  );
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async () => seedPublicHome());
test.afterAll(async () => pool.end());

test("renders three stable daily items and a geometrically full ask input", async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".public-item")).toHaveCount(3);
  const geometry = await page.evaluate(() => {
    const form = document.querySelector(".public-ask-form")!.getBoundingClientRect();
    const label = document.querySelector(".public-ask-form label")!.getBoundingClientRect();
    const input = document.querySelector(".public-ask-form input")!.getBoundingClientRect();
    const button = document.querySelector(".public-ask-form button")!.getBoundingClientRect();
    return {
      widthDelta: Math.abs(input.width - label.width),
      heightDelta: Math.abs(input.height - form.height),
      rightBeforeButton: input.right <= button.left,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(geometry.widthDelta).toBeLessThan(0.5);
  expect(geometry.heightDelta).toBeLessThan(0.5);
  expect(geometry.rightBeforeButton).toBe(true);
  expect(geometry.overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `.workflow/screenshots/t23-public-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("renders hit, loading, empty, limited, and retryable error states from API responses", async ({ page }) => {
  let state: "hit" | "empty" | "limited" | "error" = "hit";
  await page.route("**/ask", async (route) => {
    if (state === "hit") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "可以使用 pgvector 做精确余弦检索。",
          sources: [{
            id: "10000000-0000-4000-8000-000000000001",
            title: "精确余弦检索",
            summary: "介绍 PostgreSQL 与 pgvector 的精确检索。",
            url: "https://example.com/one",
            tags: ["PostgreSQL", "pgvector", "检索"],
            score: 0.91,
            cited: true,
          }],
        }),
      });
      return;
    }
    if (state === "empty") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "收藏库中没有相关内容", sources: [] }) });
      return;
    }
    await route.fulfill({
      status: state === "limited" ? 429 : 502,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: state === "limited" ? "RATE_LIMITED" : "UPSTREAM_ERROR", message: "stable", retryable: true } }),
    });
  });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: /收藏库|collection/i });
  await input.fill("如何做语义检索？");
  await page.getByRole("button", { name: /提问|ask/i }).click();
  await expect(page.getByText("正在检索收藏库…")).toBeVisible();
  await expect(page.getByText("可以使用 pgvector 做精确余弦检索。")).toBeVisible();
  await expect(page.locator(".public-source").filter({ hasText: "精确余弦检索" })).toHaveAttribute("href", "https://example.com/one");

  for (const [next, expected] of [
    ["empty", "收藏库中没有相关内容"],
    ["limited", "今日提问已达上限，请稍后再来"],
    ["error", "问答暂时失败"],
  ] as const) {
    state = next;
    await page.getByRole("button", { name: /提问|ask|重试|retry/i }).click();
    await expect(page.getByText(expected, { exact: false })).toBeVisible();
  }
  await expect(input).toHaveValue("如何做语义检索？");
  await expect(page.locator("[aria-live='polite']")).toBeVisible();
});

test("disables asking for an empty library or rebuilding embeddings", async ({ page }) => {
  await pool.query("delete from daily_selections; delete from items");
  await page.goto("/");
  await expect(page.getByText("收藏库还没有可展示内容")).toBeVisible();
  await expect(page.getByRole("textbox")).toBeDisabled();
  await expect(page.locator(".public-home-state").getByRole("link", { name: /站主|admin/i })).toBeVisible();

  await seedPublicHome();
  await pool.query("update app_settings set emb_rebuild_status = 'building'");
  await page.reload();
  await expect(page.getByRole("textbox")).toBeDisabled();
  await expect(page.getByText("问答服务暂未就绪")).toBeVisible();
});

test("keeps public UI localized while AI content remains Chinese", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("collection");
  await expect(page.getByRole("textbox")).toHaveAttribute("placeholder", /Ask/i);
  await expect(page.locator(".public-item p").filter({ hasText: "介绍 PostgreSQL 与 pgvector 的精确检索。适合小型收藏库。" }).first()).toBeVisible();
});

test("supports 320px, keyboard focus, and accessibility preference media", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-reduced-transparency", value: "reduce" },
      { name: "prefers-contrast", value: "more" },
    ],
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
  const state = await page.evaluate(() => {
    const dock = document.querySelector(".public-ask-dock")!;
    const style = getComputedStyle(dock);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      background: style.backgroundColor,
      backdrop: style.backdropFilter,
      border: style.borderTopColor,
    };
  });
  expect(state.overflow).toBeLessThanOrEqual(0);
  expect(state.backdrop).toBe("none");
  expect(state.border).toBe("rgb(23, 33, 29)");
});
