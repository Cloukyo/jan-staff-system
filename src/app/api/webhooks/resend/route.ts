import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { validateEnvironment } from "@/lib/config/environment";
import { ResendWebhookError, verifyAndMapResendWebhook } from "@/lib/notifications/resend-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const environment = validateEnvironment();
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret || !["staging", "production"].includes(environment.appEnvironment)) {
    return NextResponse.json({ ok: false }, { status: 404, headers: responseHeaders });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 262_144) {
    return NextResponse.json({ ok: false, code: "payload_too_large" }, { status: 413, headers: responseHeaders });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 262_144) {
    return NextResponse.json({ ok: false, code: "payload_too_large" }, { status: 413, headers: responseHeaders });
  }
  try {
    const mapped = verifyAndMapResendWebhook({
      rawBody,
      secret,
      headers: {
        id: request.headers.get("svix-id"),
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature"),
      },
    });
    if (mapped.outcome === "ignored") {
      return NextResponse.json({ ok: true, outcome: "ignored" }, { headers: responseHeaders });
    }
    const response = await createSupabaseAdminClient().rpc("record_notification_provider_event", {
      target_provider_event_reference: mapped.event.providerEventReference,
      target_provider_message_reference: mapped.event.providerMessageReference,
      target_event_type: mapped.event.eventType,
      target_event_occurred_at: mapped.event.eventOccurredAt,
      target_failure_code: mapped.event.failureCode,
    });
    if (response.error) {
      return NextResponse.json({ ok: false, code: "event_persistence_unavailable" }, { status: 503, headers: responseHeaders });
    }
    return NextResponse.json({ ok: true, outcome: response.data ?? "recorded" }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof ResendWebhookError) {
      return NextResponse.json({ ok: false, code: "invalid_webhook" }, { status: 400, headers: responseHeaders });
    }
    return NextResponse.json({ ok: false, code: "webhook_unavailable" }, { status: 503, headers: responseHeaders });
  }
}
