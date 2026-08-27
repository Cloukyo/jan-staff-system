import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  kioskClaimPayloadSchema,
  kioskHeartbeatPayloadSchema,
  kioskPinSetupPayloadSchema,
  kioskRegistrationPayloadSchema,
  kioskSnapshotSchema,
} from "@/lib/onboarding/kiosk-contracts";
import { onboardingBootstrapCommandSchema } from "@/lib/onboarding/contracts";

describe("commercial kiosk onboarding contracts", () => {
  it("repairs renamed attendance-RPC self references without changing attendance logic", () => {
    const repair = readFileSync(
      resolve("supabase/migrations/20260814015451_fix_commercial_kiosk_attendance_wrapper.sql"),
      "utf8",
    );
    expect(repair).toContain("perform_commercial_kiosk_attendance_action_7g.idempotency_key");
    expect(repair).toContain("pg_get_functiondef");
  });
  it("accepts only the approved site-bound registration fields", () => {
    expect(
      kioskRegistrationPayloadSchema.parse({
        siteId: "71000000-0000-4000-8000-000000000001",
        deviceName: "Front entrance",
      }),
    ).toEqual({
      siteId: "71000000-0000-4000-8000-000000000001",
      deviceName: "Front entrance",
    });
    expect(() =>
      kioskRegistrationPayloadSchema.parse({
        siteId: "71000000-0000-4000-8000-000000000001",
        deviceName: "Front entrance",
        organisationId: "71000000-0000-4000-8000-000000000099",
        offlineEnabled: true,
      }),
    ).toThrow();
  });

  it("requires high-entropy claim and device-health values", () => {
    expect(
      kioskClaimPayloadSchema.parse({
        registrationId: "71000000-0000-4000-8000-000000000001",
        registrationSecret: "ABCDEFGHJKMNPQRT",
        claimantNonce: "c".repeat(43),
      }),
    ).toBeTruthy();
    expect(() =>
      kioskClaimPayloadSchema.parse({
        registrationId: "71000000-0000-4000-8000-000000000001",
        registrationSecret: "1234",
        claimantNonce: "short",
      }),
    ).toThrow();
    expect(
      kioskHeartbeatPayloadSchema.parse({
        appVersion: "0.1.0",
        protocolVersion: 1,
        platformCategory: "tablet",
      }),
    ).toBeTruthy();
  });

  it("keeps PIN values out of readiness snapshots", () => {
    expect(
      kioskPinSetupPayloadSchema.parse({
        staffId: "fictional-staff-1",
        temporaryPin: "4826",
      }),
    ).toBeTruthy();
    const snapshot = kioskSnapshotSchema.parse({
      availableSites: [
        {
          siteId: "71000000-0000-4000-8000-000000000001",
          displayName: "Atlas Central",
        },
      ],
      registration: null,
      device: null,
      readiness: {
        complete: false,
        registrationReady: false,
        deviceActive: false,
        bindingValid: false,
        heartbeatRecent: false,
        rosterVerified: false,
        eligibleStaffCount: 1,
        pinReadyStaffCount: 0,
        offlineDisabled: true,
        offlineAuthorisationCount: 0,
      },
      staff: [
        {
          staffId: "fictional-staff-1",
          displayName: "Taylor Example",
          siteAssigned: true,
          attendanceEligible: true,
          pinRequired: true,
          pinReady: false,
          visibleOnKiosk: false,
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/temporaryPin|pinHash|pinValue/i);
  });

  it("validates kiosk commands through the versioned onboarding envelope", () => {
    expect(
      onboardingBootstrapCommandSchema.parse({
        schemaVersion: 1,
        workflowKey: "commercial_customer_v1",
        workflowVersion: 1,
        sessionId: "71000000-0000-4000-8000-000000000001",
        commandType: "start_kiosk_registration",
        idempotencyKey: "71000000-0000-4000-8000-000000000002",
        expectedSessionRevision: "8",
        payload: {
          siteId: "71000000-0000-4000-8000-000000000003",
          deviceName: "Reception",
        },
      }).payload,
    ).toEqual({
      siteId: "71000000-0000-4000-8000-000000000003",
      deviceName: "Reception",
    });
  });
});
