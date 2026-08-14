import { describe, expect, it } from "vitest";
import {
  commercialReadinessSnapshotSchema,
  goLivePayloadSchema,
} from "@/lib/onboarding/readiness-contracts";
import { onboardingBootstrapStepKeySchema } from "@/lib/onboarding/contracts";

const item = {
  key: "owner_security",
  category: "account",
  status: "ready",
  severity: "blocker",
  title: "Owner account",
  explanation: "Your verified account and multi-factor authentication are ready.",
  remediationRoute: null,
  evidenceRevision: "owner:7",
} as const;

describe("commercial readiness and Go Live contracts", () => {
  it("accepts the final review and Go Live bootstrap steps", () => {
    expect(onboardingBootstrapStepKeySchema.parse("readiness")).toBe("readiness");
    expect(onboardingBootstrapStepKeySchema.parse("go_live")).toBe("go_live");
  });

  it("accepts a strict authoritative readiness snapshot", () => {
    const value = {
      evaluatorVersion: 2,
      sessionId: "81000000-0000-4000-8000-000000000001",
      organisationId: "81000000-0000-4000-8000-000000000002",
      workflowRevision: "14",
      fingerprint: "a".repeat(64),
      overallStatus: "ready",
      blockerCount: 0,
      warningCount: 0,
      progressPercent: 100,
      evaluatedAt: "2026-08-14T10:00:00.000Z",
      items: [item],
    };
    expect(commercialReadinessSnapshotSchema.parse(value)).toEqual(value);
  });

  it("rejects client-added authority and malformed fingerprints", () => {
    expect(() => commercialReadinessSnapshotSchema.parse({
      evaluatorVersion: 2,
      sessionId: "81000000-0000-4000-8000-000000000001",
      organisationId: "81000000-0000-4000-8000-000000000002",
      workflowRevision: "14",
      fingerprint: "not-authoritative",
      overallStatus: "ready",
      blockerCount: 0,
      warningCount: 0,
      progressPercent: 100,
      evaluatedAt: "2026-08-14T10:00:00.000Z",
      items: [{ ...item, clientReady: true }],
    })).toThrow();
  });

  it("requires the readiness fingerprint and explicit sole-manager acknowledgement only", () => {
    expect(goLivePayloadSchema.parse({
      readinessFingerprint: "b".repeat(64),
      acknowledgedWarnings: ["sole_manager"],
    })).toEqual({
      readinessFingerprint: "b".repeat(64),
      acknowledgedWarnings: ["sole_manager"],
    });
    expect(() => goLivePayloadSchema.parse({
      readinessFingerprint: "b".repeat(64),
      acknowledgedWarnings: ["offline_enabled"],
    })).toThrow();
    expect(() => goLivePayloadSchema.parse({
      readinessFingerprint: "b".repeat(64),
      organisationId: "81000000-0000-4000-8000-000000000002",
      ready: true,
    })).toThrow();
  });
});
