// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadSiteFavicon } = vi.hoisted(() => ({ loadSiteFavicon: vi.fn() }));
vi.mock("@/lib/favicon/siteFavicon", () => ({ loadSiteFavicon }));

import { GET } from "@/app/(public)/favicon/[id]/route";

const ID = "a4000000-0000-4000-8000-000000000001";

describe("favicon route", () => {
  beforeEach(() => loadSiteFavicon.mockReset());

  it("rejects non-UUID input with a local cacheable fallback", async () => {
    const response = await GET(new Request("https://app.example/favicon/not-a-uuid?url=https://internal/"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(loadSiteFavicon).not.toHaveBeenCalled();
  });

  it("returns eligible image bytes with seven-day public caching", async () => {
    loadSiteFavicon.mockResolvedValue({
      body: Uint8Array.of(1, 2, 3), mime: "image/webp", found: true, maxAge: 604_800,
    });
    const response = await GET(new Request(`https://app.example/favicon/${ID}?url=https://internal.example/&host=localhost`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(loadSiteFavicon).toHaveBeenCalledWith(ID);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3));
  });

  it("returns a one-hour local fallback for non-eligible items and fetch failures", async () => {
    loadSiteFavicon.mockResolvedValue({
      body: Uint8Array.of(9), mime: "image/png", found: false, maxAge: 3_600,
    });
    const response = await GET(new Request(`https://app.example/favicon/${ID}`), {
      params: Promise.resolve({ id: ID }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(await response.text()).not.toContain("http");
  });
});
