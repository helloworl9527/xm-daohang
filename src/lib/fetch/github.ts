import { z } from "zod";

import { safeFetch, type BoundedResponse, type SafeFetchOptions } from "@/lib/fetch/safeFetch";

const API_ORIGIN = "https://api.github.com";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_BACKOFF_MS = 60 * 60 * 1_000;

type Fetcher = (url: string, options: SafeFetchOptions) => Promise<BoundedResponse>;

const repositorySchema = z.object({
  full_name: z.string().min(1),
  private: z.boolean(),
  description: z.string().nullable().optional(),
  topics: z.array(z.string()).default([]),
  language: z.string().nullable().optional(),
  stargazers_count: z.number().int().nonnegative(),
});

const readmeSchema = z.object({
  encoding: z.literal("base64"),
  content: z.string(),
});

export interface GitHubRepositoryContent {
  title: string;
  content: string;
  metadata: {
    description: string | null;
    topics: string[];
    language: string | null;
    stars: number;
  };
}

export interface GitHubFetchDependencies {
  fetcher?: Fetcher;
  token?: string;
  attempt?: number;
  now?: () => number;
  random?: () => number;
}

export class GitHubFetchError extends Error {
  constructor(public readonly code: string, public readonly retryAt?: Date) {
    super(code);
    this.name = "GitHubFetchError";
  }
}

export function parsePublicGitHubUrl(rawUrl: string): { owner: string; repo: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new GitHubFetchError("GITHUB_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new GitHubFetchError("GITHUB_URL_INVALID");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new GitHubFetchError("GITHUB_URL_INVALID");
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw new GitHubFetchError("GITHUB_URL_INVALID");
  }
  return { owner, repo };
}

function parseJson(response: BoundedResponse): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
  } catch {
    throw new GitHubFetchError("GITHUB_INVALID_RESPONSE");
  }
}

function header(response: BoundedResponse, name: string): string | undefined {
  return response.headers[name.toLowerCase()];
}

function rateLimitRetryAt(
  response: BoundedResponse,
  dependencies: Required<Pick<GitHubFetchDependencies, "attempt" | "now" | "random">>,
): Date | undefined {
  const remaining = header(response, "x-ratelimit-remaining");
  const isLimited = response.status === 429 || (response.status === 403 && remaining === "0");
  if (!isLimited) return undefined;

  const now = dependencies.now();
  const retryAfterSeconds = Number(header(response, "retry-after"));
  const resetSeconds = Number(header(response, "x-ratelimit-reset"));
  let baseTime: number;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    baseTime = now + retryAfterSeconds * 1_000;
  } else if (Number.isFinite(resetSeconds) && resetSeconds * 1_000 >= now) {
    baseTime = resetSeconds * 1_000;
  } else {
    const exponent = Math.max(0, Math.min(16, dependencies.attempt));
    baseTime = now + Math.min(MAX_BACKOFF_MS, 60_000 * (2 ** exponent));
  }
  const jitterWindow = Math.min(6_000, Math.max(0, baseTime - now) * 0.1);
  return new Date(Math.min(now + MAX_BACKOFF_MS, baseTime + dependencies.random() * jitterWindow));
}

async function requestGitHub(
  path: string,
  dependencies: GitHubFetchDependencies,
): Promise<BoundedResponse> {
  const token = dependencies.token ?? process.env.GITHUB_PUBLIC_API_TOKEN;
  const requestHeaders: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "collection-system",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const response = await (dependencies.fetcher ?? safeFetch)(`${API_ORIGIN}${path}`, {
    maxBytes: MAX_BYTES,
    timeoutMs: 15_000,
    allowedMime: ["application/json"],
    acceptedStatuses: [403, 404, 429],
    requestHeaders,
  });
  const retryAt = rateLimitRetryAt(response, {
    attempt: dependencies.attempt ?? 0,
    now: dependencies.now ?? Date.now,
    random: dependencies.random ?? Math.random,
  });
  if (retryAt) throw new GitHubFetchError("GITHUB_RATE_LIMITED", retryAt);
  if (response.status !== 200) throw new GitHubFetchError("GITHUB_HTTP_ERROR");
  return response;
}

export async function fetchGitHubRepository(
  rawUrl: string,
  dependencies: GitHubFetchDependencies = {},
): Promise<GitHubRepositoryContent> {
  const { owner, repo } = parsePublicGitHubUrl(rawUrl);
  const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const repository = repositorySchema.safeParse(parseJson(await requestGitHub(basePath, dependencies)));
  if (!repository.success) throw new GitHubFetchError("GITHUB_INVALID_RESPONSE");
  if (repository.data.private) throw new GitHubFetchError("GITHUB_PRIVATE_REPOSITORY");

  const readme = readmeSchema.safeParse(parseJson(await requestGitHub(`${basePath}/readme`, dependencies)));
  if (!readme.success) throw new GitHubFetchError("GITHUB_INVALID_RESPONSE");
  let readmeText: string;
  try {
    readmeText = Buffer.from(readme.data.content.replace(/\s/g, ""), "base64").toString("utf8").trim();
  } catch {
    throw new GitHubFetchError("GITHUB_INVALID_RESPONSE");
  }

  const metadata = {
    description: repository.data.description ?? null,
    topics: repository.data.topics,
    language: repository.data.language ?? null,
    stars: repository.data.stargazers_count,
  };
  const content = [
    metadata.description ? `Description: ${metadata.description}` : "",
    metadata.topics.length > 0 ? `Topics: ${metadata.topics.join(", ")}` : "",
    metadata.language ? `Language: ${metadata.language}` : "",
    `Stars: ${metadata.stars}`,
    readmeText,
  ].filter(Boolean).join("\n\n");
  return { title: repository.data.full_name, content, metadata };
}
