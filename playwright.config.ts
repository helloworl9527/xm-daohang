import { defineConfig, devices } from "@playwright/test";

const databaseUrl = "postgresql://apple@127.0.0.1:5432/collection_system_test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    extraHTTPHeaders: { "x-real-ip": "203.0.113.77" },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "corepack pnpm build && corepack pnpm start --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/admin/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      APP_TIMEZONE: "Asia/Shanghai",
      LOGIN_IP_HASH_KEY: "e2e-login-hash-key-with-at-least-32-bytes",
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString("base64"),
    },
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
