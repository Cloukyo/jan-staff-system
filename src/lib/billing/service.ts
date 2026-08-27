import { billingSnapshotSchema, type BillingSnapshot } from "./contracts";

export type BillingRpc = (name: string, parameters: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;

async function rpc<T>(call: BillingRpc, name: string, parameters: Record<string, unknown>): Promise<T> {
  const result = await call(name, parameters);
  if (result.error) throw new Error(`Billing operation failed: ${name}`);
  return result.data as T;
}

export async function loadBillingSnapshot(organisationId: string, call: BillingRpc): Promise<BillingSnapshot> {
  return billingSnapshotSchema.parse(await rpc(call, "commercial_billing_snapshot", { target_organisation_id: organisationId }));
}

export async function recordProviderCustomer(input: { organisationId: string; membershipId: string; environment: string; customerId: string }, call: BillingRpc) {
  return rpc<string>(call, "commercial_record_provider_customer", {
    target_organisation_id: input.organisationId, actor_membership_id: input.membershipId,
    target_environment: input.environment, target_provider_customer_id: input.customerId,
  });
}

export async function prepareCheckoutIntent(input: { organisationId: string; membershipId: string; environment: string; planKey: string; planVersion: number; priceId: string; idempotencyKey: string; requestHash: string }, call: BillingRpc) {
  return rpc<{ intentId: string; providerCustomerId: string; status: string; providerSessionId: string | null }>(call, "commercial_prepare_checkout_intent", {
    target_organisation_id: input.organisationId, actor_membership_id: input.membershipId, target_environment: input.environment,
    target_plan_key: input.planKey, target_plan_version: input.planVersion, target_price_id: input.priceId,
    target_idempotency_key: input.idempotencyKey, target_request_hash: input.requestHash,
  });
}

