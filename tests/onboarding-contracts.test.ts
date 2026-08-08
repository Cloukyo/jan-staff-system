import { describe, expect, it } from "vitest";
import {
  commercialCustomerWorkflowV1,
  onboardingCommandResultSchema,
  onboardingCommandSchema,
  onboardingEventSchema,
  onboardingReadinessItemSchema,
  onboardingReadinessSnapshotSchema,
  onboardingStepStateSchema,
  onboardingWorkflowDefinitionSchema,
  onboardingWorkflowStateSchema,
} from "@/lib/onboarding/contracts";

const sessionId = "10000000-0000-4000-8000-000000000001";
const organisationId = "10000000-0000-4000-8000-000000000002";
const actorId = "10000000-0000-4000-8000-000000000003";

describe("commercial onboarding workflow contracts", () => {
  it("defines the complete versioned commercial customer workflow", () => {
    expect(commercialCustomerWorkflowV1).toMatchObject({
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      readinessEvaluatorVersion: 1,
    });
    expect(commercialCustomerWorkflowV1.steps.map((step) => step.stepKey)).toEqual([
      "owner_account",
      "organisation",
      "first_site",
      "subscription",
      "settings",
      "staff",
      "manager_invitations",
      "staff_invitations",
      "kiosk",
      "initial_rota",
      "readiness",
      "go_live",
    ]);
    expect(commercialCustomerWorkflowV1.steps.map((step) => step.progressWeight)).toEqual([
      10, 10, 10, 10, 10, 15, 10, 5, 15, 0, 5, 0,
    ]);
    expect(onboardingWorkflowDefinitionSchema.parse(commercialCustomerWorkflowV1))
      .toEqual(commercialCustomerWorkflowV1);
  });

  it("rejects duplicate, circular, forward and incomplete workflow definitions", () => {
    const duplicate = structuredClone(commercialCustomerWorkflowV1);
    duplicate.steps[1].stepKey = "owner_account";
    expect(() => onboardingWorkflowDefinitionSchema.parse(duplicate)).toThrow(/unique/i);

    const selfPrerequisite = structuredClone(commercialCustomerWorkflowV1);
    selfPrerequisite.steps[1].prerequisiteStepKeys = ["organisation"];
    expect(() => onboardingWorkflowDefinitionSchema.parse(selfPrerequisite)).toThrow(/prerequisite/i);

    const forwardPrerequisite = structuredClone(commercialCustomerWorkflowV1);
    forwardPrerequisite.steps[1].prerequisiteStepKeys = ["go_live"];
    expect(() => onboardingWorkflowDefinitionSchema.parse(forwardPrerequisite)).toThrow(/earlier/i);

    const wrongWeight = structuredClone(commercialCustomerWorkflowV1);
    wrongWeight.steps[0].progressWeight = 9;
    expect(() => onboardingWorkflowDefinitionSchema.parse(wrongWeight)).toThrow(/100/i);

    const incomplete = structuredClone(commercialCustomerWorkflowV1);
    incomplete.steps.pop();
    expect(() => onboardingWorkflowDefinitionSchema.parse(incomplete)).toThrow(/complete|exact/i);

    const unsupportedStepVersion = structuredClone(commercialCustomerWorkflowV1);
    (unsupportedStepVersion.steps[0] as unknown as { stepVersion: number }).stepVersion = 2;
    expect(() => onboardingWorkflowDefinitionSchema.parse(unsupportedStepVersion)).toThrow(/version/i);

    const redistributedWeights = structuredClone(commercialCustomerWorkflowV1);
    redistributedWeights.steps[0].progressWeight = 9;
    redistributedWeights.steps[1].progressWeight = 11;
    expect(() => onboardingWorkflowDefinitionSchema.parse(redistributedWeights)).toThrow(/versioned|exact/i);
  });

  it("validates durable workflow state with decimal revisions and immutable Go Live evidence", () => {
    const state = {
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      sessionId,
      organisationId,
      status: "in_progress",
      currentStepKey: "staff",
      revision: "12",
      startedAt: "2026-08-08T09:00:00+01:00",
      lastActivityAt: "2026-08-08T10:00:00+01:00",
      readyAt: null,
      goLiveAt: null,
      completedByMembershipId: null,
    } as const;

    expect(onboardingWorkflowStateSchema.parse(state)).toEqual(state);
    expect(() => onboardingWorkflowStateSchema.parse({ ...state, revision: -1 })).toThrow(/revision/i);
    expect(() => onboardingWorkflowStateSchema.parse({ ...state, schemaVersion: 2 })).toThrow();
    expect(() => onboardingWorkflowStateSchema.parse({ ...state, clientOrganisationId: organisationId })).toThrow();
  });

  it("validates resumable step state without accepting non-JSON or secret draft fields", () => {
    const state = {
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      sessionId,
      stepKey: "settings",
      stepVersion: 1,
      status: "in_progress",
      revision: "3",
      draftPayload: { workWeekStart: "monday", notificationsEnabled: true },
      validationSummary: [{
        code: "invalid_work_week",
        message: "Choose a supported work-week start.",
        fieldPath: ["workWeekStart"],
      }],
      startedAt: "2026-08-08T09:30:00+01:00",
      completedAt: null,
      lastSavedAt: "2026-08-08T09:45:00+01:00",
      completedByAuthUserId: actorId,
    } as const;

    expect(onboardingStepStateSchema.parse(state)).toEqual(state);
    expect(() => onboardingStepStateSchema.parse({
      ...state,
      draftPayload: { pin: "1234" },
    })).toThrow(/secret|sensitive/i);
    expect(() => onboardingStepStateSchema.parse({
      ...state,
      draftPayload: { callback: () => true },
    })).toThrow();
  });
});

