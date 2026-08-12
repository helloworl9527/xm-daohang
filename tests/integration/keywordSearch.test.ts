import { describe, expect, it, vi } from "vitest";
import { createKeywordHandler } from "@/lib/search/keyword";

const card = { id: "1", title: "字面命中", summary: "说明", url: "https://example.com", tags: ["标签"], categoryName: null, faviconPath: "/favicon/1" };
const request = (body: unknown) => new Request("https://example.com/search", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("public keyword search route", () => {
  it("returns the stable success envelope and does not consume ask quota", async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true });
    const response = await createKeywordHandler({ getClientIp: () => "203.0.113.7", consume, search: async () => [card] })(request({ query: "字面" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ query: "字面", matches: [card] });
    expect(consume).toHaveBeenCalledWith("203.0.113.7");
  });

  it("accepts one-character queries and fails closed when the proxy is untrusted", async () => {
    const search = vi.fn();
    const valid = await createKeywordHandler({ getClientIp: () => "203.0.113.7", consume: async () => ({ allowed: true }), search: async () => [] })(request({ query: "a" }));
    expect(valid.status).toBe(200);
    const untrusted = await createKeywordHandler({ consume: async () => ({ allowed: true }), search })(request({ query: "字面" }));
    expect(untrusted.status).toBe(503);
    await expect(untrusted.json()).resolves.toMatchObject({ error: { code: "SEARCH_UNAVAILABLE" } });
    expect(search).not.toHaveBeenCalled();
  });

  it("normalizes NFKC and rejects controls before quota or search", async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true });
    const search = vi.fn().mockResolvedValue([card]);
    const handler = createKeywordHandler({ getClientIp: () => "203.0.113.7", consume, search });
    const normalized = await handler(request({ query: "  Ａ  " }));
    expect(normalized.status).toBe(200);
    await expect(normalized.json()).resolves.toMatchObject({ query: "A" });
    expect(search).toHaveBeenCalledWith("A");
    consume.mockClear(); search.mockClear();
    for (const query of ["a\0", "a\u001f", " ", "x".repeat(101)]) {
      expect((await handler(request({ query }))).status).toBe(400);
    }
    expect(consume).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects non-JSON requests with the public query code", async () => {
    const response = await createKeywordHandler()(new Request("https://example.com/search", {
      method: "POST",
      body: "query=literal",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "QUERY_INVALID" } });
  });

  it("maps independent keyword limits and search failures", async () => {
    const limited = await createKeywordHandler({ getClientIp: () => "203.0.113.7", consume: async () => ({ allowed: false, reason: "ip" }) })(request({ query: "字面" }));
    expect(limited.status).toBe(429);
    const unavailable = await createKeywordHandler({ getClientIp: () => "203.0.113.7", consume: async () => ({ allowed: true }), search: async () => { throw new Error("db down"); } })(request({ query: "字面" }));
    expect(unavailable.status).toBe(503);
  });
});
