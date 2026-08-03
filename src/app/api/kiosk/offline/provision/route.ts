import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/auth/supabase-admin";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import {
  offlineProvisionDatabaseResponseSchema,
  offlineProvisionRequestSchema,
} from "@/lib/kiosk/offline/server-contract";

export const runtime = "nodejs";

function denialStatus(code: string): number {
  if (code === "invalid_request") return 400;
  if (["schema_incompatible", "reprovision_required"].includes(code)) return 409;
  if (code === "rate_limited") return 429;
  return 403;
}

export async function POST(request: Request) {
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) {
    return NextResponse.json({ ok: false, code: "device_required" }, { status: 401 });
  }
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ ok: false, code: "server_unavailable" }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 16_384) {
    return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
  }
  const parsed = offlineProvisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("provision_offline_kiosk", {
    device_token: deviceToken,
    client_schema_version: parsed.data.schemaVersion,
    client_app_version: parsed.data.appVersion,
    client_device_time: parsed.data.deviceTime,
    signing_public_jwk: parsed.data.signingPublicJwk,
  });
  if (error) {
    const rateLimited = /rate limit/i.test(error.message);
    console.warn("[staff-clock] offline provisioning failed", {
      category: rateLimited ? "rate_limited" : "database_unavailable",
    });
    return NextResponse.json(
      { ok: false, code: rateLimited ? "rate_limited" : "server_unavailable" },
      { status: rateLimited ? 429 : 503 },
    );
  }

  const response = offlineProvisionDatabaseResponseSchema.safeParse(data);
  if (!response.success) {
    console.error("[staff-clock] invalid offline provisioning response", { category: "invalid_contract" });
    return NextResponse.json({ ok: false, code: "server_unavailable" }, { status: 502 });
  }
  if (!response.data.ok) {
    return NextResponse.json(response.data, { status: denialStatus(response.data.code) });
  }
  return NextResponse.json(response.data, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
