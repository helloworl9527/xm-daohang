import { z } from "zod";
import { apiError } from "@/lib/auth/guard";
import { getTrustedClientIp } from "@/lib/http/clientIp";
import { searchPublicCorpus, type SiteCard } from "@/lib/items/publicCorpus";
import { consumePublicKeyword, type PublicKeywordLimitResult } from "@/lib/ratelimit/publicKeyword";
import { logger } from "@/lib/log/logger";

export class KeywordSearchError extends Error {
  readonly code = "SEARCH_UNAVAILABLE";
}

export async function keywordSearch(query: string): Promise<SiteCard[]> {
  try { return await searchPublicCorpus(query); } catch { throw new KeywordSearchError(); }
}

const normalizedQuerySchema = z.string().transform((value) => value.normalize("NFKC").trim()).pipe(
  z.string().min(1).max(100).refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)),
);
const querySchema = z.object({ query: normalizedQuerySchema }).strict();

export interface KeywordRouteDependencies {
  getClientIp?: (request: Request) => string;
  consume?: (ip: string) => Promise<PublicKeywordLimitResult>;
  search?: (query: string) => Promise<SiteCard[]>;
}

export function createKeywordHandler(dependencies: KeywordRouteDependencies = {}) {
  return async function handle(request: Request): Promise<Response> {
    const startedAt = performance.now();
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^\s*application\/json\s*(?:;\s*charset\s*=\s*utf-8\s*)?$/i.test(contentType)) return apiError("QUERY_INVALID", "关键词无效。", 400);
    let body: unknown;
    try { body = await request.json(); } catch { return apiError("QUERY_INVALID", "关键词无效。", 400); }
    const parsed = querySchema.safeParse(body);
    if (!parsed.success) return apiError("QUERY_INVALID", "请输入至少 2 个字符的关键词。", 400);
    let ip: string;
    try { ip = (dependencies.getClientIp ?? getTrustedClientIp)(request); }
    catch { return apiError("SEARCH_UNAVAILABLE", "搜索暂时不可用。", 503, true); }
    try {
      const limit = await (dependencies.consume ?? consumePublicKeyword)(ip);
      if (!limit.allowed) {
        logger.info("keyword_search_limited", { outcome: limit.reason, count: 0, ms: Math.round(performance.now() - startedAt) });
        return apiError("RATE_LIMITED", "搜索请求过于频繁，请稍后再试。", 429);
      }
      const matches = await (dependencies.search ?? keywordSearch)(parsed.data.query);
      logger.info("keyword_search_completed", { outcome: "completed", count: matches.length, ms: Math.round(performance.now() - startedAt) });
      return Response.json({ query: parsed.data.query, matches }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return apiError("SEARCH_UNAVAILABLE", "搜索暂时不可用。", 503, true);
    }
  };
}
