import { apiError } from "@/lib/auth/guard";
import { CategoryApplyError } from "@/lib/categories/apply";
import { CategoryProposeError } from "@/lib/categories/propose";
import { CategoryRunError } from "@/lib/categories/reclassify";
import { CategoryError } from "@/lib/categories/store";
import { ItemDetailError } from "@/lib/items/detail";

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

const messages: Record<string, string> = {
  VALIDATION: "请求内容无效。",
  DUPLICATE_CATEGORY: "分类名称已存在。",
  CATEGORY_NOT_FOUND: "分类不存在。",
  ITEM_NOT_FOUND: "条目不存在。",
  ITEM_CONFLICT: "条目已更新，请刷新后重试。",
  STALE_TAXONOMY: "分类已更新，请重新生成建议。",
  MANUAL_CATEGORY_CONFLICT: "此处有人工分类条目，请先迁移或在预览忽略该项。",
  RUN_NOT_FOUND: "分类变更记录不存在。",
  AI_UPSTREAM_FAILED: "AI 服务暂时不可用。",
  AI_OUTPUT_INVALID: "AI 返回内容无法安全应用。",
  PRECONDITION_REQUIRED: "请刷新条目后再编辑。",
  INTERNAL_ERROR: "分类操作失败。",
};

function response(code: string, status: number, retryable = false): Response {
  return apiError(code, messages[code] ?? messages.INTERNAL_ERROR!, status, retryable);
}

export function categoryApiError(error: unknown): Response {
  const code = error instanceof CategoryApplyError || error instanceof CategoryProposeError ||
    error instanceof CategoryRunError || error instanceof CategoryError || error instanceof ItemDetailError
    ? error.code
    : "INTERNAL_ERROR";
  if (code === "DUPLICATE_CATEGORY" || code === "ITEM_CONFLICT" || code === "STALE_TAXONOMY" ||
      code === "MANUAL_CATEGORY_CONFLICT") return response(code, 409);
  if (code === "CATEGORY_NOT_FOUND" || code === "ITEM_NOT_FOUND" || code === "RUN_NOT_FOUND") {
    return response(code, 404);
  }
  if (code === "ETAG_INVALID") return response("PRECONDITION_REQUIRED", 428);
  if (code === "AI_UPSTREAM_FAILED" || code === "AI_OUTPUT_INVALID") return response(code, 502, true);
  if (code === "VALIDATION") return response(code, 400);
  return response("INTERNAL_ERROR", 500, true);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
