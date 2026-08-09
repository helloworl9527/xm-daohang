import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const workerId = process.env.WORKER_ID;
if (!connectionString || !workerId) process.exit(1);
const pool = new Pool({ connectionString });
try {
  const result = await pool.query(
    "select 1 from worker_heartbeats where worker_id = $1 and seen_at > now() - interval '45 seconds'",
    [workerId],
  );
  process.exitCode = result.rowCount === 1 ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
