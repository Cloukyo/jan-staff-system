import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/auth/supabase-admin";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import {
  canonicalOfflinePayload,
  importSigningPublicKey,
  verifyOfflinePayload,
} from "@/lib/kiosk/offline/crypto";
import {
  offlineSyncContextSchema,
  offlineSyncRequestSchema,
  offlineSyncResponseSchema,
  payloadForOfflineSignature,
} from "@/lib/kiosk/offline/server-contract";

export const runtime = "nodejs";

function json(value: unknown, status: number) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) return json({ outcome: "device_revoked" }, 401);
  if (!hasSupabaseAdminConfig()) return json({ outcome: "retryable_failure" }, 503);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 32_768) return json({ outcome: "permanently_invalid" }, 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ outcome: "permanently_invalid" }, 400);
  }
  const parsed = offlineSyncRequestSchema.safeParse(body);
  if (!parsed.success) return json({ outcome: "schema_incompatible" }, 400);

  const supabase = createSupabaseAdminClient();
  const contextResult = await supabase.rpc("get_offline_kiosk_sync_context", {
    device_token: deviceToken,
    target_authorisation_id: parsed.data.authorisationId,
  });
  const context = offlineSyncContextSchema.safeParse(contextResult.data);
  if (contextResult.error || !context.success) {
    console.warn("[staff-clock] offline sync context rejected", { category: "device_or_authorisation" });
    return json({ outcome: "device_revoked" }, 403);
  }

  const payload = payloadForOfflineSignature(parsed.data);
  let signatureVerified = false;
  try {
    const publicKey = await importSigningPublicKey(context.data.signingPublicJwk);
    signatureVerified = context.data.deviceId === parsed.data.deviceId
      && await verifyOfflinePayload(payload, parsed.data.signature, publicKey);
  } catch {
    signatureVerified = false;
  }

  if (!signatureVerified) {
    await supabase.rpc("check_kiosk_offline_rate_limit", {
      candidate_token: deviceToken,
      requested_operation: "invalid_signature",
      maximum_attempts: 10,
      window_seconds: 900,
    });
  }

  const payloadDigest = createHash("sha256")
    .update(canonicalOfflinePayload(payload))
    .digest("hex");
  const result = await supabase.rpc("perform_offline_kiosk_attendance_action", {
    device_token: deviceToken,
    target_authorisation_id: parsed.data.authorisationId,
    target_staff_id: parsed.data.staffId,
    requested_action: parsed.data.action,
    expected_revision: parsed.data.trustedSnapshotRevision,
    idempotency_key: parsed.data.idempotencyKey,
    device_sequence: parsed.data.deviceSequence,
    occurred_at_device: parsed.data.occurredAtDevice,
    device_timezone: parsed.data.deviceTimezone,
    operational_date_at_device: parsed.data.operationalDateAtDevice,
    queue_created_at: parsed.data.queueCreatedAt,
    roster_version: parsed.data.rosterVersion,
    prior_pending_action_id: parsed.data.priorPendingActionId,
    clock_confidence: parsed.data.clockConfidence,
    elapsed_since_authorisation_ms: parsed.data.elapsedSinceAuthorisationMs,
    payload_digest: payloadDigest,
    signature_verified: signatureVerified,
  });
  if (result.error) {
    console.warn("[staff-clock] offline sync failed", { category: "database_unavailable" });
    return json({ outcome: "retryable_failure" }, 503);
  }
  const response = offlineSyncResponseSchema.safeParse(result.data);
  if (!response.success) {
    console.error("[staff-clock] invalid offline sync response", { category: "invalid_contract" });
    return json({ outcome: "retryable_failure" }, 502);
  }
  return json(response.data, 200);
}
