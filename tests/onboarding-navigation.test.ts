import { describe, expect, it } from "vitest";
import { authoritativeOnboardingRoute } from "@/lib/onboarding/navigation";
import type { OnboardingBootstrapSnapshot } from "@/lib/onboarding/contracts";

function snapshot(overrides: Partial<OnboardingBootstrapSnapshot["security"]> = {}, organisationId: string | null = null): OnboardingBootstrapSnapshot {
  return {
    session: { id: "72000000-0000-4000-8000-000000000001", organisationId, workflowKey: "commercial_customer_v1", workflowVersion: 1, status: "in_progress", currentStepKey: "owner_account", revision: "0", lastActivityAt: "2026-08-12T18:00:00+00:00" },
    security: { emailVerified: false, assuranceLevel: "aal1", legalAcceptancesCurrent: false, ...overrides },
    steps: [
      { stepKey: "owner_security", status: "blocked", revision: "0", draftPayload: {}, validationSummary: [] },
      { stepKey: "legal_acceptance", status: "blocked", revision: "0", draftPayload: {}, validationSummary: [] },
      { stepKey: "organisation", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
      { stepKey: "first_site", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
      { stepKey: "subscription", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
      { stepKey: "staffing", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
      { stepKey: "manager_invitations", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
    ],
    legalDocuments: [
      { documentType: "terms_of_service", documentVersion: "2026-08", locale: "en-GB", title: "Terms of Service", summary: "Fictional commercial terms.", effectiveAt: "2026-08-01T00:00:00+00:00", accepted: false },
      { documentType: "privacy_acknowledgement", documentVersion: "2026-08", locale: "en-GB", title: "Privacy acknowledgement", summary: "Fictional privacy information.", effectiveAt: "2026-08-01T00:00:00+00:00", accepted: false },
      { documentType: "data_processing_agreement", documentVersion: "2026-08", locale: "en-GB", title: "Data Processing Agreement", summary: "Fictional processor terms.", effectiveAt: "2026-08-01T00:00:00+00:00", accepted: false },
    ],
    siteSummary: null,
    planCatalogue: [],
    subscriptionSummary: null,
    staffing: { firstSiteId: null, firstSiteName: null, activeStaffCount: 0, staffLimit: null, remainingStaffAllowance: null, committedThisStep: 0, skipped: false, activeBatch: null },
    managerInvitations: { soleManagerAcknowledged: false, invitations: [], availableSites: [] },
  };
}

describe("authoritative onboarding resume route", () => {
  it("routes every bootstrap state from server evidence", () => {
    expect(authoritativeOnboardingRoute(snapshot())).toBe("/onboarding");
    expect(authoritativeOnboardingRoute(snapshot({ emailVerified: true, assuranceLevel: "aal2" }))).toBe("/onboarding/legal");
    expect(authoritativeOnboardingRoute(snapshot({ emailVerified: true, assuranceLevel: "aal2", legalAcceptancesCurrent: true }))).toBe("/onboarding/organisation");
    expect(authoritativeOnboardingRoute(snapshot({}, "72000000-0000-4000-8000-000000000002"))).toBe("/onboarding/site");
    const complete = snapshot({}, "72000000-0000-4000-8000-000000000002");
    complete.steps[3].status = "complete";
    expect(authoritativeOnboardingRoute(complete)).toBe("/onboarding/plan");
    complete.steps[4].status = "complete";
    expect(authoritativeOnboardingRoute(complete)).toBe("/onboarding/staffing");
    complete.steps[5].status = "complete";
    expect(authoritativeOnboardingRoute(complete)).toBe("/onboarding/managers");
    complete.steps[6].status = "complete";
    expect(authoritativeOnboardingRoute(complete)).toBe("/onboarding/next");
  });
});
