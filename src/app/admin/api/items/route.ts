import { z } from "zod";

import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import { addItem, AddItemError } from "@/lib/items/add";
import { libraryQuerySchema, listLibraryItems } from "@/lib/items/list";

export const dynamic = "force-dynamic";

const addItemSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
}).strict();

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdminApi(request);
  if (auth instanceof Response) return auth;

  const search = new URL(request.url).searchParams;
  const parsed = libraryQuerySchema.safeParse({
    q: search.get("q") ?? undefined,
    tags: search.getAll("tag"),
    status: search.get("status") ?? undefined,
    cursor: search.get("cursor") ?? undefined,
    limit: search.get("limit") ?? undefined,
  });
  if (!parsed.success) return apiError("VALIDATION", "筛选条件无效。", 400);

  try {
    const payload = await listLibraryItems(parsed.data);
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CURSOR") {
      return apiError("VALIDATION", "分页位置无效。", 400);
    }
    return apiError("INTERNAL_ERROR", "收藏库暂时无法读取。", 500, true);
  }
}

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
