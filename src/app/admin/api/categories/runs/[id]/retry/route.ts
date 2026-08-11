import { z } from "zod";

import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { categoryApiError, NO_STORE_HEADERS, readJson } from "@/lib/categories/adminApi";
import { requestCategoryRunRetry } from "@/lib/categories/reclassify";

const idSchema = z.string().uuid();
const retrySchema = z.object({ requestKey: z.string().uuid() }).strict();
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const runId = idSchema.safeParse((await context.params).id);
  const input = retrySchema.safeParse(await readJson(request));
  if (!runId.success || !input.success) return apiError("VALIDATION", "重试内容无效。", 400);
  try {
    return Response.json(await requestCategoryRunRetry(runId.data, input.data.requestKey), {
      status: 202,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return categoryApiError(error);
  }
}
