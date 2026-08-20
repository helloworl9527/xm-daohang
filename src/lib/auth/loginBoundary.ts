import ipaddr from "ipaddr.js";

function hasValidFormBoundary(headerStore: Headers): boolean {
  const host = headerStore.get("host");
  const origin = headerStore.get("origin");
  const contentType = headerStore.get("content-type") ?? "";
  if (!host || !origin) return false;
  try {
    if (new URL(origin).host !== host) return false;
  } catch {
    return false;
  }
  return (
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("multipart/form-data")
  );
}

export function getLoginClientIp(headerStore: Headers): string | null {
  if (!hasValidFormBoundary(headerStore)) return null;

  // Caddy strips client-supplied X-Real-IP and injects the single remote address.
  const rawIp = headerStore.get("x-real-ip");
  if (!rawIp || rawIp.includes(",") || rawIp !== rawIp.trim()) return null;
  try {
    return ipaddr.process(rawIp).toString();
  } catch {
    return null;
  }
}
