import { z } from "zod";

import { pool } from "@/db/client";
import { apiError, requireAdminApi, requireAdminWrite } from "@/lib/auth/guard";
import { getSettings, updateSettings } from "@/lib/config/settings";
import { businessDay } from "@/lib/time/businessDay";

export const dynamic = "force-dynamic";

const schema = z.object({
  enabled: z.boolean(),
  ipDaily: z.number().int().min(1).max(10_000),
  globalDaily: z.number().int().min(1).max(1_000_000),
}).strict();

async function payload(settings: Awaited<ReturnType<typeof getSettings>>) {
  const day = businessDay();
  const result = await pool.query<{ count: number }>(
    "select count from ask_counters where day = $1 and scope = 'global'",
    [day],
  );
  return {
    enabled: settings.ratelimitEnabled,
    ipDaily: settings.ratelimitIpDaily,
    globalDaily: settings.ratelimitGlobalDaily,
    day,
    usedGlobal: result.rows[0]?.count ?? 0,
  };
}

export async function GET(request: Request): Promise<Response> {
  const session = await requireAdminApi(request);
  if (session instanceof Response) return session;
  return Response.json(await payload(await getSettings()), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request): Promise<Response> {
  const session = await requireAdminWrite(request);
  if (session instanceof Response) return session;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "公开限流配置无效。", 400);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "公开限流配置无效。", 400);
  const settings = await updateSettings({
    ratelimitEnabled: parsed.data.enabled,
    ratelimitIpDaily: parsed.data.ipDaily,
    ratelimitGlobalDaily: parsed.data.globalDaily,
  });
  return Response.json(await payload(settings), { headers: { "Cache-Control": "no-store" } });
}
