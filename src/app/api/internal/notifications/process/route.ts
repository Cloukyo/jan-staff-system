import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { validateEnvironment } from "@/lib/config/environment";
import { createResendEmailProvider } from "@/lib/notifications/resend-provider";
import { processNotificationBatch } from "@/lib/notifications/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: Request, expected: string): boolean {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const environment = validateEnvironment();
  const workerSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (environment.appEnvironment !== "staging" || process.env.NOTIFICATION_DELIVERY_ENABLED !== "true" || !workerSecret || !authorised(request, workerSecret)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim();
  const stagingRecipient = process.env.RESEND_STAGING_RECIPIENT?.trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!apiKey || !fromAddress || !stagingRecipient || !siteUrl) return NextResponse.json({ ok: false }, { status: 503 });
  const supabase = createSupabaseAdminClient();
  const result = await processNotificationBatch({
    appEnvironment: environment.appEnvironment,
    siteUrl,
    fromAddress,
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
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
