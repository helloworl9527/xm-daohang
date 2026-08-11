import { z } from "zod";

import { apiError, requireAdminApi } from "@/lib/auth/guard";
import { categoryApiError, NO_STORE_HEADERS } from "@/lib/categories/adminApi";
import { getCategoryRun } from "@/lib/categories/reclassify";

const idSchema = z.string().uuid();
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const auth = await requireAdminApi(request);
  if (auth instanceof Response) return auth;
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) return apiError("VALIDATION", "记录编号无效。", 400);
  try {
    return Response.json({ run: await getCategoryRun(parsed.data) }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return categoryApiError(error);
  }
}
