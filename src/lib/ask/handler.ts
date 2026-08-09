import { z } from "zod";

import { answerFromHits } from "@/lib/ai/answer";
import { apiError } from "@/lib/auth/guard";
import { getTrustedClientIp, UntrustedProxyError } from "@/lib/http/clientIp";
import {
  consumePublicAsk,
  getPublicAskReadiness,
  PublicAskUnavailableError,
} from "@/lib/ratelimit/publicAsk";
import { retrieve, type SearchHit } from "@/lib/search/retrieve";

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
}).strict();

interface AskDependencies {
  readiness?: () => Promise<void>;
  getClientIp?: (request: Request) => string | Promise<string>;
  consume?: (ip: string) => Promise<{ allowed: boolean }>;
  retrieve?: (question: string) => Promise<SearchHit[]>;
  answer?: (
    question: string,
    hits: readonly SearchHit[],
  ) => Promise<{ answer: string; citationIds: string[] }>;
}

export function createAskHandler(dependencies: AskDependencies = {}) {
  return async function askHandler(request: Request): Promise<Response> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^\s*application\/json\s*(?:;\s*charset\s*=\s*utf-8\s*)?$/i.test(contentType)) {
      return apiError("VALIDATION", "问题格式无效。", 415);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("VALIDATION", "问题格式无效。", 400);
    }
    const parsed = askSchema.safeParse(body);
    if (!parsed.success) return apiError("VALIDATION", "请输入 1 至 500 个字的问题。", 400);

    try {
      await (dependencies.readiness ?? getPublicAskReadiness)();
    } catch {
      return apiError("MODEL_UNAVAILABLE", "问答服务暂未就绪。", 503, true);
    }

    let ip: string;
    try {
      ip = await (dependencies.getClientIp ?? getTrustedClientIp)(request);
    } catch (error) {
      if (error instanceof UntrustedProxyError) {
        return apiError("UNTRUSTED_PROXY", "请求来源无法验证。", 403);
      }
      return apiError("UNTRUSTED_PROXY", "请求来源无法验证。", 403);
    }

    try {
      const limit = await (dependencies.consume ?? consumePublicAsk)(ip);
      if (!limit.allowed) {
        return apiError("RATE_LIMITED", "今日提问已达上限，请稍后再来。", 429);
      }
    } catch (error) {
      if (error instanceof PublicAskUnavailableError) {
        return apiError("MODEL_UNAVAILABLE", "问答服务暂未就绪。", 503, true);
      }
      return apiError("MODEL_UNAVAILABLE", "问答服务暂未就绪。", 503, true);
    }

    let hits: SearchHit[];
    try {
      hits = await (dependencies.retrieve ?? retrieve)(parsed.data.question);
    } catch {
      return apiError("UPSTREAM_ERROR", "检索暂时失败，请稍后重试。", 502, true);
    }
    if (hits.length === 0) {
      return Response.json(
        { answer: "收藏库中没有相关内容", sources: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const result = await (dependencies.answer ?? answerFromHits)(parsed.data.question, hits);
      const cited = new Set(result.citationIds);
      return Response.json(
        {
          answer: result.answer,
          sources: hits.map((hit) => ({
            id: hit.id,
            title: hit.title,
            summary: hit.summary,
            url: hit.url,
            tags: hit.tags,
            score: hit.score,
            cited: cited.has(hit.id),
          })),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return apiError("UPSTREAM_ERROR", "归纳暂时失败，请稍后重试。", 502, true);
    }
  };
}
