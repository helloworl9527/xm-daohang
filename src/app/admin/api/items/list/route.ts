import { apiError, requireAdminApi } from "@/lib/auth/guard";
import { libraryQuerySchema, listLibraryItems } from "@/lib/items/list";

export const dynamic = "force-dynamic";

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
