import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/auth/supabase-admin";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireAal2, requirePermission } from "@/lib/commercial-identity/guards";
import { requireActiveMembership, requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { configuredPrice, loadBillingConfiguration } from "./config";
import { safeBillingReturnPath, stripeTrialSchedule } from "./contracts";
import { createStripeProvider } from "./stripe-provider";
import { loadBillingSnapshot, prepareCheckoutIntent, recordProviderCustomer, type BillingRpc } from "./service";

function rpc(client: { rpc: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }> }): BillingRpc {
  return async (name, parameters) => client.rpc(name, parameters);
}

async function authority() {
  requireAal2(await requireCommercialIdentity());
  return requirePermission(await requireActiveMembership({ selectionMode: "sensitive" }), "billing.manage");
}

export async function loadBillingServer() {
  const context = requirePermission(await requireActiveMembership({ selectionMode: "sensitive" }), "billing.manage");
  const client = await createSupabaseServerClient();
  return { context, snapshot: await loadBillingSnapshot(context.organisationId, rpc(client)) };
}

export async function createHostedCheckout(input: { planKey: string; planVersion: number; idempotencyKey: string; returnPath?: string }) {
  const context = await authority();
  const configuration = loadBillingConfiguration();
  const provider = createStripeProvider(configuration.secretKey);
  const authenticated = await createSupabaseServerClient();
  const billingSnapshot = await loadBillingSnapshot(context.organisationId, rpc(authenticated));
  if (billingSnapshot.state === "trial_pending") throw new Error("Go Live must complete before payment setup begins.");
  if (billingSnapshot.providerSubscriptionReady) throw new Error("Recover the existing subscription through the billing portal.");
  const admin = createSupabaseAdminClient();
  const adminRpc = rpc(admin);
  const { data: organisation, error: organisationError } = await admin.from("organisations").select("display_name,contact_email").eq("id", context.organisationId).single();
  if (organisationError || !organisation) throw new Error("The billing organisation could not be loaded.");
  const { data: existing } = await admin.from("billing_provider_customers").select("provider_customer_id").eq("organisation_id", context.organisationId).eq("provider", "stripe").eq("provider_environment", configuration.environment).maybeSingle();
  const customerId = existing?.provider_customer_id ?? (await provider.createCustomer({
    organisationId: context.organisationId, displayName: organisation.display_name, contactEmail: organisation.contact_email,
    idempotencyKey: `customer-${configuration.environment}-${context.organisationId}`,
  })).id;
  await recordProviderCustomer({ organisationId: context.organisationId, membershipId: context.membershipId, environment: configuration.environment, customerId }, adminRpc);
  const priceId = configuredPrice(input, configuration);
  const recordedPrice = await admin.rpc("commercial_record_provider_price", { target_environment: configuration.environment,
    target_plan_key: input.planKey, target_plan_version: input.planVersion, target_provider_price_id: priceId });
  if (recordedPrice.error) throw new Error("The environment price mapping could not be recorded safely.");
  const requestHash = createHash("sha256").update(JSON.stringify({ organisationId: context.organisationId, planKey: input.planKey, planVersion: input.planVersion, priceId })).digest("hex");
  const intent = await prepareCheckoutIntent({ ...input, organisationId: context.organisationId, membershipId: context.membershipId, environment: configuration.environment, priceId, requestHash }, adminRpc);
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL!).origin;
  const returnPath = safeBillingReturnPath(input.returnPath);
  const authoritativeTrialEnd = billingSnapshot.state === "trial_active" && billingSnapshot.trialEndsAt
    ? Math.floor(new Date(billingSnapshot.trialEndsAt).getTime() / 1000) : undefined;
  const providerNow = Math.floor(Date.now() / 1000);
  const trialSchedule = stripeTrialSchedule(authoritativeTrialEnd, providerNow);
  const session = await provider.createCheckoutSession({ customerId, priceId, organisationId: context.organisationId,
    successUrl: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}checkout=complete`, cancelUrl: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}checkout=cancelled`,
    idempotencyKey: `checkout-${intent.intentId}`, ...trialSchedule });
  const completed = await admin.rpc("commercial_complete_checkout_intent", { target_intent_id: intent.intentId, target_provider_session_id: session.id, target_url_origin: new URL(session.url).origin });
  if (completed.error) throw new Error("The hosted Checkout session could not be recorded safely.");
  return session.url;
}

export async function createHostedPortal(returnPath?: string) {
  const context = await authority();
  const configuration = loadBillingConfiguration();
  const admin = createSupabaseAdminClient();
  const { data: mapping, error } = await admin.from("billing_provider_customers").select("provider_customer_id").eq("organisation_id", context.organisationId).eq("provider", "stripe").eq("provider_environment", configuration.environment).single();
  if (error || !mapping) throw new Error("Complete payment setup before opening the billing portal.");
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL!).origin;
  return (await createStripeProvider(configuration.secretKey).createPortalSession({ customerId: mapping.provider_customer_id, returnUrl: `${origin}${safeBillingReturnPath(returnPath)}` })).url;
}

export async function updateHostedSubscription(input: { planKey?: string; planVersion?: number; cancelAtPeriodEnd?: boolean; idempotencyKey: string }) {
  const context = await authority();
  const configuration = loadBillingConfiguration();
  const admin = createSupabaseAdminClient();
  const { data: subscription, error } = await admin.from("organisation_subscriptions").select("provider_subscription_id").eq("organisation_id", context.organisationId).eq("is_current", true).single();
  if (error || !subscription?.provider_subscription_id) throw new Error("A paid subscription is required for this change.");
  const priceId = input.planKey && input.planVersion ? configuredPrice({ planKey: input.planKey, planVersion: input.planVersion }, configuration) : undefined;
  if (priceId && input.planKey && input.planVersion) {
    const recorded = await admin.rpc("commercial_record_provider_price", { target_environment: configuration.environment,
      target_plan_key: input.planKey, target_plan_version: input.planVersion, target_provider_price_id: priceId });
    if (recorded.error) throw new Error("The environment price mapping could not be recorded safely.");
  }
  await createStripeProvider(configuration.secretKey).updateSubscription({ subscriptionId: subscription.provider_subscription_id, priceId, cancelAtPeriodEnd: input.cancelAtPeriodEnd, idempotencyKey: input.idempotencyKey });
}
