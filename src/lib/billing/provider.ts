import type { BillingProviderEvent } from "./contracts";

export type HostedSession = { id: string; url: string };

export interface BillingProvider {
  createCustomer(input: { organisationId: string; contactEmail: string | null; displayName: string; idempotencyKey: string }): Promise<{ id: string }>;
  createCheckoutSession(input: { customerId: string; priceId: string; organisationId: string; successUrl: string; cancelUrl: string; idempotencyKey: string; trialEndUnix?: number; trialPeriodDays?: number }): Promise<HostedSession>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<HostedSession>;
  retrieveSubscription(subscriptionId: string): Promise<unknown>;
  updateSubscription(input: { subscriptionId: string; priceId?: string; cancelAtPeriodEnd?: boolean; idempotencyKey: string }): Promise<unknown>;
  verifyWebhook(payload: string | Buffer, signature: string, secret: string): BillingProviderEvent;
}
