// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { getLoginClientIp } from "@/lib/auth/loginBoundary";

const PROXY_SECRET = "login-proxy-secret-with-at-least-32-bytes";

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    "x-proxy-auth": PROXY_SECRET,
    "x-real-client-ip": "203.0.113.42",
    ...overrides,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("admin login request boundary", () => {
  it("accepts the authenticated single-value client IP from Caddy", () => {
    vi.stubEnv("PROXY_SHARED_SECRET", PROXY_SECRET);
    expect(getLoginClientIp(headers())).toBe("203.0.113.42");
  });

  it("falls back to the edge-rewritten real IP when Server Actions omit proxy auth", () => {
    vi.stubEnv("PROXY_SHARED_SECRET", PROXY_SECRET);
    expect(
      getLoginClientIp(
        headers({ "x-proxy-auth": "", "x-real-client-ip": "", "x-real-ip": "203.0.113.43" }),
      ),
    ).toBe("203.0.113.43");
  });

  it("falls back to the edge-rewritten forwarded IP", () => {
    vi.stubEnv("PROXY_SHARED_SECRET", PROXY_SECRET);
    expect(
      getLoginClientIp(
        headers({
          "x-proxy-auth": "",
          "x-real-client-ip": "",
          "x-forwarded-for": "203.0.113.44",
        }),
      ),
    ).toBe("203.0.113.44");
  });

  it.each([
    ["missing proxy and real IP", { "x-proxy-auth": "", "x-real-ip": "" }],
    ["invalid fallback IP", { "x-proxy-auth": "wrong", "x-real-ip": "not-an-ip" }],
    ["multiple fallback IPs", { "x-proxy-auth": "", "x-real-ip": "203.0.113.42, 198.51.100.1" }],
  ])("rejects %s", (_label, overrides) => {
    vi.stubEnv("PROXY_SHARED_SECRET", PROXY_SECRET);
    expect(getLoginClientIp(headers(overrides))).toBeNull();
  });
});
