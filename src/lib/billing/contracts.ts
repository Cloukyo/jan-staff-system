import { z } from "zod";

const uuid = z.string().uuid();
const providerId = z.string().regex(/^[A-Za-z0-9_]{3,255}$/);
const isoTimestamp = z.string().datetime({ offset: true }).nullable();

export const billingAccessModeSchema = z.enum(["setup", "full", "grace", "restricted"]);
export const commercialSubscriptionStateSchema = z.enum([
  "trial_pending", "trial_active", "active", "payment_action_required", "past_due",
  "cancelled_at_period_end", "cancelled", "expired", "billing_suspended",
]);

export const billingSnapshotSchema = z.object({
  organisationId: uuid,
  accessMode: billingAccessModeSchema,
  state: commercialSubscriptionStateSchema,
  plan: z.object({ key: z.string(), version: z.number().int().positive(), displayName: z.string() }),
  trialEndsAt: isoTimestamp,
  currentPeriodEndsAt: isoTimestamp,
  graceEndsAt: isoTimestamp,
  cancelAtPeriodEnd: z.boolean(),
  overLimit: z.boolean(),
  providerCustomerReady: z.boolean(),
  providerSubscriptionReady: z.boolean(),
  noticeCode: z.enum(["none", "trial_ending", "grace", "restricted"]),
  availablePlans: z.array(z.object({ key: z.string(), version: z.number().int().positive(), displayName: z.string(), summary: z.string() })),
}).strict();
export type BillingSnapshot = z.infer<typeof billingSnapshotSchema>;

const priceVersionMap = z.record(z.coerce.number().int().positive(), providerId.refine((id) => id.startsWith("price_"), "Stripe Price IDs must start with price_."));
export const stripePriceConfigurationSchema = z.object({
  preview: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), priceVersionMap),
  staging: z.record(z.string(), priceVersionMap).optional(),
  production: z.record(z.string(), priceVersionMap).optional(),
}).strict();

export function safeBillingReturnPath(input: string | null | undefined): string {
  if (!input || !input.startsWith("/") || input.startsWith("//") || input.includes("\\")) return "/admin/billing";
  try {
    const parsed = new URL(input, "https://billing-return.invalid");
    if (parsed.origin !== "https://billing-return.invalid" || !parsed.pathname.startsWith("/admin/billing")) return "/admin/billing";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/admin/billing";
  }
}

export function stripeTrialSchedule(authoritativeTrialEndUnix: number | undefined, providerNowUnix: number) {
  if (!authoritativeTrialEndUnix || authoritativeTrialEndUnix <= providerNowUnix) return {};
  if (authoritativeTrialEndUnix >= providerNowUnix + 48 * 60 * 60) return { trialEndUnix: authoritativeTrialEndUnix };
  return { trialPeriodDays: Math.max(2, Math.ceil((authoritativeTrialEndUnix - providerNowUnix) / 86_400)) };
}

export const billingProviderEventSchema = z.object({
  id: providerId,
  type: z.string().min(3).max(120),
  created: z.number().int().nonnegative(),
  livemode: z.literal(false),
  objectId: providerId.nullable(),
  customerId: providerId.nullable(),
  subscriptionId: providerId.nullable(),
  providerState: z.string().max(64).nullable(),
  periodStart: z.number().int().nonnegative().nullable(),
  periodEnd: z.number().int().nonnegative().nullable(),
  cancelAtPeriodEnd: z.boolean().nullable(),
  priceId: providerId.nullable(),
  amountPaid: z.number().int().nonnegative().nullable(),
}).strict();
export type BillingProviderEvent = z.infer<typeof billingProviderEventSchema>;
