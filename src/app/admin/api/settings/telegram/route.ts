import { z } from "zod";

import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import { getSettings, updateSettings } from "@/lib/config/settings";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().trim().min(1).max(4_096).optional(),
  allowedIds: z.array(z.number().int().positive().safe()).max(100)
    .refine((ids) => new Set(ids).size === ids.length),
}).strict();

function payload(settings: Awaited<ReturnType<typeof getSettings>>) {
  return { tokenMasked: settings.telegramTokenMasked, allowedIds: settings.telegramAllowedIds };
}

export async function GET(request: Request): Promise<Response> {
  const session = await requireAdminApi(request);
  if (session instanceof Response) return session;
  return Response.json(payload(await getSettings()), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request): Promise<Response> {
  const session = await requireAdminWrite(request);
  if (session instanceof Response) return session;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "Telegram 配置无效。", 400);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "Telegram 配置无效。", 400);
  const settings = await updateSettings({
    ...(parsed.data.token ? { telegramToken: parsed.data.token } : {}),
    telegramAllowedIds: parsed.data.allowedIds,
  });
  return Response.json(payload(settings), { headers: { "Cache-Control": "no-store" } });
}
