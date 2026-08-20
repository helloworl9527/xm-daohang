// @vitest-environment node

import { describe, expect, it } from "vitest";

import { getLoginClientIp } from "@/lib/auth/loginBoundary";

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    host: "sc.xmcode.tech",
    origin: "https://sc.xmcode.tech",
    "content-type": "application/x-www-form-urlencoded",
    "x-real-ip": "203.0.113.42",
    ...overrides,
  });
}

describe("admin login request boundary", () => {
  it("accepts the single-value client IP injected by Caddy", () => {
    expect(getLoginClientIp(headers())).toBe("203.0.113.42");
  });

  it.each([
    ["missing client IP", { "x-real-ip": "" }],
    ["invalid client IP", { "x-real-ip": "not-an-ip" }],
    ["cross-origin form", { origin: "https://attacker.example" }],
    ["multiple client IPs", { "x-real-ip": "203.0.113.42, 198.51.100.1" }],
  ])("rejects %s", (_label, overrides) => {
    expect(getLoginClientIp(headers(overrides))).toBeNull();
  });
});