describe("commercial onboarding command and event contracts", () => {
  const command = {
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId,
    commandType: "create_organisation",
    idempotencyKey: "10000000-0000-4000-8000-000000000004",
    expectedSessionRevision: "12",
    payload: {
      legalName: "Example Operations Limited",
      timezone: "Europe/London",
    },
  } as const;

  it("accepts explicit versioned commands and rejects client contract drift", () => {
    expect(onboardingCommandSchema.parse(command)).toEqual(command);
    expect(() => onboardingCommandSchema.parse({ ...command, schemaVersion: 2 })).toThrow();
    expect(() => onboardingCommandSchema.parse({ ...command, commandType: "run_sql" })).toThrow();
    expect(() => onboardingCommandSchema.parse({ ...command, expectedSessionRevision: 12 })).toThrow(/revision/i);
    expect(() => onboardingCommandSchema.parse({ ...command, organisationId })).toThrow();
  });

  it("requires replayable command results to state whether data was saved", () => {
    const result = {
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      sessionId,
      commandType: "create_organisation",
      outcome: "succeeded",
      dataState: "saved",
      resultCode: "organisation_created",
      resultReference: { organisationId },
      sessionRevision: "13",
      issues: [],
    } as const;

    expect(onboardingCommandResultSchema.parse(result)).toEqual(result);
    expect(() => onboardingCommandResultSchema.parse({ ...result, dataState: undefined })).toThrow();
    expect(() => onboardingCommandResultSchema.parse({
      ...result,
      outcome: "validation_failed",
      dataState: "saved",
    })).toThrow(/saved/i);
    expect(onboardingCommandResultSchema.parse({ ...result, outcome: "replayed" }))
      .toEqual(expect.objectContaining({ outcome: "replayed", dataState: "saved" }));
    expect(onboardingCommandResultSchema.parse({
      ...result,
      outcome: "indeterminate",
      dataState: "unknown",
      resultCode: "reconciliation_required",
    })).toEqual(expect.objectContaining({ outcome: "indeterminate", dataState: "unknown" }));
  });

  it("accepts append-only event envelopes with privacy-safe structured metadata", () => {
    const event = {
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      eventVersion: 1,
      id: "10000000-0000-4000-8000-000000000005",
      sessionId,
      organisationId,
      eventType: "organisation_created",
      stepKey: "organisation",
      actorType: "owner",
      actorAuthUserId: actorId,
      actorMembershipId: null,
      requestId: "10000000-0000-4000-8000-000000000006",
      workflowRevision: "13",
      safeMetadata: {
        statusCode: "created",
        resourceCounts: { organisations: 1, sites: 0 },
        warningCodes: [],
      },
      occurredAt: "2026-08-08T10:15:00+01:00",
    } as const;

    expect(onboardingEventSchema.parse(event)).toEqual(event);
    expect(() => onboardingEventSchema.parse({ ...event, eventVersion: 2 })).toThrow();
    expect(() => onboardingEventSchema.parse({ ...event, eventType: "arbitrary_event" })).toThrow();
  });

  it("rejects sensitive keys and free-text personal data from event metadata", () => {
    const base = {
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      eventVersion: 1,
      id: "10000000-0000-4000-8000-000000000007",
      sessionId,
      organisationId: null,
      eventType: "signup_started",
      stepKey: "owner_account",
      actorType: "owner",
      actorAuthUserId: actorId,
      actorMembershipId: null,
      requestId: null,
      workflowRevision: "0",
      occurredAt: "2026-08-08T09:00:00+01:00",
    } as const;

    expect(() => onboardingEventSchema.parse({
      ...base,
      safeMetadata: { email: "person@example.invalid" },
    })).toThrow();
    expect(() => onboardingEventSchema.parse({
      ...base,
      safeMetadata: { pin: "1234" },
    })).toThrow();
    expect(() => onboardingEventSchema.parse({
      ...base,
      safeMetadata: { rawImportRows: [{ result: "valid" }] },
    })).toThrow();
    expect(() => onboardingEventSchema.parse({
      ...base,
      safeMetadata: { detail: "Demo Person A" },
    })).toThrow();
    expect(() => onboardingEventSchema.parse({
      ...base,
      safeMetadata: { postcode: "example_postcode_value" },
    })).toThrow();
    expect(() => onboardingEventSchema.parse({
      ...base,
      safeMetadata: { contact: "example_contact_value" },
    })).toThrow();
  });
});

