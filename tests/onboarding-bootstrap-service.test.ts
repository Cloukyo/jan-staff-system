import { describe, expect, it, vi } from "vitest";
import {
  executeOnboardingBootstrapCommand,
  loadOnboardingBootstrap,
} from "@/lib/onboarding/bootstrap-service";

const sessionId = "71000000-0000-4000-8000-000000000001";
const command = {
  schemaVersion: 1,
  workflowKey: "commercial_customer_v1",
  workflowVersion: 1,
  sessionId,
  commandType: "create_organisation",
  idempotencyKey: "71000000-0000-4000-8000-000000000002",
  expectedSessionRevision: "2",
  payload: {
    displayName: "Northstar Demonstration Operations",
    legalName: "Northstar Demonstration Operations Limited",
    contactEmail: "owner@example.invalid",
    country: "GB",
    timezone: "Europe/London",
    postalAddress: { line1: "1 Fictional Way", locality: "Exampleton", postcode: "ZZ1 1ZZ" },
  },
} as const;

const bootstrap = {
  session: {
    id: sessionId,
    organisationId: null,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    status: "in_progress",
    currentStepKey: "organisation",
    revision: "2",
    lastActivityAt: "2026-08-12T18:00:00+00:00",
  },
  security: { emailVerified: true, assuranceLevel: "aal2", legalAcceptancesCurrent: true },
  steps: [
    { stepKey: "owner_security", status: "complete", revision: "0", draftPayload: {}, validationSummary: [] },
    { stepKey: "legal_acceptance", status: "complete", revision: "1", draftPayload: {}, validationSummary: [] },
    { stepKey: "organisation", status: "in_progress", revision: "0", draftPayload: {}, validationSummary: [] },
    { stepKey: "first_site", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
    { stepKey: "subscription", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
    { stepKey: "staffing", status: "not_started", revision: "0", draftPayload: {}, validationSummary: [] },
  ],
  legalDocuments: [
    { documentType: "terms_of_service", documentVersion: "2026-08", locale: "en-GB", title: "Terms of Service", summary: "Commercial platform terms.", effectiveAt: "2026-08-01T00:00:00+00:00", accepted: true },
    { documentType: "privacy_acknowledgement", documentVersion: "2026-08", locale: "en-GB", title: "Privacy acknowledgement", summary: "Commercial privacy information.", effectiveAt: "2026-08-01T00:00:00+00:00", accepted: true },
    { documentType: "data_processing_agreement", documentVersion: "2026-08", locale: "en-GB", title: "Data Processing Agreement", summary: "Commercial processor terms.", effectiveAt: "2026-08-01T00:00:00+00:00", accepted: true },
  ],
  siteSummary: null,
  planCatalogue: [],
  subscriptionSummary: null,
  staffing: { firstSiteId: null, firstSiteName: null, activeStaffCount: 0, staffLimit: null, remainingStaffAllowance: null, committedThisStep: 0, skipped: false, activeBatch: null },
} as const;

describe("onboarding bootstrap service", () => {
  it("parses authoritative bootstrap state and never falls back to demo data", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: bootstrap, error: null });
    await expect(loadOnboardingBootstrap({ rpc })).resolves.toEqual(bootstrap);
    await expect(loadOnboardingBootstrap({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "unavailable" } }) }))
      .rejects.toThrow(/could not be loaded/i);
  });

  it("accepts a matching authoritative command response and rejects stale or malformed authority", async () => {
    const response = {
      commandResult: {
        schemaVersion: 1,
        workflowKey: "commercial_customer_v1",
        workflowVersion: 1,
        sessionId,
        commandType: "create_organisation",
        outcome: "workflow_changed",
        dataState: "not_saved",
        resultCode: "stale_session_revision",
        resultReference: {},
        sessionRevision: "3",
        issues: [{ code: "stale_session_revision", message: "Reload and try again.", fieldPath: [], repairRoute: "/onboarding" }],
      },
      readiness: null,
      bootstrap: { ...bootstrap, session: { ...bootstrap.session, revision: "3" } },
    };
    const rpc = vi.fn().mockResolvedValue({ data: response, error: null });
    await expect(executeOnboardingBootstrapCommand(command, { rpc })).resolves
      .toEqual(expect.objectContaining({ commandResult: expect.objectContaining({ resultCode: "stale_session_revision" }) }));
    await expect(executeOnboardingBootstrapCommand(command, {
      rpc: vi.fn().mockResolvedValue({ data: { ...response, bootstrap: { fictionalDemoFallback: true } }, error: null }),
    })).rejects.toThrow(/authoritative response/i);
  });

  it("accepts an exact terminal replay after the authoritative workflow has advanced", async () => {
    const response = {
      commandResult: {
        schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1,
        sessionId, commandType: "create_organisation", outcome: "replayed", dataState: "saved",
        resultCode: "organisation_created", resultReference: { organisationId: "71000000-0000-4000-8000-000000000009" },
        sessionRevision: "2", issues: [],
      },
      readiness: null,
      bootstrap: { ...bootstrap, session: { ...bootstrap.session, revision: "5" } },
    };
    await expect(executeOnboardingBootstrapCommand(command, {
      rpc: vi.fn().mockResolvedValue({ data: response, error: null }),
    })).resolves.toEqual(expect.objectContaining({ commandResult: expect.objectContaining({ outcome: "replayed" }) }));
  });

  it("accepts a strict plan-selection command and rejects client entitlement authority", async () => {
    const planCommand = {
      ...command,
      commandType: "select_plan",
      payload: { planKey: "preview_standard", planVersion: 1, selection: "free_trial" },
    } as const;
    const response = {
      commandResult: { schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1,
        sessionId, commandType: "select_plan", outcome: "succeeded", dataState: "saved",
        resultCode: "trial_pending_created", resultReference: { subscriptionId: "71000000-0000-4000-8000-000000000010" },
        sessionRevision: "3", issues: [] },
      readiness: null,
      bootstrap: { ...bootstrap, session: { ...bootstrap.session, revision: "3", currentStepKey: "settings" },
        subscriptionSummary: { subscriptionId: "71000000-0000-4000-8000-000000000010", planKey: "preview_standard",
          planVersion: 1, planDisplayName: "Preview Standard", state: "trial_pending", trialDurationDays: 60,
          trialStartedAt: null, trialEndsAt: null } },
    };
    await expect(executeOnboardingBootstrapCommand(planCommand, { rpc: vi.fn().mockResolvedValue({ data: response, error: null }) })).resolves
      .toEqual(expect.objectContaining({ commandResult: expect.objectContaining({ resultCode: "trial_pending_created" }) }));
    await expect(executeOnboardingBootstrapCommand({ ...planCommand, payload: { ...planCommand.payload, offlineAttendance: true } }, {
      rpc: vi.fn(),
    })).rejects.toThrow();
  });
});
