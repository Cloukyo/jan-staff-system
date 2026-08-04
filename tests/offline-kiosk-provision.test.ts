import { describe, expect, it } from "vitest";
import {
  offlineProvisionRequestSchema,
  offlineProvisionDatabaseResponseSchema,
  offlineProvisioningPackageSchema,
} from "@/lib/kiosk/offline/server-contract";

const validPublicKey = {
  kty: "EC",
  crv: "P-256",
  x: "jIY0HwK-O9ZM18PsBvV49yS1jlvUV3K8ONHODF-8rE0",
  y: "NQYu9Nv3R67XS0WEnyIdmV8MFrqN4ddVW2fDKfZo8eY",
};

describe("offline kiosk provisioning contract", () => {
  it("accepts only the supported schema and a P-256 device signing key", () => {
    expect(offlineProvisionRequestSchema.parse({
      schemaVersion: 1,
      appVersion: "0.1.0",
      deviceTime: "2026-08-03T19:00:00.000Z",
      signingPublicJwk: validPublicKey,
    })).toEqual(expect.objectContaining({ schemaVersion: 1 }));

    expect(() => offlineProvisionRequestSchema.parse({
      schemaVersion: 1,
      appVersion: "0.1.0",
      deviceTime: "2026-08-03T19:00:00.000Z",
      signingPublicJwk: { ...validPublicKey, kty: "RSA" },
    })).toThrow();
  });

  it("accepts the minimum package without private staff or pay data", () => {
    const packageValue = {
      schemaVersion: 1,
      featureEnabled: true,
      device: { id: "746cbd28-b1fa-4765-b874-4631b8b0cf47", name: "Front tablet" },
      authorisation: {
        id: "4053cc19-27ec-4274-9a26-3d8dcf5b788e",
        issuedAt: "2026-08-03T19:00:00.000Z",
        expiresAt: "2026-08-04T19:00:00.000Z",
        rosterVersion: "roster-v1",
      },
      server: {
        time: "2026-08-03T19:00:00.000Z",
        timezone: "Europe/London",
        operationalDayStart: "00:00",
      },
      roster: [{
        staffId: "staff-a",
        displayName: "Areeg",
        employmentRole: "Practitioner",
        pinVersion: "pin-v1",
        trustedState: {
          state: "clocked_out",
          operationalDate: "2026-08-03",
          currentEvent: null,
          unresolvedExceptions: [],
          allowedActions: ["clock_in"],
          warnings: [],
          revision: "revision-a",
          evaluatedAt: "2026-08-03T19:00:00.000Z",
        },
      }],
    };

    expect(offlineProvisioningPackageSchema.parse(packageValue)).toEqual(packageValue);
    for (const forbidden of ["pin", "pinHash", "hourlyRate", "salary", "email"]) {
      expect(() => offlineProvisioningPackageSchema.parse({ ...packageValue, [forbidden]: "secret" })).toThrow();
    }
  });

  it("rejects an authorisation longer than 24 hours", () => {
    const value = {
      schemaVersion: 1,
      featureEnabled: true,
      device: { id: "746cbd28-b1fa-4765-b874-4631b8b0cf47", name: "Front tablet" },
      authorisation: {
        id: "4053cc19-27ec-4274-9a26-3d8dcf5b788e",
        issuedAt: "2026-08-03T19:00:00.000Z",
        expiresAt: "2026-08-04T19:00:01.000Z",
        rosterVersion: "roster-v1",
      },
      server: { time: "2026-08-03T19:00:00.000Z", timezone: "Europe/London", operationalDayStart: "00:00" },
      roster: [],
    };

    expect(() => offlineProvisioningPackageSchema.parse(value)).toThrow(/24 hours/i);
  });

  it("uses typed provisioning denials without leaking database detail", () => {
    expect(offlineProvisionDatabaseResponseSchema.parse({
      ok: false,
      code: "hardware_unverified",
    })).toEqual({ ok: false, code: "hardware_unverified" });
    expect(() => offlineProvisionDatabaseResponseSchema.parse({
      ok: false,
      code: "database_error: pin_hash=secret",
    })).toThrow();
  });
});
