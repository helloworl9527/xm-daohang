import { z } from "zod";

import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import {
  deleteItem,
  getItemDetail,
  ItemDetailError,
  updateItemSummary,
} from "@/lib/items/detail";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const patchSchema = z.object({ summary: z.string().trim().min(1).max(10_000) }).strict();
const emptyBodySchema = z.object({}).strict();
type RouteContext = { params: Promise<{ id: string }> };

async function itemId(context: RouteContext): Promise<string | null> {
  const parsed = idSchema.safeParse((await context.params).id);
  return parsed.success ? parsed.data : null;
}

function detailError(error: unknown): Response {
  if (error instanceof ItemDetailError && error.code === "ITEM_NOT_FOUND") {
    return apiError("ITEM_NOT_FOUND", "条目不存在。", 404);
  }
  if (error instanceof ItemDetailError && error.code === "ITEM_CONFLICT") {
    return apiError("ITEM_CONFLICT", "条目已更新，请刷新后再编辑。", 409);
  }
  if (error instanceof ItemDetailError && error.code === "ETAG_INVALID") {
    return apiError("PRECONDITION_REQUIRED", "请刷新条目后再编辑。", 428);
  }
  return apiError("INTERNAL_ERROR", "条目操作失败。", 500, true);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminApi(request);
  if (auth instanceof Response) return auth;
  const id = await itemId(context);
  if (!id) return apiError("VALIDATION", "条目编号无效。", 400);
  try {
    const result = await getItemDetail(id);
    return Response.json({ item: result.item }, {
      headers: { "Cache-Control": "no-store", ETag: result.etag },
    });
  } catch (error) {
    return detailError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const id = await itemId(context);
  if (!id) return apiError("VALIDATION", "条目编号无效。", 400);
  const etag = request.headers.get("if-match");
  if (!etag) return apiError("PRECONDITION_REQUIRED", "请刷新条目后再编辑。", 428);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "总结内容无效。", 400);
  }
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "总结内容无效。", 400);

  try {
    const result = await updateItemSummary(id, parsed.data.summary, etag);
    return Response.json({ item: result.item }, {
      headers: { "Cache-Control": "no-store", ETag: result.etag },
    });
  } catch (error) {
    return detailError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const id = await itemId(context);
  if (!id) return apiError("VALIDATION", "条目编号无效。", 400);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "请求内容无效。", 400);
  }
  if (!emptyBodySchema.safeParse(input).success) {
    return apiError("VALIDATION", "请求内容无效。", 400);
  }
  try {
    await deleteItem(id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return detailError(error);
  }
}
