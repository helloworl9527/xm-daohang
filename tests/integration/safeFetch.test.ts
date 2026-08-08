import { describe, expect, it, vi } from "vitest";

import {
  createSafeFetch,
  SafeFetchError,
  type SafeFetchDependencies,
  type TransportResponse,
} from "@/lib/fetch/safeFetch";

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 as const };

function body(...chunks: string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield new TextEncoder().encode(chunk);
    },
  };
}

function response(
  status: number,
  headers: Record<string, string>,
  chunks: string[] = [],
): TransportResponse {
  return { status, headers, body: body(...chunks), discard: vi.fn(async () => undefined) };
}

function harness(routes: Record<string, TransportResponse | (() => TransportResponse)>) {
  const resolveTarget = vi.fn(async (url: string) => {
    if (new URL(url).hostname === "private.example") {
      throw new SafeFetchError("URL_BLOCKED_ADDRESS");
    }
    return { url, addresses: [PUBLIC_ADDRESS] };
  });
  const transport = vi.fn<SafeFetchDependencies["transport"]>(async (url, addresses) => {
    expect(addresses).toEqual([PUBLIC_ADDRESS]);
    const selected = routes[url];
    if (!selected) throw new Error(`Unexpected route: ${url}`);
    return typeof selected === "function" ? selected() : selected;
  });

  return { fetch: createSafeFetch({ resolveTarget, transport }), resolveTarget, transport };
}

describe("safeFetch", () => {
  it("follows two public redirects and fixes each connection to reviewed addresses", async () => {
    const { fetch, resolveTarget, transport } = harness({
      "https://a.example/start": response(302, { location: "https://b.example/next" }),
      "https://b.example/next": response(301, { location: "/final" }),
      "https://b.example/final": response(200, { "content-type": "text/plain" }, ["ok"]),
    });

    const result = await fetch("https://a.example/start", {
      maxBytes: 32,
      timeoutMs: 1_000,
      allowedMime: ["text/plain"],
    });

    expect(new TextDecoder().decode(result.body)).toBe("ok");
    expect(result.url).toBe("https://b.example/final");
    expect(resolveTarget).toHaveBeenCalledTimes(3);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("rejects a redirect to a private target before transport", async () => {
    const { fetch, transport } = harness({
      "https://public.example/start": response(302, { location: "https://private.example/secret" }),
    });

    await expect(
      fetch("https://public.example/start", {
        maxBytes: 32,
        timeoutMs: 1_000,
        allowedMime: ["text/plain"],
      }),
    ).rejects.toMatchObject({ code: "URL_BLOCKED_ADDRESS" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects HTTPS to HTTP downgrade", async () => {
    const { fetch, transport } = harness({
      "https://public.example/start": response(302, { location: "http://public.example/plain" }),
    });

    await expect(
      fetch("https://public.example/start", {
        maxBytes: 32,
        timeoutMs: 1_000,
        allowedMime: ["text/plain"],
      }),
    ).rejects.toMatchObject({ code: "FETCH_HTTPS_DOWNGRADE" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects redirect loops and a sixth redirect", async () => {
    const loop = harness({
      "https://loop.example/a": response(302, { location: "/b" }),
      "https://loop.example/b": response(302, { location: "/a" }),
    });
    await expect(
      loop.fetch("https://loop.example/a", {
        maxBytes: 32,
        timeoutMs: 1_000,
        allowedMime: ["text/plain"],
      }),
    ).rejects.toMatchObject({ code: "FETCH_REDIRECT_LOOP" });

    const routes: Record<string, TransportResponse> = {};
    for (let index = 0; index <= 5; index += 1) {
      routes[`https://many.example/${index}`] = response(302, {
        location: `https://many.example/${index + 1}`,
      });
    }
    const many = harness(routes);
    await expect(
      many.fetch("https://many.example/0", {
        maxBytes: 32,
        timeoutMs: 1_000,
        allowedMime: ["text/plain"],
      }),
    ).rejects.toMatchObject({ code: "FETCH_TOO_MANY_REDIRECTS" });
  });

  it("aborts on oversized bodies and rejects unexpected MIME", async () => {
    const oversized = harness({
      "https://large.example/": response(200, { "content-type": "text/plain" }, ["1234", "5678"]),
    });
    await expect(
      oversized.fetch("https://large.example/", {
        maxBytes: 6,
        timeoutMs: 1_000,
        allowedMime: ["text/plain"],
      }),
    ).rejects.toMatchObject({ code: "FETCH_BODY_TOO_LARGE" });

    const wrongMime = harness({
      "https://mime.example/": response(200, { "content-type": "application/octet-stream" }, ["x"]),
    });
    await expect(
      wrongMime.fetch("https://mime.example/", {
        maxBytes: 6,
        timeoutMs: 1_000,
        allowedMime: ["text/plain"],
      }),
    ).rejects.toMatchObject({ code: "FETCH_MIME_NOT_ALLOWED" });
  });

  it("fails the whole chain when the total timeout expires", async () => {
    const resolveTarget = vi.fn(
      async () => new Promise<{ url: string; addresses: [typeof PUBLIC_ADDRESS] }>(() => undefined),
    );
    const transport = vi.fn<SafeFetchDependencies["transport"]>();
    const fetch = createSafeFetch({ resolveTarget, transport });

    await expect(
      fetch("https://slow.example/", {
        maxBytes: 32,
        timeoutMs: 5,
        allowedMime: ["text/plain"],
      }),
    ).rejects.toMatchObject({ code: "FETCH_TIMEOUT" });
    expect(transport).not.toHaveBeenCalled();
  });
});
