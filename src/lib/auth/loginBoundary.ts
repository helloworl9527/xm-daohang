import { getTrustedClientIpFromHeaders } from "@/lib/http/clientIp";

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
  try {
    return getTrustedClientIpFromHeaders(headerStore);
  } catch {
    return null;
  }
}
