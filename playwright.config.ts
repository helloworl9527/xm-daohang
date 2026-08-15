import { defineConfig, devices } from "@playwright/test";

import { assertTestDatabaseUrl, TEST_DATABASE_URL } from "./tests/e2e/testDatabase";

const databaseUrl = assertTestDatabaseUrl(TEST_DATABASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    extraHTTPHeaders: {
      "x-real-ip": "203.0.113.77",
      "x-real-client-ip": "203.0.113.77",
      "x-proxy-auth": "e2e-proxy-shared-secret-with-at-least-32-bytes",
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "corepack pnpm build && HOSTNAME=127.0.0.1 PORT=3100 corepack pnpm start",
    url: "http://127.0.0.1:3100/admin/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      APP_TIMEZONE: "Asia/Shanghai",
      IP_HASH_KEY: "e2e-public-ip-hash-key-with-at-least-32-bytes",
      PROXY_SHARED_SECRET: "e2e-proxy-shared-secret-with-at-least-32-bytes",
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
      name: "chromium-tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
  ],
});
