import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "live" },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
