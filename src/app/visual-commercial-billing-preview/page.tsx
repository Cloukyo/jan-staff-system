import { notFound } from "next/navigation";
import { BillingScreen } from "@/components/billing/billing-page";
import type { BillingSnapshot } from "@/lib/billing/contracts";

const snapshot: BillingSnapshot = {
  organisationId: "85000000-0000-4000-8000-000000000001",
  accessMode: "grace",
  state: "past_due",
  plan: { key: "commercial_standard", version: 2, displayName: "Standard" },
  trialEndsAt: "2026-08-12T10:00:00.000Z",
  currentPeriodEndsAt: null,
  graceEndsAt: "2026-08-19T10:00:00.000Z",
  cancelAtPeriodEnd: false,
  overLimit: false,
  providerCustomerReady: true,
  providerSubscriptionReady: false,
  noticeCode: "grace",
  availablePlans: [
    { key: "commercial_standard", version: 2, displayName: "Standard", summary: "Core workforce operations for established teams." },
    { key: "commercial_group", version: 1, displayName: "Group", summary: "Higher limits for organisations operating across multiple sites." },
  ],
};

export default function VisualCommercialBillingPreview() {
  if (!["local", "preview"].includes(process.env.APP_ENV ?? "")) notFound();
  return <BillingScreen snapshot={snapshot} permissions={["billing.manage"]}/>;
}