describe("commercial onboarding readiness contracts", () => {
  const requiredBlockerKeys = [
    "owner_identity",
    "legal_acceptance",
    "organisation",
    "owner_membership",
    "first_site",
    "operational_settings",
    "commercial_access",
    "attendance_policy",
    "pin_policy",
    "eligible_staff",
    "online_kiosk",
    "kiosk_roster",
    "offline_disabled",
    "security_health",
    "command_health",
  ] as const;

  const offlineDisabled = {
    itemKey: "offline_disabled",
    evaluatorVersion: 1,
    severity: "blocker",
    result: "pass",
    reasonCode: "offline_disabled",
    userMessage: "Offline attendance is disabled.",
    repairRoute: null,
    evidenceAt: "2026-08-08T10:30:00+01:00",
    sourceRevision: "global:0",
  } as const;

  const snapshot = {
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    evaluatorVersion: 1,
    sessionId,
    organisationId,
    overallStatus: "ready",
    workflowRevision: "13",
    items: [
      ...requiredBlockerKeys.map((itemKey) => ({
        itemKey,
        evaluatorVersion: 1 as const,
        severity: "blocker" as const,
        result: "pass" as const,
        reasonCode: `${itemKey}_ready`,
        userMessage: `${itemKey} is ready.`,
        repairRoute: null,
        evidenceAt: "2026-08-08T10:30:00+01:00",
        sourceRevision: `${itemKey}:1`,
      })),
      {
        itemKey: "initial_rota",
        evaluatorVersion: 1,
        severity: "optional",
        result: "not_applicable",
        reasonCode: "not_configured",
        userMessage: "An initial rota is optional.",
        repairRoute: "/rota",
        evidenceAt: "2026-08-08T10:30:00+01:00",
        sourceRevision: "rota:0",
      },
    ],
    evaluatedAt: "2026-08-08T10:30:00+01:00",
  } as const;

  it("accepts versioned readiness items with stable repair information", () => {
    expect(onboardingReadinessItemSchema.parse(offlineDisabled)).toEqual(offlineDisabled);
    expect(onboardingReadinessSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("does not permit a ready snapshot with an unresolved blocker", () => {
    const blocked = {
      ...offlineDisabled,
      result: "blocked",
      reasonCode: "offline_enabled",
      userMessage: "Disable offline attendance before going live.",
      repairRoute: "/settings/kiosk",
    } as const;

    expect(() => onboardingReadinessSnapshotSchema.parse({
      ...snapshot,
      items: [blocked, ...snapshot.items.filter((item) => item.itemKey !== "offline_disabled")],
    })).toThrow(/ready|blocker/i);
    expect(onboardingReadinessSnapshotSchema.parse({
      ...snapshot,
      overallStatus: "needs_attention",
      items: [blocked],
    })).toEqual(expect.objectContaining({ overallStatus: "needs_attention" }));
  });

  it("does not permit a ready snapshot that omits required blocker evaluations", () => {
    expect(() => onboardingReadinessSnapshotSchema.parse({
      ...snapshot,
      items: [offlineDisabled],
    })).toThrow(/required blocker/i);
  });

  it("does not permit required blockers to be downgraded or bypassed after Go Live", () => {
    const downgradedOfflineBlocker = snapshot.items.map((item) => (
      item.itemKey === "offline_disabled"
        ? { ...item, severity: "warning" as const, result: "blocked" as const }
        : item
    ));
    expect(() => onboardingReadinessSnapshotSchema.parse({
      ...snapshot,
      items: downgradedOfflineBlocker,
    })).toThrow(/blocker severity|offline/i);

    const liveWithBlocker = snapshot.items.map((item) => (
      item.itemKey === "offline_disabled"
        ? { ...item, result: "blocked" as const, reasonCode: "offline_enabled" }
        : item
    ));
    expect(() => onboardingReadinessSnapshotSchema.parse({
      ...snapshot,
      overallStatus: "live",
      items: liveWithBlocker,
    })).toThrow(/live|blocker/i);

    const notApplicableOfflineBlocker = snapshot.items.map((item) => (
      item.itemKey === "offline_disabled"
        ? { ...item, result: "not_applicable" as const, reasonCode: "not_applicable" }
        : item
    ));
    expect(() => onboardingReadinessSnapshotSchema.parse({
      ...snapshot,
      items: notApplicableOfflineBlocker,
    })).toThrow(/ready|blocker/i);
  });

  it("rejects unsupported evaluator versions and client-added readiness authority", () => {
    expect(() => onboardingReadinessItemSchema.parse({
      ...offlineDisabled,
      evaluatorVersion: 2,
    })).toThrow();
    expect(() => onboardingReadinessItemSchema.parse({
      ...offlineDisabled,
      offlineAuthorisationIssued: true,
    })).toThrow();
    expect(() => onboardingReadinessSnapshotSchema.parse({
      ...snapshot,
      evaluatorVersion: 2,
    })).toThrow();
  });
});
