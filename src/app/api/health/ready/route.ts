import { NextResponse } from "next/server";
import { checkReadiness } from "@/lib/observability/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkReadiness();
  return NextResponse.json(result.payload, {
    status: result.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
