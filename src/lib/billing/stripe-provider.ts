import Stripe from "stripe";
import { billingProviderEventSchema, type BillingProviderEvent } from "./contracts";
import type { BillingProvider } from "./provider";

type StripeDependencies = {
  customerCreate: (parameters: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string }>;
  checkoutCreate: (parameters: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<{ id: string; url: string | null }>;
  portalCreate: (parameters: Stripe.BillingPortal.SessionCreateParams) => Promise<{ id: string; url: string }>;
  subscriptionRetrieve: (id: string) => Promise<unknown>;
  subscriptionUpdate: (id: string, parameters: Stripe.SubscriptionUpdateParams, options?: Stripe.RequestOptions) => Promise<unknown>;
  webhookConstruct: (payload: string | Buffer, signature: string, secret: string) => Stripe.Event;
};

function identifier(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

function normaliseEvent(event: Stripe.Event): BillingProviderEvent {
  const object = event.data.object as unknown as Record<string, unknown>;
  const subscription = object.object === "subscription" ? object : null;
  const invoice = object.object === "invoice" ? object : null;
  const checkout = object.object === "checkout.session" ? object : null;
  const parent = invoice?.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const lines = (invoice?.lines as { data?: Array<{ pricing?: { price_details?: { price?: string } }; period?: { start?: number; end?: number } }> } | undefined)?.data ?? [];
  const firstLine = lines[0];
  return billingProviderEventSchema.parse({
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
    objectId: identifier(object.id),
    customerId: identifier(object.customer),
    subscriptionId: identifier(subscription?.id) ?? identifier(checkout?.subscription) ?? identifier(parent?.subscription_details?.subscription),
    providerState: typeof subscription?.status === "string" ? subscription.status : null,
    periodStart: typeof subscription?.current_period_start === "number" ? subscription.current_period_start : firstLine?.period?.start ?? null,
    periodEnd: typeof subscription?.current_period_end === "number" ? subscription.current_period_end : firstLine?.period?.end ?? null,
    cancelAtPeriodEnd: typeof subscription?.cancel_at_period_end === "boolean" ? subscription.cancel_at_period_end : null,
    priceId: identifier((subscription?.items as { data?: Array<{ price?: unknown }> } | undefined)?.data?.[0]?.price) ?? firstLine?.pricing?.price_details?.price ?? null,
    amountPaid: typeof invoice?.amount_paid === "number" ? invoice.amount_paid : null,
  });
}

export function createStripeBillingProvider(dependencies: StripeDependencies): BillingProvider {
  return {
    async createCustomer(input) {
      return dependencies.customerCreate({
        email: input.contactEmail ?? undefined,
        name: input.displayName,
        metadata: { organisation_id: input.organisationId },
      }, { idempotencyKey: input.idempotencyKey });
    },
    async createCheckoutSession(input) {
      const session = await dependencies.checkoutCreate({
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        client_reference_id: input.organisationId,
        metadata: { organisation_id: input.organisationId },
        subscription_data: { metadata: { organisation_id: input.organisationId }, trial_end: input.trialEndUnix, trial_period_days: input.trialPeriodDays },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }, { idempotencyKey: input.idempotencyKey });
      if (!session.url) throw new Error("Stripe did not return a hosted checkout URL.");
      return { id: session.id, url: session.url };
    },
    async createPortalSession(input) {
      return dependencies.portalCreate({ customer: input.customerId, return_url: input.returnUrl });
    },
    retrieveSubscription: dependencies.subscriptionRetrieve,
    async updateSubscription(input) {
      const parameters: Stripe.SubscriptionUpdateParams = {};
      if (input.cancelAtPeriodEnd !== undefined) parameters.cancel_at_period_end = input.cancelAtPeriodEnd;
      if (input.priceId) {
        const current = await dependencies.subscriptionRetrieve(input.subscriptionId) as Stripe.Subscription;
        const itemId = current.items?.data?.[0]?.id;
        if (!itemId) throw new Error("The provider subscription has no replaceable plan item.");
        parameters.items = [{ id: itemId, price: input.priceId }];
        parameters.proration_behavior = "create_prorations";
      }
      return dependencies.subscriptionUpdate(input.subscriptionId, parameters, { idempotencyKey: input.idempotencyKey });
    },
    verifyWebhook(payload, signature, secret) {
      try {
        return normaliseEvent(dependencies.webhookConstruct(payload, signature, secret));
      } catch {
        throw new Error("Billing webhook signature verification failed.");
      }
    },
  };
}

export function createStripeProvider(secretKey: string): BillingProvider {
  const stripe = new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia", maxNetworkRetries: 2 });
  return createStripeBillingProvider({
    customerCreate: stripe.customers.create.bind(stripe.customers),
    checkoutCreate: stripe.checkout.sessions.create.bind(stripe.checkout.sessions),
    portalCreate: stripe.billingPortal.sessions.create.bind(stripe.billingPortal.sessions),
    subscriptionRetrieve: stripe.subscriptions.retrieve.bind(stripe.subscriptions),
    subscriptionUpdate: stripe.subscriptions.update.bind(stripe.subscriptions),
    webhookConstruct: stripe.webhooks.constructEvent.bind(stripe.webhooks),
  });
}
