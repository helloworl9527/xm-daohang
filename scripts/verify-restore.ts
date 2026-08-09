import { readCredentialFile } from "./admin-credentials.ts";
import { decryptSecret } from "../src/lib/crypto/secretbox.ts";
import { verifyPassword } from "../src/lib/auth/password.ts";
import { Pool } from "pg";

const sourceUrl = process.env.DATABASE_URL;
const databaseName = process.env.RESTORE_DATABASE_NAME;
const passwordFile = process.env.RESTORE_ADMIN_PASSWORD_FILE;
if (!sourceUrl || !databaseName || !passwordFile) throw new Error("RESTORE_CONFIGURATION_REQUIRED");
const url = new URL(sourceUrl);
url.pathname = `/${databaseName}`;
const pool = new Pool({ connectionString: url.toString() });
try {
  const schema = await pool.query<{ vector: boolean; migrations: boolean }>(
    `select exists(select 1 from pg_extension where extname = 'vector') as vector,
            to_regclass('drizzle.__drizzle_migrations') is not null as migrations`,
  );
  if (!schema.rows[0]?.vector || !schema.rows[0]?.migrations) throw new Error("RESTORE_SCHEMA_INVALID");
  const admin = await pool.query<{ password_hash: string }>("select password_hash from admin_user where id = 1");
  const password = await readCredentialFile(passwordFile);
  if (!admin.rows[0] || !(await verifyPassword(admin.rows[0].password_hash, password))) {
    throw new Error("RESTORE_LOGIN_INVALID");
  }
  const settings = await pool.query<{ llm_key_enc: string | null; emb_key_enc: string | null; tg_token_enc: string | null }>(
    "select llm_key_enc, emb_key_enc, tg_token_enc from app_settings where id = 1",
  );
  for (const encrypted of Object.values(settings.rows[0] ?? {}).filter((value): value is string => Boolean(value))) {
    if (!decryptSecret(encrypted)) throw new Error("RESTORE_SECRET_INVALID");
  }
  await pool.query("select id from items where status = 'completed' and embedding is not null order by embedding <=> embedding limit 1");
  process.stdout.write("Restore drill passed: schema, admin login, encrypted settings, and vector query verified.\n");
} finally {
  await pool.end();
}
