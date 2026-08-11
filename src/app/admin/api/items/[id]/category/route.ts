import { z } from "zod";

import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { categoryApiError, NO_STORE_HEADERS, readJson } from "@/lib/categories/adminApi";
import { updateItemCategory } from "@/lib/items/detail";

const idSchema = z.string().uuid();
const schema = z.object({ categoryId: z.string().uuid().nullable() }).strict();
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const itemId = idSchema.safeParse((await context.params).id);
  if (!itemId.success) return apiError("VALIDATION", "条目编号无效。", 400);
  const etag = request.headers.get("if-match");
  if (!etag) return apiError("PRECONDITION_REQUIRED", "请刷新条目后再编辑。", 428);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION", "分类选择无效。", 400);
  try {
    const result = await updateItemCategory(itemId.data, parsed.data.categoryId, etag);
    return Response.json({ item: result.item }, {
      headers: { ...NO_STORE_HEADERS, ETag: result.etag },
    });
  } catch (error) {
    return categoryApiError(error);
  }
}
