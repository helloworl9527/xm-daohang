import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

import { TEST_DATABASE_URL } from "./tests/e2e/testDatabase";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    // Database suites are destructive by design; always bind Vitest to the
    // guarded local test database instead of inheriting a developer's URL.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
    environment: "jsdom",
    fileParallelism: false,
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.ts",
      "tests/categories/**/*.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
