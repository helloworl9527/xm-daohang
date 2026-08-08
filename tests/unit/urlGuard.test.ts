import { describe, expect, it } from "vitest";

import {
  canonicalizeUrl,
  resolvePublicTarget,
  UrlGuardError,
  type DnsLookup,
} from "@/lib/fetch/urlGuard";

const lookup = (addresses: Array<{ address: string; family: 4 | 6 }>): DnsLookup =>
  async () => addresses;

describe("canonicalizeUrl", () => {
  it("normalizes protocol, host, port, fragment, and query order", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM:443/docs/?z=2&a=1#section")).toBe(
      "https://example.com/docs/?a=1&z=2",
    );
  });

  it("rejects credentials and non-http protocols", () => {
    expect(() => canonicalizeUrl("https://user:pass@example.com")).toThrowError(UrlGuardError);
    expect(() => canonicalizeUrl("file:///etc/passwd")).toThrowError(UrlGuardError);
  });
});

describe("resolvePublicTarget", () => {
  it.each([
    "http://127.0.0.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://017700000001",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0",
    "http://10.0.0.1",
    "http://100.64.0.1",
    "http://172.16.0.1",
    "http://192.168.0.1",
    "http://192.0.2.1",
    "http://224.0.0.1",
    "http://240.0.0.1",
    "http://[::]",
    "http://[::1]",
    "http://[fe80::1]",
    "http://[fd00::1]",
    "http://[ff02::1]",
    "http://[::ffff:127.0.0.1]",
  ])("rejects private, local, metadata, and encoded target %s", async (url) => {
    await expect(resolvePublicTarget(url)).rejects.toMatchObject({ code: "URL_BLOCKED_ADDRESS" });
  });

  it("accepts a hostname only when every resolved address is public", async () => {
    await expect(
      resolvePublicTarget(
        "https://public.example/path",
        lookup([
          { address: "93.184.216.34", family: 4 },
          { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        ]),
      ),
    ).resolves.toEqual({
      url: "https://public.example/path",
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ],
    });

    await expect(
      resolvePublicTarget(
        "https://mixed.example",
        lookup([
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.8", family: 4 },
        ]),
      ),
    ).rejects.toMatchObject({ code: "URL_BLOCKED_ADDRESS" });
  });

  it("fails closed when DNS returns no address", async () => {
    await expect(resolvePublicTarget("https://empty.example", lookup([]))).rejects.toMatchObject({
      code: "URL_DNS_EMPTY",
    });
  });
});
