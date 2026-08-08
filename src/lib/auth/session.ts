import { createHash, randomBytes } from "node:crypto";

import { pool } from "@/db/client";

const IDLE_TTL_MS = 24 * 60 * 60 * 1_000;
const ABSOLUTE_TTL_MS = 7 * IDLE_TTL_MS;

export interface SessionRecord {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

interface SessionRow {
  id: string;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  options: { now?: Date } = {},
): Promise<{ token: string; session: SessionRecord }> {
  const now = options.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const result = await pool.query<SessionRow>(
    `insert into sessions
      (token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
     values ($1, $2, $2, $3, $4)
     returning id, created_at, last_seen_at, idle_expires_at, absolute_expires_at`,
    [
      hashSessionToken(token),
      now,
      new Date(now.getTime() + IDLE_TTL_MS),
      new Date(now.getTime() + ABSOLUTE_TTL_MS),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("SESSION_CREATE_FAILED");
  return { token, session: mapSession(row) };
}

export async function validateSession(
  token: string,
  now = new Date(),
): Promise<SessionRecord | null> {
  if (!token) return null;

  const result = await pool.query<SessionRow>(
    `update sessions
        set last_seen_at = greatest(last_seen_at, $2::timestamptz),
            idle_expires_at = least(
              absolute_expires_at,
              greatest(idle_expires_at, $2::timestamptz + interval '24 hours')
            )
      where token_hash = $1
        and idle_expires_at > $2::timestamptz
        and absolute_expires_at > $2::timestamptz
      returning id, created_at, last_seen_at, idle_expires_at, absolute_expires_at`,
    [hashSessionToken(token), now],
  );
  const row = result.rows[0];
  return row ? mapSession(row) : null;
}

export async function destroySession(token: string): Promise<boolean> {
  if (!token) return false;
  const result = await pool.query("delete from sessions where token_hash = $1", [
    hashSessionToken(token),
  ]);
  return result.rowCount === 1;
}
