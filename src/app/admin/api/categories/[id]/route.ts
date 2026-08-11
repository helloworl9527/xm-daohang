import { z } from "zod";

import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { categoryApiError, NO_STORE_HEADERS, readJson } from "@/lib/categories/adminApi";
import { deleteCategory, renameCategory } from "@/lib/categories/store";

const idSchema = z.string().uuid();
const patchSchema = z.object({ name: z.string().min(1).max(200) }).strict();
const deleteSchema = z.object({}).strict();
type Context = { params: Promise<{ id: string }> };

async function id(context: Context): Promise<string | null> {
  const parsed = idSchema.safeParse((await context.params).id);
  return parsed.success ? parsed.data : null;
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const categoryId = await id(context);
  if (!categoryId) return apiError("VALIDATION", "分类编号无效。", 400);
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION", "分类内容无效。", 400);
  try {
    return Response.json({ category: await renameCategory(categoryId, parsed.data.name) }, {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return categoryApiError(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const categoryId = await id(context);
  if (!categoryId) return apiError("VALIDATION", "分类编号无效。", 400);
  if (!deleteSchema.safeParse(await readJson(request)).success) {
    return apiError("VALIDATION", "请求内容无效。", 400);
  }
  try {
    return Response.json(await deleteCategory(categoryId), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return categoryApiError(error);
  }
}
