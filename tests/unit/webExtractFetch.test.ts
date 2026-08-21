// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const safeFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fetch/safeFetch", () => ({ safeFetch }));

import { fetchAndExtractContent } from "@/lib/fetch/webExtract";

describe("web content fetch", () => {
  beforeEach(() => {
    safeFetch.mockReset();
    safeFetch.mockResolvedValue({
      url: "https://example.com/readme.md",
      status: 200,
      mime: "text/markdown",
      headers: { "content-type": "text/markdown" },
      body: new TextEncoder().encode("# Example"),
    });
  });

  it("accepts Markdown and sends an identifiable user agent", async () => {
    await expect(fetchAndExtractContent("https://example.com/readme.md"))
      .resolves.toMatchObject({ type: "doc", content: "# Example" });

    expect(safeFetch).toHaveBeenCalledWith("https://example.com/readme.md", expect.objectContaining({
      allowedMime: expect.arrayContaining(["text/markdown"]),
      requestHeaders: expect.objectContaining({
        accept: expect.stringContaining("text/markdown"),
        "user-agent": expect.stringContaining("CollectionBot"),
      }),
    }));
  });
});
