import { z } from "zod";

import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { ProcessingRequestError } from "@/lib/items/processing";
import { manualRefetch } from "@/lib/items/refetch";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const parsedId = z.string().uuid().safeParse((await context.params).id);
  if (!parsedId.success) return apiError("VALIDATION", "条目编号无效。", 400);

  try {
    const result = await manualRefetch(parsedId.data);
    return Response.json({ status: "processing", ...result }, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ProcessingRequestError && error.code === "ITEM_NOT_FOUND") {
      return apiError("ITEM_NOT_FOUND", "条目不存在。", 404);
    }
    if (error instanceof ProcessingRequestError && error.code === "ITEM_ALREADY_PROCESSING") {
      return apiError("ITEM_ALREADY_PROCESSING", "条目正在处理，无需重复重抓。", 409);
    }
    if (error instanceof ProcessingRequestError && error.code === "MODEL_NOT_CONFIGURED") {
      return apiError("MODEL_UNAVAILABLE", "请先完成嵌入模型配置。", 409);
    }
    return apiError("INTERNAL_ERROR", "重抓失败，请稍后重试。", 500, true);
  }
}
