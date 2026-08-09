import { Pool } from "pg";

import { initializeAdmin } from "./admin-credentials.ts";
import { readCredential } from "./credential-input.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString });
try {
  const username = await readCredential("Username", "ADMIN_USERNAME_FILE");
  const password = await readCredential("New password", "ADMIN_PASSWORD_FILE", true);
  const result = await initializeAdmin(username, password, pool);
  process.stdout.write(result === "created" ? "Administrator initialized.\n" : "Administrator already initialized.\n");
} finally {
  await pool.end();
}
