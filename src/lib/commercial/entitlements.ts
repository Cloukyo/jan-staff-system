import { z } from "zod";

const capabilityKeySchema = z.string().regex(/^[a-z][a-z0-9_.]{1,95}$/);

export const capabilityDecisionSchema = z.object({
  capabilityKey: capabilityKeySchema,
  allowed: z.boolean(),
  decisionCode: z.enum([
    "allowed",
    "not_entitled",
    "limit_reached",
    "subscription_required",
    "subscription_not_eligible",
    "offline_disabled",
    "allowed_continuity",
    "grace_growth_blocked",
    "restricted_mode",
  ]),
  limit: z.number().int().nonnegative().nullable(),
  currentUsage: z.number().int().nonnegative().nullable(),
  grantsTenantAccess: z.literal(false),
}).strict();

export type CapabilityDecision = z.infer<typeof capabilityDecisionSchema>;

type CapabilityInput = {
  capabilityKey: string;
  valueType: "boolean" | "integer" | null;
  booleanValue: boolean | null;
  integerValue: number | null;
  currentUsage: number | null;
  requestedUnits?: number;
};

export type CommercialCapabilityRpc = (
  name: "commercial_capability_decision",
  parameters: { target_organisation_id: string; requested_capability_key: string; decision_context: Record<string, number> },
) => Promise<{ data: unknown; error: { message?: string } | null }>;

export async function loadCapabilityDecision(input: {
  organisationId: string;
  capabilityKey: string;
  context?: { requestedUnits?: number };
}, rpc: CommercialCapabilityRpc): Promise<CapabilityDecision> {
  const result = await rpc("commercial_capability_decision", {
    target_organisation_id: z.uuid().parse(input.organisationId),
    requested_capability_key: capabilityKeySchema.parse(input.capabilityKey),
    decision_context: input.context ?? {},
  });
  if (result.error) throw new Error("The authoritative capability decision could not be loaded.");
  return capabilityDecisionSchema.parse(result.data);
}

export async function requireCapability(input: {
  organisationId: string;
  capabilityKey: string;
  context?: { requestedUnits?: number };
}, rpc: CommercialCapabilityRpc): Promise<CapabilityDecision> {
  return requireCapabilityDecision(await loadCapabilityDecision(input, rpc));
}

export function evaluateCapabilityDecision(input: CapabilityInput): CapabilityDecision {
  const capabilityKey = capabilityKeySchema.parse(input.capabilityKey);
  const currentUsage = input.currentUsage === null ? null : Math.max(0, Math.trunc(input.currentUsage));
  if (capabilityKey === "attendance.offline") {
    return { capabilityKey, allowed: false, decisionCode: "offline_disabled", limit: null, currentUsage, grantsTenantAccess: false };
  }
  if (input.valueType === null) {
    return { capabilityKey, allowed: false, decisionCode: "subscription_required", limit: null, currentUsage, grantsTenantAccess: false };
  }
  if (input.valueType === "boolean") {
    const allowed = input.booleanValue === true;
    return { capabilityKey, allowed, decisionCode: allowed ? "allowed" : "not_entitled", limit: null, currentUsage, grantsTenantAccess: false };
  }
  const limit = Math.max(0, Math.trunc(input.integerValue ?? 0));
  const used = currentUsage ?? 0;
  const requested = Math.max(0, Math.trunc(input.requestedUnits ?? 1));
  const allowed = used + requested <= limit;
  return { capabilityKey, allowed, decisionCode: allowed ? "allowed" : "limit_reached", limit, currentUsage: used, grantsTenantAccess: false };
}

export class CapabilityDeniedError extends Error {
  readonly decision: CapabilityDecision;

  constructor(decision: CapabilityDecision) {
    super(`Commercial capability denied: ${decision.decisionCode}`);
    this.name = "CapabilityDeniedError";
    this.decision = decision;
  }
}

export function requireCapabilityDecision(decision: CapabilityDecision): CapabilityDecision {
  const parsed = capabilityDecisionSchema.parse(decision);
  if (!parsed.allowed) throw new CapabilityDeniedError(parsed);
  return parsed;
}
