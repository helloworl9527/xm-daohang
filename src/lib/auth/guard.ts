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
  return apiError("AUTH_REQUIRED", "需要登录管理端。", 401);
}

export function apiError(
  code: string,
  message: string,
  status: number,
  retryable = false,
): Response {
  return Response.json(
    { error: { code, message, retryable } },
    { status, headers: { "Cache-Control": "no-store" } },
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

export async function requireAdminWrite(request: Request): Promise<AdminSession | Response> {
  const session = await requireAdminApi(request);
  if (session instanceof Response) return session;

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return apiError("CSRF_INVALID", "请求来源无效。", 403);
  try {
    if (new URL(origin).host !== host) return apiError("CSRF_INVALID", "请求来源无效。", 403);
  } catch {
    return apiError("CSRF_INVALID", "请求来源无效。", 403);
  }

  const csrf = request.headers.get(CSRF_HEADER_NAME);
  if (!csrf || !verifyCsrfToken(session.token, csrf)) {
    return apiError("CSRF_INVALID", "请求校验失败。", 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return apiError("VALIDATION", "请求格式无效。", 415);
  }
  return session;
}

export async function requireAdminPage(): Promise<AdminSession> {
  const store = await cookies();
  const session = await resolveAdminSession(store.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) redirect("/admin/login");
  return session;
}
