import { z } from "zod";

import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import { saveEmbeddingConfig, saveLlmConfig } from "@/lib/config/modelSettings";
import { getSettings } from "@/lib/config/settings";
import { logger } from "@/lib/log/logger";

export const dynamic = "force-dynamic";

const modelSchema = z
  .object({
    kind: z.enum(["llm", "embedding"]),
    baseUrl: z.url().max(2_048),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().min(1).max(4_096).optional(),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  const session = await requireAdminApi(request);
  if (session instanceof Response) return session;
  return Response.json(await getSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request): Promise<Response> {
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
    const settings =
      parsed.data.kind === "llm"
        ? await saveLlmConfig(parsed.data)
        : await saveEmbeddingConfig(parsed.data);
    return Response.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("model_settings_save", { error });
    return apiError("UPSTREAM", "模型连接测试失败，原配置未更改。", 502, true);
  }
}
