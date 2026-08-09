import { z } from "zod";

import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import { getSettings, updateSettings } from "@/lib/config/settings";

export const dynamic = "force-dynamic";

const schema = z.object({ locale: z.enum(["zh", "en"]) }).strict();

export async function GET(request: Request): Promise<Response> {
  const session = await requireAdminApi(request);
  if (session instanceof Response) return session;
  return Response.json(
    { locale: (await getSettings()).defaultLocale },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request): Promise<Response> {
  const session = await requireAdminWrite(request);
  if (session instanceof Response) return session;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "语言配置无效。", 400);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "语言配置无效。", 400);
  await updateSettings({ defaultLocale: parsed.data.locale });
  return Response.json(
    { locale: parsed.data.locale },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `locale=${parsed.data.locale}; Path=/; Max-Age=31536000; SameSite=Lax`,
      },
    },
  );
}
