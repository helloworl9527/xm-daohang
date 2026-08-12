import { pool } from "@/db/client";
import { safeFetch, type BoundedResponse } from "@/lib/fetch/safeFetch";
import type { PublicCorpusQueryable } from "@/lib/items/publicCorpus";
import { unstable_cache } from "next/cache";

const MAX_FAVICON_BYTES = 128 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 60 * 60 * 1_000;

export const FAVICON_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
] as const;

export interface SiteFavicon {
  body: Uint8Array;
  mime: string;
  found: boolean;
  maxAge: number;
}

interface CachedFavicon {
  value: SiteFavicon;
  expiresAt: number;
}

export interface SiteFaviconDependencies {
  queryable: PublicCorpusQueryable;
  fetcher: (url: string) => Promise<BoundedResponse>;
  now: () => number;
}

type FaviconFetcher = typeof safeFetch;

// A valid local PNG response avoids exposing upstream URLs or error details.
const FALLBACK_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

function fallback(): SiteFavicon {
  return { body: FALLBACK_PNG, mime: "image/png", found: false, maxAge: FAILURE_TTL_MS / 1_000 };
}

export function deriveFaviconUrl(storedUrl: string): string {
  const origin = new URL(storedUrl).origin;
  if (origin === "null") throw new Error("FAVICON_URL_INVALID");
  return new URL("/favicon.ico", origin).toString();
}

export function fetchSiteFavicon(url: string, fetcher: FaviconFetcher = safeFetch) {
  return fetcher(url, {
    maxBytes: MAX_FAVICON_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    allowedMime: [...FAVICON_MIME_TYPES],
    requestHeaders: { accept: FAVICON_MIME_TYPES.join(", ") },
  });
}

export function createSiteFaviconLoader(dependencies: SiteFaviconDependencies) {
  const cache = new Map<string, CachedFavicon>();
  const inFlight = new Map<string, Promise<SiteFavicon>>();

  const load = async (itemId: string): Promise<SiteFavicon> => {
    const cached = cache.get(itemId);
    if (cached && cached.expiresAt > dependencies.now()) return cached.value;

    const existing = inFlight.get(itemId);
    if (existing) return existing;

    const operation = (async () => {
      let value = fallback();
      try {
        const result = await dependencies.queryable.query<{ url: string }>(
          `select url from items
            where id = $1 and status = 'completed' and type in ('web', 'github')`,
          [itemId],
        );
        const storedUrl = result.rows[0]?.url;
        if (!storedUrl) return value;

        const response = await dependencies.fetcher(deriveFaviconUrl(storedUrl));
        value = {
          body: response.body,
          mime: response.mime,
          found: true,
          maxAge: SUCCESS_TTL_MS / 1_000,
        };
        return value;
      } catch {
        return value;
      } finally {
        const ttl = value.found ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
        cache.set(itemId, { value, expiresAt: dependencies.now() + ttl });
      }
    })();

    inFlight.set(itemId, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(itemId);
    }
  };

  return load;
}

const loadUncachedSiteFavicon = createSiteFaviconLoader({
  queryable: pool,
  now: Date.now,
  fetcher: fetchSiteFavicon,
});

const loadCachedSuccess = unstable_cache(
  async (itemId: string) => {
    const value = await loadUncachedSiteFavicon(itemId);
    if (!value.found) throw new Error("FAVICON_UNAVAILABLE");
    return { ...value, body: Buffer.from(value.body).toString("base64") };
  },
  ["site-favicon-v1"],
  { revalidate: SUCCESS_TTL_MS / 1_000 },
);

const loadCachedFailure = unstable_cache(
  async (itemId: string) => {
    const value = await loadUncachedSiteFavicon(itemId);
    return { ...value, body: Buffer.from(value.body).toString("base64") };
  },
  ["site-favicon-failure-v1"],
  { revalidate: FAILURE_TTL_MS / 1_000 },
);

export async function loadSiteFavicon(itemId: string): Promise<SiteFavicon> {
  try {
    const cached = await loadCachedSuccess(itemId);
    return { ...cached, body: Uint8Array.from(Buffer.from(cached.body, "base64")) };
  } catch {
    const cached = await loadCachedFailure(itemId);
    return { ...cached, body: Uint8Array.from(Buffer.from(cached.body, "base64")) };
  }
}
