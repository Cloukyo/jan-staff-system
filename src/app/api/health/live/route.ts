import { NextResponse } from "next/server";
import { buildLiveness } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildLiveness(), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
