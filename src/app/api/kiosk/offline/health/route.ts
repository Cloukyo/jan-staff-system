import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/auth/supabase-admin";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import {
  offlineHealthContextSchema,
  offlineHealthReportSchema,
} from "@/lib/kiosk/offline/server-contract";

export const runtime = "nodejs";

function json(value: unknown, status: number) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

async function boundary() {
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken || !hasSupabaseAdminConfig()) return null;
  return { deviceToken, supabase: createSupabaseAdminClient() };
}

export async function GET() {
  const server = await boundary();
  if (!server) return json({ ok: false, code: "device_required" }, 401);
  const result = await server.supabase.rpc("get_kiosk_offline_health_context", {
    device_token: server.deviceToken,
  });
  const parsed = offlineHealthContextSchema.safeParse(result.data);
  if (result.error || !parsed.success) return json({ ok: false, code: "unavailable" }, 503);
  return json({ ok: true, health: parsed.data }, 200);
}

export async function POST(request: Request) {
  const server = await boundary();
  if (!server) return json({ ok: false, code: "device_required" }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  const parsed = offlineHealthReportSchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, code: "invalid_request" }, 400);
  const result = await server.supabase.rpc("report_kiosk_sync_health", {
    device_token: server.deviceToken,
    target_authorisation_id: parsed.data.authorisationId,
    pending_count: parsed.data.pendingCount,
    oldest_pending_action_at: parsed.data.oldestPendingActionAt,
    storage_persisted: parsed.data.storagePersisted,
    storage_estimate_bytes: parsed.data.storageEstimateBytes,
    client_app_version: parsed.data.appVersion,
  });
  if (result.error) return json({ ok: false, code: "unavailable" }, 503);
  return json({ ok: true }, 200);
}
