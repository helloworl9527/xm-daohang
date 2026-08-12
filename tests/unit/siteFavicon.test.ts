// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createSiteFaviconLoader,
  deriveFaviconUrl,
  FAVICON_MIME_TYPES,
  fetchSiteFavicon,
} from "@/lib/favicon/siteFavicon";
import type { PublicCorpusQueryable } from "@/lib/items/publicCorpus";

const ID = "a3000000-0000-4000-8000-000000000001";

describe("site favicon", () => {
  it("derives only the origin favicon path from the stored item URL", () => {
    expect(deriveFaviconUrl("https://user:pass@example.com:8443/private?q=secret#fragment"))
      .toBe("https://example.com:8443/favicon.ico");
  });

  it("queries only eligible items and never fetches a missing item", async () => {
    const calls: Array<[string, readonly unknown[] | undefined]> = [];
    const query: PublicCorpusQueryable["query"] = async (text, values) => {
      calls.push([text, values]);
      return { rows: [] };
    };
    const fetcher = vi.fn();
    const load = createSiteFaviconLoader({ queryable: { query }, fetcher, now: () => 0 });
    const result = await load(ID);
    expect(result).toMatchObject({ found: false, eligible: false });
    expect(calls[0]?.[0]).toContain("status = 'completed'");
    expect(calls[0]?.[0]).toContain("type in ('web', 'github')");
    expect(calls[0]?.[1]).toEqual([ID]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("merges concurrent requests and caches success for seven days", async () => {
    let now = 0;
    const queryCalls = vi.fn();
    const query: PublicCorpusQueryable["query"] = async <T extends object>() => {
      queryCalls();
      return { rows: [{ url: "https://site.example/private" }] as unknown as T[] };
    };
    const fetcher = vi.fn(async () => ({
      url: "https://site.example/favicon.ico", status: 200, mime: "image/png",
      headers: {}, body: Uint8Array.of(1, 2, 3),
    }));
    const load = createSiteFaviconLoader({ queryable: { query }, fetcher, now: () => now });
    const first = await Promise.all([load(ID), load(ID), load(ID)]);
    expect(first.every((value) => value.found)).toBe(true);
    expect(queryCalls).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://site.example/favicon.ico");
    now = 7 * 24 * 60 * 60 * 1_000 - 1;
    await load(ID);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 2;
    await load(ID);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("caches failures for one hour without leaking upstream details", async () => {
    let now = 0;
    const query: PublicCorpusQueryable["query"] = async <T extends object>() => ({
      rows: [{ url: "https://secret.example/path" }] as unknown as T[],
    });
    const fetcher = vi.fn(async () => { throw new Error("target https://secret.example/private"); });
    const load = createSiteFaviconLoader({ queryable: { query }, fetcher, now: () => now });
    const failed = await load(ID);
    expect(failed).toMatchObject({ found: false, eligible: true, mime: "image/png", maxAge: 3_600 });
    expect(new TextDecoder().decode(failed.body)).not.toContain("secret.example");
    now = 3_599_999;
    await load(ID);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 2;
    await load(ID);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the production MIME allowlist raster-only and route input item-id-only", async () => {
    expect(FAVICON_MIME_TYPES).not.toContain("image/svg+xml");
    expect(FAVICON_MIME_TYPES).not.toContain("text/html");
    const route = await readFile("src/app/(public)/favicon/[id]/route.ts", "utf8");
    expect(route).toContain("z.string().uuid()");
    expect(route).not.toContain("searchParams");
    expect(route).not.toContain("hostname");
  });

  it("uses safeFetch with a streaming 128 KiB ceiling and reviewed MIME list", async () => {
    const fetcher = vi.fn(async () => ({
      url: "https://site.example/favicon.ico", status: 200, mime: "image/png",
      headers: {}, body: Uint8Array.of(1),
    }));
    await fetchSiteFavicon("https://site.example/favicon.ico", fetcher);
    expect(fetcher).toHaveBeenCalledWith("https://site.example/favicon.ico", {
      maxBytes: 128 * 1024,
      timeoutMs: 5_000,
      allowedMime: [...FAVICON_MIME_TYPES],
      requestHeaders: { accept: FAVICON_MIME_TYPES.join(", ") },
    });
  });
});
