import { describe, expect, it, vi } from "vitest";

import { createLogger, sanitizeForLog, serializeLog } from "@/lib/log/logger";

describe("sanitizeForLog", () => {
  it("redacts sensitive values recursively and sanitizes URLs", () => {
    const input = {
      event: "upstream_error",
      apiKey: "sk-top-secret",
      nested: {
        password: "correct horse battery staple",
        headers: {
          authorization: "Bearer secret-token",
          cookie: "session=secret-cookie",
          "x-request-id": "request-123",
        },
        links: [
          "https://user:pass@example.com/path?token=secret&view=compact&api_key=hidden",
        ],
      },
    };

    const serialized = serializeLog(input);

    expect(serialized).not.toContain("sk-top-secret");
    expect(serialized).not.toContain("correct horse");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("secret-cookie");
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("secret&");
    expect(serialized).not.toContain("hidden");
    expect(serialized).toContain("request-123");
    expect(serialized).toContain("view=compact");
  });

  it("converts Error and cause to an allowlisted shape", () => {
    const cause = Object.assign(new Error("socket failed"), {
      code: "ECONNRESET",
      headers: { authorization: "Bearer leaked" },
    });
    const error = Object.assign(new Error("request failed", { cause }), {
      code: "UPSTREAM",
      response: { apiKey: "leaked-key" },
    });

    expect(sanitizeForLog(error)).toEqual({
      name: "Error",
      code: "UPSTREAM",
      message: "request failed",
      cause: {
        name: "Error",
        code: "ECONNRESET",
        message: "socket failed",
      },
    });
  });

  it("handles cycles and bounds oversized values", () => {
    const cyclic: Record<string, unknown> = { safe: "kept" };
    cyclic.self = cyclic;
    cyclic.long = "x".repeat(5_000);
    cyclic.many = Array.from({ length: 200 }, (_, index) => index);

    const output = sanitizeForLog(cyclic) as Record<string, unknown>;

    expect(output.safe).toBe("kept");
    expect(output.self).toBe("[Circular]");
    expect((output.long as string).length).toBeLessThan(5_000);
    expect((output.many as unknown[]).length).toBeLessThan(200);
  });
});

describe("createLogger", () => {
  it("writes one sanitized JSON object per event", () => {
    const write = vi.fn();
    const logger = createLogger(write);

    logger.info("login", { ok: false, password: "not-for-logs" });

    expect(write).toHaveBeenCalledOnce();
    const payload = JSON.parse(write.mock.calls[0][0]);
    expect(payload).toMatchObject({ level: "info", event: "login", ok: false });
    expect(write.mock.calls[0][0]).not.toContain("not-for-logs");
  });
});
