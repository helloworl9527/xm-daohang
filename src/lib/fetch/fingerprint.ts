import { createHash } from "node:crypto";

export interface FingerprintInput {
  title?: string | null;
  content: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function fingerprintContent(input: FingerprintInput): string {
  const canonical = JSON.stringify({
    title: normalize(input.title ?? ""),
    content: normalize(input.content),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
