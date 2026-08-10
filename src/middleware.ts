import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const scriptDevelopment = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const connectDevelopment = process.env.NODE_ENV === "development" ? " ws:" : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${scriptDevelopment}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    `connect-src 'self'${connectDevelopment}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // 开发模式：自动注入 x-real-ip（生产由 Caddy 注入）
  if (process.env.NODE_ENV === "development" && !requestHeaders.has("x-real-ip")) {
    const forwardedFor = requestHeaders.get("x-forwarded-for");
    const realIp = forwardedFor?.split(",")[0].trim() || "127.0.0.1";
    requestHeaders.set("x-real-ip", realIp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
