import PgBoss from "pg-boss";

export const PROCESS_ITEM_QUEUE = "process-item";

export function createBoss(): PgBoss {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new PgBoss({
    connectionString,
    schema: "pgboss",
    retryLimit: 0,
  });
}

export async function ensureProcessingQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(PROCESS_ITEM_QUEUE, {
    name: PROCESS_ITEM_QUEUE,
    policy: "short",
    retryLimit: 0,
  });
}
