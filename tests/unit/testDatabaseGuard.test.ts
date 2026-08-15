import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertTestDatabaseUrl, TEST_DATABASE_URL } from "../../tests/e2e/testDatabase";

describe("E2E database guard", () => {
  it("accepts only the fixed local test database", () => {
    expect(assertTestDatabaseUrl(TEST_DATABASE_URL)).toBe(TEST_DATABASE_URL);
    expect(assertTestDatabaseUrl("postgresql://apple@localhost:5432/collection_system_test")).toContain("localhost");
    expect(assertTestDatabaseUrl("postgresql://apple@[::1]:5432/collection_system_test")).toContain("[::1]");
    expect(() => assertTestDatabaseUrl(undefined)).toThrow();
    expect(() =>
      assertTestDatabaseUrl("postgresql:///collection_system_test?host=%2Fvar%2Frun%2Fpostgresql"),
    ).toThrow("E2E database host must be local");
    expect(() => assertTestDatabaseUrl("postgresql://apple@127.0.0.1:5432/collection_system")).toThrow();
    expect(() => assertTestDatabaseUrl("postgresql://apple@db.example:5432/collection_system_test")).toThrow();
    expect(() => assertTestDatabaseUrl("mysql://apple@127.0.0.1:3306/collection_system_test")).toThrow();
  });

  it("keeps one PostgreSQL URL literal across E2E sources", () => {
    const files = readdirSync(join(process.cwd(), "tests/e2e"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => readFileSync(join(process.cwd(), "tests/e2e", entry.name), "utf8"));
    const matches = files.flatMap((source) => source.match(/postgres(?:ql)?:\/\/[^\"'`\s]+/g) ?? []);
    expect(matches).toEqual([TEST_DATABASE_URL]);
  });
});
