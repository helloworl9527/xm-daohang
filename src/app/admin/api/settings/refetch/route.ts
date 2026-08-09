import { z } from "zod";

import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import { getSettings, updateSettings } from "@/lib/config/settings";

export const dynamic = "force-dynamic";

const schema = z.object({
  enabled: z.boolean(),
  intervalDays: z.number().int().min(1).max(3_650),
}).strict();

function payload(settings: Awaited<ReturnType<typeof getSettings>>) {
  const nextRun = settings.refetchEnabled && settings.refetchLastRun
    ? new Date(settings.refetchLastRun.getTime() + settings.refetchIntervalDays * 86_400_000).toISOString()
    : null;
  return {
    enabled: settings.refetchEnabled,
    intervalDays: settings.refetchIntervalDays,
    lastRun: settings.refetchLastRun?.toISOString() ?? null,
    nextRun,
  };
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
    return apiError("VALIDATION", "定时重抓配置无效。", 400);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "定时重抓配置无效。", 400);
  const settings = await updateSettings({
    refetchEnabled: parsed.data.enabled,
    refetchIntervalDays: parsed.data.intervalDays,
  });
  return Response.json(payload(settings), { headers: { "Cache-Control": "no-store" } });
}
