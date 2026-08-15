const TEST_DATABASE_URL_LITERAL = "postgresql://apple@127.0.0.1:5432/collection_system_test";

export const TEST_DATABASE_URL = TEST_DATABASE_URL_LITERAL;

/** Guard the mutable E2E database before server startup or Pool creation. */
export function assertTestDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("E2E requires a test database URL");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("E2E database URL must be a valid PostgreSQL URL");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("E2E database URL must use the PostgreSQL protocol");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("E2E database host must be local");
  }
  if (parsed.pathname !== "/collection_system_test") {
    throw new Error("E2E database name must be collection_system_test");
  }

  return value;
}
