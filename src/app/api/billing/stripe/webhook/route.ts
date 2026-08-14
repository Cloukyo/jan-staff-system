import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { loadBillingConfiguration } from "@/lib/billing/config";
import { createStripeProvider } from "@/lib/billing/stripe-provider";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const configuration = loadBillingConfiguration();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  let event;
  try { event = createStripeProvider(configuration.secretKey).verifyWebhook(await request.text(), signature, configuration.webhookSecret); }
  catch { return NextResponse.json({ error: "invalid_signature" }, { status: 400 }); }
  const result = await createSupabaseAdminClient().rpc("commercial_process_billing_event", { target_environment: configuration.environment, event });
  if (result.error) return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  if (result.data === "processing_failed") return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  return NextResponse.json({ received: true, result: result.data });
}
