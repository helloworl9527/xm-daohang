import { z } from "zod";

import { pool } from "@/db/client";
import { apiError, requireAdminWrite } from "@/lib/auth/guard";
import { hashPassword, validatePassword, verifyPassword } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
}).strict();

export async function PUT(request: Request): Promise<Response> {
  const session = await requireAdminWrite(request);
  if (session instanceof Response) return session;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError("VALIDATION", "密码格式无效。", 400);
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return apiError("VALIDATION", "密码格式无效。", 400);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ username: string; password_hash: string }>(
      "select username, password_hash from admin_user where id = 1 for update",
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(user.password_hash, parsed.data.currentPassword))) {
      await client.query("rollback");
      return apiError("CURRENT_PASSWORD_INVALID", "当前密码不正确。", 403);
    }
    if (!validatePassword(user.username, parsed.data.newPassword).valid) {
      await client.query("rollback");
      return apiError("PASSWORD_WEAK", "新密码需为 12 至 128 个字符，且不能与用户名相同。", 400);
    }
    const passwordHash = await hashPassword(parsed.data.newPassword);
    await client.query("update admin_user set password_hash = $1 where id = 1", [passwordHash]);
    await client.query("delete from sessions");
    await client.query("commit");
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": "admin_session=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      },
    });
  } catch {
    await client.query("rollback").catch(() => undefined);
    return apiError("INTERNAL", "密码暂时无法更新。", 500, true);
  } finally {
    client.release();
  }
}
