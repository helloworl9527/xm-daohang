import { z } from "zod";

import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import { categoryApiError, NO_STORE_HEADERS, readJson } from "@/lib/categories/adminApi";
import { getLatestCategoryRun } from "@/lib/categories/reclassify";
import { createCategory, getCategoryOverview } from "@/lib/categories/store";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  sort: z.number().int().nonnegative().optional(),
}).strict();

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdminApi(request);
  if (auth instanceof Response) return auth;
  try {
    const [overview, latestRun] = await Promise.all([getCategoryOverview(), getLatestCategoryRun()]);
    return Response.json({ overview, latestRun }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return categoryApiError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION", "分类内容无效。", 400);
  try {
    const category = await createCategory(parsed.data);
    return Response.json({ category }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    return categoryApiError(error);
  }
}
