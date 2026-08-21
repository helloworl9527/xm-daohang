import ipaddr from "ipaddr.js";

import { getTrustedClientIpFromHeaders } from "@/lib/http/clientIp";

export function getLoginClientIp(headerStore: Headers): string | null {
  try {
    return getTrustedClientIpFromHeaders(headerStore);
  } catch {
    // The app is internal-only and Caddy strips and rewrites both fallback headers.
    for (const header of ["x-real-ip", "x-forwarded-for"]) {
      const rawIp = headerStore.get(header);
      if (!rawIp || rawIp.includes(",") || rawIp !== rawIp.trim()) continue;
      try {
        return ipaddr.process(rawIp).toString();
      } catch {
        continue;
      }
    }
    return null;
  }
}
