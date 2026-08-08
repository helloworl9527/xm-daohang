import type { LookupFunction } from "node:net";

import { Agent, request } from "undici";

import {
  resolvePublicTarget,
  type ResolvedAddress,
} from "@/lib/fetch/urlGuard";

const MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  allowedMime: string[];
  acceptedStatuses?: number[];
  requestHeaders?: Record<string, string>;
}

export interface BoundedResponse {
  url: string;
  status: number;
  mime: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  discard: () => Promise<void>;
  close?: () => Promise<void>;
}

export interface SafeFetchDependencies {
  resolveTarget: (url: string) => Promise<{ url: string; addresses: ResolvedAddress[] }>;
  transport: (
    url: string,
    addresses: ResolvedAddress[],
    signal: AbortSignal,
    headers?: Record<string, string>,
  ) => Promise<TransportResponse>;
}

export class SafeFetchError extends Error {
  constructor(public readonly code: string, options?: ErrorOptions) {
    super(code, options);
    this.name = "SafeFetchError";
  }
}

function fixedLookup(addresses: ResolvedAddress[]): LookupFunction {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    const requestedFamily = options.family === "IPv4"
      ? 4
      : options.family === "IPv6"
        ? 6
        : options.family;
    const matching = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    const selected = matching.length > 0 ? matching : addresses;

    if (options.all) callback(null, selected);
    else callback(null, selected[0].address, selected[0].family);
  };
  return lookup;
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
}

const undiciTransport: SafeFetchDependencies["transport"] = async (url, addresses, signal, headers) => {
  const dispatcher = new Agent({ connect: { lookup: fixedLookup(addresses) } });
  try {
    const result = await request(url, {
      dispatcher,
      method: "GET",
      maxRedirections: 0,
      signal,
      headers: headers ?? { accept: "text/html, text/plain, application/pdf" },
    });
    return {
      status: result.statusCode,
      headers: normalizeHeaders(result.headers),
      body: result.body,
      discard: async () => result.body.dump(),
      close: async () => dispatcher.close(),
    };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
};

function header(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  return entry?.[1];
}

function mimeType(headers: Record<string, string>): string {
  return (header(headers, "content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

async function readBoundedBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new SafeFetchError("FETCH_BODY_TOO_LARGE");
    chunks.push(chunk);
  }

  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function validateOptions(options: SafeFetchOptions): void {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new SafeFetchError("FETCH_INVALID_MAX_BYTES");
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new SafeFetchError("FETCH_INVALID_TIMEOUT");
  }
  if (options.allowedMime.length === 0) throw new SafeFetchError("FETCH_MIME_REQUIRED");
  if (options.acceptedStatuses?.some(
    (status) => !Number.isInteger(status) || status < 100 || status > 599,
  )) {
    throw new SafeFetchError("FETCH_INVALID_ACCEPTED_STATUS");
  }
}

export function createSafeFetch(dependencies: SafeFetchDependencies) {
  return async (rawUrl: string, options: SafeFetchOptions): Promise<BoundedResponse> => {
    validateOptions(options);
    const abortController = new AbortController();
    const timeoutError = new SafeFetchError("FETCH_TIMEOUT");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abortController.abort(timeoutError);
        reject(timeoutError);
      }, options.timeoutMs);
    });

    const operation = async (): Promise<BoundedResponse> => {
      let currentUrl = rawUrl;
      const requestOrigin = new URL(rawUrl).origin;
      let redirects = 0;
      const visited = new Set<string>();

      while (true) {
        const target = await dependencies.resolveTarget(currentUrl);
        currentUrl = target.url;
        if (visited.has(currentUrl)) throw new SafeFetchError("FETCH_REDIRECT_LOOP");
        visited.add(currentUrl);

        const response = await dependencies.transport(
          currentUrl,
          target.addresses,
          abortController.signal,
          new URL(currentUrl).origin === requestOrigin ? options.requestHeaders : undefined,
        );

        if (response.status >= 300 && response.status < 400) {
          try {
            const location = header(response.headers, "location");
            if (!location) throw new SafeFetchError("FETCH_REDIRECT_LOCATION_MISSING");
            if (redirects >= MAX_REDIRECTS) throw new SafeFetchError("FETCH_TOO_MANY_REDIRECTS");

            const nextUrl = new URL(location, currentUrl);
            if (new URL(currentUrl).protocol === "https:" && nextUrl.protocol === "http:") {
              throw new SafeFetchError("FETCH_HTTPS_DOWNGRADE");
            }
            redirects += 1;
            currentUrl = nextUrl.toString();
          } finally {
            await response.discard();
            await response.close?.();
          }
          continue;
        }

        if (
          (response.status < 200 || response.status >= 300) &&
          !options.acceptedStatuses?.includes(response.status)
        ) {
          await response.discard();
          await response.close?.();
          throw new SafeFetchError("FETCH_HTTP_STATUS");
        }

        const mime = mimeType(response.headers);
        if (!options.allowedMime.map((value) => value.toLowerCase()).includes(mime)) {
          await response.discard();
          await response.close?.();
          throw new SafeFetchError("FETCH_MIME_NOT_ALLOWED");
        }

        const contentLength = Number(header(response.headers, "content-length"));
        if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
          await response.discard();
          await response.close?.();
          throw new SafeFetchError("FETCH_BODY_TOO_LARGE");
        }

        try {
          const body = await readBoundedBody(response.body, options.maxBytes);
          return { url: currentUrl, status: response.status, mime, headers: response.headers, body };
        } catch (error) {
          await response.discard();
          throw error;
        } finally {
          await response.close?.();
        }
      }
    };

    try {
      return await Promise.race([operation(), timedOut]);
    } catch (error) {
      if (abortController.signal.aborted) throw timeoutError;
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

export const safeFetch = createSafeFetch({
  resolveTarget: resolvePublicTarget,
  transport: undiciTransport,
});
