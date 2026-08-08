import { createHmac } from "node:crypto";
import ipaddr from "ipaddr.js";
import type { PoolClient } from "pg";

import { pool } from "@/db/client";

const FAILURE_LIMIT = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1_000;

type Queryable = Pick<PoolClient, "query">;

function getLoginHashKey(): string {
  const key = process.env.LOGIN_IP_HASH_KEY;
  if (!key || Buffer.byteLength(key) < 32) {
    throw new Error("LOGIN_IP_HASH_KEY must be at least 32 bytes");
  }
  return key;
}

function normalizeIp(ip: string): string {
  try {
    return ipaddr.process(ip).toString();
  } catch {
    throw new Error("INVALID_LOGIN_IP");
  }
}

export function hashLoginIp(ip: string): string {
  return createHmac("sha256", getLoginHashKey()).update(normalizeIp(ip)).digest("hex");
}

export async function recordAttempt(
  ipHash: string,
  success: boolean,
  at = new Date(),
  queryable: Queryable = pool,
): Promise<void> {
  await queryable.query(
    "insert into login_attempts (ip_hash, at, success) values ($1, $2, $3)",
    [ipHash, at, success],
  );
}

export async function isLockedOut(
  ipHash: string,
  now = new Date(),
  queryable: Queryable = pool,
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const result = await queryable.query<{ at: Date }>(
    `select at
       from login_attempts
      where ip_hash = $1
        and success = false
        and at <= $2
        and at > coalesce(
          (select max(at) from login_attempts where ip_hash = $1 and success = true and at <= $2),
          '-infinity'::timestamptz
        )
        and at > $2::timestamptz - interval '15 minutes'
      order by at desc
      limit $3`,
    [ipHash, now, FAILURE_LIMIT],
  );
  if (result.rows.length < FAILURE_LIMIT) return { locked: false, retryAfterSeconds: 0 };

  const oldestFailure = result.rows.at(-1)?.at;
  if (!oldestFailure) return { locked: false, retryAfterSeconds: 0 };
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((oldestFailure.getTime() + LOCK_WINDOW_MS - now.getTime()) / 1_000),
  );
  return { locked: retryAfterSeconds > 0, retryAfterSeconds };
}
