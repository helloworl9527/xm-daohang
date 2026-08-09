// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  vi.resetModules();
});

describe("database client initialization", () => {
  it("loads without DATABASE_URL and fails only on the first connection attempt", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const client = await import("@/db/client");

    expect(client.db).toBeDefined();
    await expect(client.pool.query("select 1")).rejects.toThrow("DATABASE_URL is required");
    await expect(client.pool.connect()).rejects.toThrow("DATABASE_URL is required");
  });
});
