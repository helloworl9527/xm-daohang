import { createHash, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { type SessionRecord, validateSession } from "@/lib/auth/session";

export const SESSION_COOKIE_NAME = "admin_session";
export const CSRF_HEADER_NAME = "x-csrf-token";

export interface AdminSession extends SessionRecord {
  token: string;
  csrfToken: string;
}

export function createCsrfToken(sessionToken: string): string {
  return createHash("sha256").update(`csrf\0${sessionToken}`).digest("base64url");
}

export function verifyCsrfToken(sessionToken: string, supplied: string): boolean {
  const expected = Buffer.from(createCsrfToken(sessionToken));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function unauthorized(): Response {
  return Response.json(
    { error: { code: "AUTH_REQUIRED", message: "需要登录管理端。", retryable: false } },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

async function resolveAdminSession(token: string | null): Promise<AdminSession | null> {
  if (!token) return null;
  const session = await validateSession(token);
  return session ? { ...session, token, csrfToken: createCsrfToken(token) } : null;
}

export async function requireAdminApi(request: Request): Promise<AdminSession | Response> {
  const token = readCookie(request.headers.get("cookie") ?? "", SESSION_COOKIE_NAME);
  return (await resolveAdminSession(token)) ?? unauthorized();
}

export async function requireAdminPage(): Promise<AdminSession> {
  const store = await cookies();
  const session = await resolveAdminSession(store.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) redirect("/admin/login");
  return session;
}
