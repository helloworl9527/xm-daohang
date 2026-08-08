import { z } from "zod";

import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { probeEmbeddingConfig, probeLlmConfig } from "@/lib/config/modelSettings";
import { logger } from "@/lib/log/logger";
import { getSafeHttpStatus } from "@/lib/log/upstreamError";

const modelSchema = z
  .object({
    kind: z.enum(["llm", "embedding"]),
    baseUrl: z.url().max(2_048),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().min(1).max(4_096).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const session = await requireAdminWrite(request);
  if (session instanceof Response) return session;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "配置格式无效。", 400);
  }
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "配置格式无效。", 400);

  try {
    const result =
      parsed.data.kind === "llm"
        ? await probeLlmConfig(parsed.data)
        : await probeEmbeddingConfig(parsed.data);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("model_probe_failed", {
      which: parsed.data.kind === "llm" ? "llm" : "emb",
      category: "upstream",
      httpStatus: getSafeHttpStatus(error),
    });
    return apiError("UPSTREAM", "模型连接测试失败。", 502, true);
  }
}
