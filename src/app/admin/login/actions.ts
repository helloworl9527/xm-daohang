"use server";

import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { pool } from "@/db/client";
import { SESSION_COOKIE_NAME } from "@/lib/auth/guard";
import { isLockedOut, hashLoginIp, recordAttempt } from "@/lib/auth/loginThrottle";
import { verifyPassword } from "@/lib/auth/password";
import { getTrustedClientIpFromHeaders } from "@/lib/http/clientIp";
import { createSession, destroySession } from "@/lib/auth/session";
import { logger } from "@/lib/log/logger";

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$35Q9zyffqVUedJKurQQMpA$U6SRxLbqKJ+dqVLGvkTvSYzLQWX0H0LEj5Mq8xbk3/g";

const credentialsSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

export type LoginActionState =
  | { status: "idle" }
  | { status: "error" }
  | { status: "locked"; retryAfterSeconds: number };

type SessionCookie = {
  name: typeof SESSION_COOKIE_NAME;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/admin";
    expires: Date;
  };
};

export type LoginResult =
  | { ok: true; cookie: SessionCookie }
  | { ok: false; code: "INVALID_CREDENTIALS" | "LOCKED"; retryAfterSeconds?: number };

function sessionCookie(token: string, expires: Date): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "lax",
      path: "/admin",
      expires,
    },
  };
}

export async function loginWithCredentials(input: {
  username: string;
  password: string;
  ip: string;
  now?: Date;
}): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const ipHash = hashLoginIp(input.ip);
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [ipHash]);
    const lock = await isLockedOut(ipHash, now, client);
    if (lock.locked) {
      await client.query("commit");
      logger.info("login", { ok: false });
      return { ok: false, code: "LOCKED", retryAfterSeconds: lock.retryAfterSeconds };
    }

    const user = await client.query<{ username: string; password_hash: string }>(
      "select username, password_hash from admin_user where id = 1",
    );
    const row = user.rows[0];
    const passwordMatches = await verifyPassword(row?.password_hash ?? DUMMY_PASSWORD_HASH, input.password);
    const valid = row?.username === input.username && passwordMatches;
    await recordAttempt(ipHash, valid, now, client);
    if (!valid) {
      await client.query("commit");
      logger.info("login", { ok: false });
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    const created = await createSession({ now, client });
    await client.query("commit");
    logger.info("login", { ok: true });
    return { ok: true, cookie: sessionCookie(created.token, created.session.absoluteExpiresAt) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function hasValidFormBoundary(headerStore: Headers): boolean {
  const host = headerStore.get("host");
  const origin = headerStore.get("origin");
  const contentType = headerStore.get("content-type") ?? "";
  if (!host || !origin) return false;
  try {
    if (new URL(origin).host !== host) return false;
  } catch {
    return false;
  }
  return (
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("multipart/form-data")
  );
}

export function getLoginClientIp(headerStore: Headers): string | null {
  if (!hasValidFormBoundary(headerStore)) return null;
  try {
    return getTrustedClientIpFromHeaders(headerStore);
  } catch {
    return null;
  }
}

export async function loginAction(
  _previous: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const headerStore = await headers();
  const ip = getLoginClientIp(headerStore);
  if (!ip) return { status: "error" };

  const parsed = credentialsSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { status: "error" };

  const result = await loginWithCredentials({ ...parsed.data, ip });
  if (!result.ok) {
    return result.code === "LOCKED"
      ? { status: "locked", retryAfterSeconds: result.retryAfterSeconds ?? 1 }
      : { status: "error" };
  }

  const store = await cookies();
  store.set(result.cookie.name, result.cookie.value, result.cookie.options);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const headerStore = await headers();
  if (!hasValidFormBoundary(headerStore)) redirect("/admin/login");
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE_NAME);
  redirect("/admin/login");
}
