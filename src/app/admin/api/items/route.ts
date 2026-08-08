import { z } from "zod";

import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { addItem, AddItemError } from "@/lib/items/add";

export const dynamic = "force-dynamic";

const addItemSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
}).strict();

export async function POST(request: Request): Promise<Response> {
  const session = await requireAdminWrite(request);
  if (session instanceof Response) return session;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "链接格式无效。", 400);
  }
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "链接格式无效。", 400);

  try {
    const result = await addItem(parsed.data.url);
    return Response.json(result, {
      status: result.deduped ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AddItemError && error.code === "MODEL_UNAVAILABLE") {
      return apiError("MODEL_UNAVAILABLE", "请先完成对话模型和嵌入模型配置。", 409);
    }
    if (error instanceof AddItemError && error.code === "URL_INVALID") {
      return apiError("URL_INVALID", "仅支持可公开访问的网页、文档或 GitHub 仓库。", 400);
    }
    return apiError("INTERNAL", "添加失败，请稍后重试。", 500, true);
  }
}
