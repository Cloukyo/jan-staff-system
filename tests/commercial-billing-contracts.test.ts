import { describe, expect, it } from "vitest";
import {
  billingAccessModeSchema,
  billingSnapshotSchema,
  safeBillingReturnPath,
  stripePriceConfigurationSchema,
  stripeTrialSchedule,
} from "@/lib/billing/contracts";

describe("commercial billing contracts", () => {
  it("keeps provider detail behind stable commercial access modes", () => {
    expect(billingAccessModeSchema.options).toEqual(["setup", "full", "grace", "restricted"]);
    expect(billingSnapshotSchema.parse({
      organisationId: "65000000-0000-4000-8000-000000000001",
      accessMode: "grace",
      state: "past_due",
      plan: { key: "preview_standard", version: 1, displayName: "Preview Standard" },
      trialEndsAt: null,
      currentPeriodEndsAt: "2026-09-14T10:00:00.000Z",
      graceEndsAt: "2026-09-28T10:00:00.000Z",
      cancelAtPeriodEnd: false,
      overLimit: false,
      providerCustomerReady: true,
      providerSubscriptionReady: true,
      noticeCode: "grace",
      availablePlans: [{ key: "preview_standard", version: 1, displayName: "Preview Standard", summary: "Fictional plan" }],
    })).toMatchObject({ accessMode: "grace", state: "past_due" });
  });

  it("accepts only environment-scoped Stripe prices", () => {
    expect(stripePriceConfigurationSchema.parse({
      preview: { preview_standard: { 1: "price_test_standard_v1" } },
    }).preview.preview_standard[1]).toBe("price_test_standard_v1");
    expect(() => stripePriceConfigurationSchema.parse({ preview: { preview_standard: { 1: "prod_live_price" } } })).toThrow();
  });

  it("prevents open redirects from provider return flows", () => {
    expect(safeBillingReturnPath("/admin/billing?checkout=complete")).toBe("/admin/billing?checkout=complete");
    expect(safeBillingReturnPath("https://attacker.invalid/steal")).toBe("/admin/billing");
    expect(safeBillingReturnPath("//attacker.invalid/steal")).toBe("/admin/billing");
  });

  it("never asks Stripe Checkout to end the authoritative trial early", () => {
    const now = 1_786_723_200;
    expect(stripeTrialSchedule(now + 60 * 86_400, now)).toEqual({ trialEndUnix: now + 60 * 86_400 });
    expect(stripeTrialSchedule(now + 47 * 3_600, now)).toEqual({ trialPeriodDays: 2 });
    expect(stripeTrialSchedule(now - 1, now)).toEqual({});
  });
});
