// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { BoundedResponse, SafeFetchOptions } from "@/lib/fetch/safeFetch";
import {
  fetchGitHubRepository,
  GitHubFetchError,
  parsePublicGitHubUrl,
} from "@/lib/fetch/github";
import { fingerprintContent } from "@/lib/fetch/fingerprint";

type Fetcher = (url: string, options: SafeFetchOptions) => Promise<BoundedResponse>;

function jsonResponse(status: number, value: unknown, headers: Record<string, string> = {}): BoundedResponse {
  return {
    url: "https://api.github.com/repos/acme/widgets",
    status,
    mime: "application/json",
    headers: { "content-type": "application/json", ...headers },
    body: new TextEncoder().encode(JSON.stringify(value)),
  };
}

describe("GitHub public repository fetcher", () => {
  it("parses only canonical public repository URLs", () => {
    expect(parsePublicGitHubUrl("https://github.com/acme/widgets.git")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
    expect(() => parsePublicGitHubUrl("https://git.example/acme/widgets")).toThrowError(
      "GITHUB_URL_INVALID",
    );
    expect(() => parsePublicGitHubUrl("https://github.com/acme/widgets/issues/1")).toThrowError(
      "GITHUB_URL_INVALID",
    );
  });

  it("combines README with allowlisted public repository metadata", async () => {
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse(200, {
        name: "widgets",
        full_name: "acme/widgets",
        private: false,
        description: "Useful widgets",
        topics: ["typescript", "tools"],
        language: "TypeScript",
        stargazers_count: 42,
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        encoding: "base64",
        content: Buffer.from("# Widgets\nPublic readme").toString("base64"),
      }));

    await expect(
      fetchGitHubRepository("https://github.com/acme/widgets", { fetcher }),
    ).resolves.toEqual({
      title: "acme/widgets",
      content: expect.stringContaining("Public readme"),
      metadata: {
        description: "Useful widgets",
        topics: ["typescript", "tools"],
        language: "TypeScript",
        stars: 42,
      },
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/acme/widgets",
      "https://api.github.com/repos/acme/widgets/readme",
    ]);
  });

  it("uses an optional PAT only for public API quota and still rejects private=true", async () => {
    const token = "ghp-MUST-NOT-LOG";
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      jsonResponse(200, { private: true, full_name: "acme/private", stargazers_count: 0 }),
    );

    await expect(
      fetchGitHubRepository("https://github.com/acme/private", { fetcher, token }),
    ).rejects.toMatchObject({ code: "GITHUB_PRIVATE_REPOSITORY" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].requestHeaders).toMatchObject({ authorization: `Bearer ${token}` });
    expect(JSON.stringify(await fetcher.mock.results[0].value)).not.toContain(token);
  });

  it.each([
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000060" }, 1_700_000_060_000],
    [429, { "retry-after": "30" }, 1_700_000_030_000],
  ] as const)("maps rate-limited HTTP %s to a retryAt derived from headers", async (
    status,
    headers,
    baseRetryAt,
  ) => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(jsonResponse(status, {}, headers));
    const error = await fetchGitHubRepository("https://github.com/acme/widgets", {
      fetcher,
      now: () => 1_700_000_000_000,
      random: () => 0.5,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubFetchError);
    expect(error).toMatchObject({ code: "GITHUB_RATE_LIMITED" });
    expect((error as GitHubFetchError).retryAt?.getTime()).toBeGreaterThanOrEqual(baseRetryAt);
    expect((error as GitHubFetchError).retryAt?.getTime()).toBeLessThanOrEqual(baseRetryAt + 6_000);
  });

  it("uses bounded exponential backoff for 429 and does not misclassify ordinary 403", async () => {
    const limited = vi.fn<Fetcher>().mockResolvedValue(jsonResponse(429, {}));
    const error = await fetchGitHubRepository("https://github.com/acme/widgets", {
      fetcher: limited,
      attempt: 8,
      now: () => 1_700_000_000_000,
      random: () => 1,
    }).catch((caught: unknown) => caught);
    expect((error as GitHubFetchError).retryAt?.getTime()).toBe(1_700_003_600_000);

    const forbidden = vi.fn<Fetcher>().mockResolvedValue(jsonResponse(403, {}));
    await expect(
      fetchGitHubRepository("https://github.com/acme/widgets", { fetcher: forbidden }),
    ).rejects.toMatchObject({ code: "GITHUB_HTTP_ERROR", retryAt: undefined });
  });
});

describe("content fingerprint", () => {
  it("is stable across harmless whitespace and changes with semantic content", () => {
    const first = fingerprintContent({ title: " A title ", content: "line one\n\nline two" });
    const same = fingerprintContent({ title: "A title", content: "line one line two" });
    const changed = fingerprintContent({ title: "A title", content: "line one line THREE" });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(same).toBe(first);
    expect(changed).not.toBe(first);
  });
});
