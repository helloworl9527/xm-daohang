// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { getLoginClientIp } from "@/lib/auth/loginBoundary";

const PROXY_SECRET = "login-proxy-secret-with-at-least-32-bytes";

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    host: "sc.xmcode.tech",
    origin: "https://sc.xmcode.tech",
    "content-type": "application/x-www-form-urlencoded",
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

  it.each([
    ["missing proxy authentication", { "x-proxy-auth": "" }],
    ["wrong proxy authentication", { "x-proxy-auth": "wrong" }],
    ["cross-origin form", { origin: "https://attacker.example" }],
    ["multiple client IPs", { "x-real-client-ip": "203.0.113.42, 198.51.100.1" }],
  ])("rejects %s", (_label, overrides) => {
    vi.stubEnv("PROXY_SHARED_SECRET", PROXY_SECRET);
    expect(getLoginClientIp(headers(overrides))).toBeNull();
  });
});
