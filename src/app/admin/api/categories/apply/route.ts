import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { applyCategoriesInputSchema, applyCategoryDiff } from "@/lib/categories/apply";
import { categoryApiError, NO_STORE_HEADERS, readJson } from "@/lib/categories/adminApi";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const parsed = applyCategoriesInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION", "应用内容无效。", 400);
  try {
    const run = await applyCategoryDiff(parsed.data);
    return Response.json({
      runId: run.id,
      status: run.status,
      counts: run.counts,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return categoryApiError(error);
  }
}
