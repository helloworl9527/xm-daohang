import { z } from "zod";

import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { categoryApiError, NO_STORE_HEADERS, readJson } from "@/lib/categories/adminApi";
import { proposeCategories } from "@/lib/categories/propose";

const schema = z.object({ mode: z.enum(["supplement", "full"]) }).strict();

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdminWrite(request);
  if (auth instanceof Response) return auth;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return apiError("VALIDATION", "建议模式无效。", 400);
  try {
    return Response.json(await proposeCategories(parsed.data), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return categoryApiError(error);
  }
}
