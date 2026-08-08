import { lookup as nodeLookup } from "node:dns/promises";

import ipaddr from "ipaddr.js";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export class UrlGuardError extends Error {
  constructor(public readonly code: string, options?: ErrorOptions) {
    super(code, options);
    this.name = "UrlGuardError";
  }
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new UrlGuardError("URL_INVALID", { cause });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlGuardError("URL_PROTOCOL_NOT_ALLOWED");
  }
  if (url.username || url.password) {
    throw new UrlGuardError("URL_CREDENTIALS_NOT_ALLOWED");
  }
  if (!url.hostname) throw new UrlGuardError("URL_HOST_REQUIRED");
  return url;
}

export function canonicalizeUrl(raw: string): string {
  const url = parseHttpUrl(raw.trim());
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

function normalizedIpLiteral(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  return parsed.range() === "unicast";
}

const defaultLookup: DnsLookup = async (hostname) => {
  const records = await nodeLookup(hostname, { all: true, verbatim: true });
  return records
    .filter((record): record is { address: string; family: 4 | 6 } => record.family === 4 || record.family === 6)
    .map(({ address, family }) => ({ address, family }));
};

export async function resolvePublicTarget(
  raw: string,
  lookup: DnsLookup = defaultLookup,
): Promise<{ url: string; addresses: ResolvedAddress[] }> {
  const url = parseHttpUrl(raw);
  const hostname = normalizedIpLiteral(url.hostname);
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 as const : 6 as const }]
    : await lookup(hostname);

  if (addresses.length === 0) throw new UrlGuardError("URL_DNS_EMPTY");
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new UrlGuardError("URL_BLOCKED_ADDRESS");
  }

  return { url: canonicalizeUrl(url.toString()), addresses };
}
