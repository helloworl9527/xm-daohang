import { timingSafeEqual } from "node:crypto";

import ipaddr from "ipaddr.js";

export class UntrustedProxyError extends Error {
  readonly code = "UNTRUSTED_PROXY";

  constructor() {
    super("UNTRUSTED_PROXY");
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function getTrustedClientIp(request: Request): string {
  const expected = process.env.PROXY_SHARED_SECRET;
  if (!expected || Buffer.byteLength(expected) < 32) throw new UntrustedProxyError();

  const supplied = request.headers.get("x-proxy-auth");
  if (!supplied || !constantTimeEqual(expected, supplied)) throw new UntrustedProxyError();

  const rawIp = request.headers.get("x-real-client-ip");
  if (!rawIp || rawIp.includes(",") || rawIp !== rawIp.trim()) throw new UntrustedProxyError();
  try {
    return ipaddr.process(rawIp).toString();
  } catch {
    throw new UntrustedProxyError();
  }
}
