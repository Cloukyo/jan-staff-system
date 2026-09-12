import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { validateEnvironment } from "@/lib/config/environment";
import { createResendEmailProvider } from "@/lib/notifications/resend-provider";
import { evaluateNotificationRoute } from "@/lib/notifications/route-policy";
import { processNotificationBatch } from "@/lib/notifications/worker";
import { createLogger } from "@/lib/observability/logging";
import { correlationId } from "@/lib/observability/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = correlationId(request.headers.get("x-request-id"));
  const responseHeaders = { "Cache-Control": "no-store", "x-request-id": requestId };
  const logger = createLogger("notification-worker", { correlationId: requestId });
  const environment = validateEnvironment();
  const decision = evaluateNotificationRoute({
    appEnvironment: environment.appEnvironment,
    authorization: request.headers.get("authorization"),
    workerSecret: process.env.CRON_SECRET?.trim() ?? null,
    deliveryEnabled: process.env.NOTIFICATION_DELIVERY_ENABLED === "true",
  });
  if (decision === "not_found") {
    return NextResponse.json({ ok: false }, { status: 404, headers: responseHeaders });
  }
  if (decision === "disabled") {
    return NextResponse.json({
      ok: true,
      delivery: "disabled",
      claimed: 0,
      accepted: 0,
      retryableFailures: 0,
      permanentFailures: 0,
    }, { headers: responseHeaders });
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim();
  const replyToAddress = process.env.RESEND_REPLY_TO_ADDRESS?.trim();
  const stagingRecipient = process.env.RESEND_STAGING_RECIPIENT?.trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!apiKey || !fromAddress || !siteUrl || (environment.appEnvironment === "staging" && !stagingRecipient)) {
    logger.error("notification worker is not configured", {
      code: "worker_not_configured",
      environment: environment.appEnvironment,
    });
    return NextResponse.json({ ok: false, code: "worker_not_configured" }, { status: 503, headers: responseHeaders });
  }
  try {
    const supabase = createSupabaseAdminClient();
    const result = await processNotificationBatch({
      appEnvironment: environment.appEnvironment,
      siteUrl,
      fromAddress,
      replyToAddress,
      stagingRecipient,
      provider: createResendEmailProvider({ apiKey }),
      async claimNext() {
        const response = await supabase.rpc("claim_next_notification_delivery");
        if (response.error) throw new Error("Notification claim failed.");
        const value = response.data as Record<string, unknown> | null;
        if (!value || value.outcome !== "claimed") return { outcome: "not_available" as const };
        return {
          outcome: "claimed" as const,
          outboxId: String(value.outboxId),
          messageType: value.messageType as "manager_invitation" | "staff_invitation" | "trial_ending" | "payment_failure",
          templateVersion: value.templateVersion as "manager_invitation_v1" | "staff_invitation_v1" | "trial_ending_v1" | "payment_failure_v1",
          recipientAddress: String(value.recipientAddress),
          invitationToken: typeof value.invitationToken === "string" ? value.invitationToken : undefined,
        };
      },
      async record(input) {
        const response = await supabase.rpc("record_notification_delivery", {
          outbox_id: input.outboxId,
          delivery_outcome: input.outcome,
          provider_reference: input.providerReference,
          failure_code: input.code,
        });
        if (response.error) throw new Error("Notification result could not be recorded.");
        return response.data;
      },
    }, 10);
    logger.info("notification batch completed", {
      environment: environment.appEnvironment,
      claimed: result.claimed,
      accepted: result.accepted,
      retryableFailures: result.retryableFailures,
      permanentFailures: result.permanentFailures,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: responseHeaders });
  } catch {
    logger.error("notification batch failed", {
      code: "worker_failed",
      environment: environment.appEnvironment,
    });
    return NextResponse.json({ ok: false, code: "worker_failed" }, { status: 503, headers: responseHeaders });
  }
}
