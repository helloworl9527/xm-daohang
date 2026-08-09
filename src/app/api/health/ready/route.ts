import { NextResponse } from "next/server";

import { pool } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query<{ migration_count: string }>(
      "select count(*)::text as migration_count from drizzle.__drizzle_migrations",
    );
    if (Number(result.rows[0]?.migration_count) < 3) throw new Error("MIGRATIONS_NOT_APPLIED");
    return NextResponse.json(
      { status: "ready" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
