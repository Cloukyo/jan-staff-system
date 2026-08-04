import { describe, expect, it } from "vitest";
import {
  OFFLINE_AUTHORISATION_HOURS,
  OFFLINE_CLOCK_DRIFT_SECONDS,
  OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS,
  OFFLINE_PIN_MAX_FAILURES,
  OFFLINE_RECEIPT_RETENTION_DAYS,
  dispositionForSyncOutcome,
  resolveOfflineCapability,
} from "@/lib/kiosk/offline/types";

describe("offline kiosk capability policy", () => {
  it("uses the approved central security limits", () => {
    expect(OFFLINE_AUTHORISATION_HOURS).toBe(24);
    expect(OFFLINE_CLOCK_DRIFT_SECONDS).toBe(300);
    expect(OFFLINE_PIN_MAX_FAILURES).toBe(3);
    expect(OFFLINE_RECEIPT_RETENTION_DAYS).toBe(30);
    expect(OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS).toBe(7);
  });

  it("denies offline clocking when the feature flag is disabled", () => {
    expect(
      resolveOfflineCapability({
        offlineEnabled: false,
        hardwareVerifiedAt: "2026-07-30T08:00:00Z",
        revokedAt: null,
        refreshRequired: false,
        clientSchemaVersion: 1,
        acceptedSchemaVersion: 1,
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "2026-07-31T09:00:00Z",
        now: "2026-07-30T09:00:00Z",
      }),
    ).toEqual({ status: "disabled", reason: "feature_flag" });
  });

  it("denies offline clocking when hardware validation has not passed", () => {
    expect(
      resolveOfflineCapability({
        offlineEnabled: true,
        hardwareVerifiedAt: null,
        revokedAt: null,
        refreshRequired: false,
        clientSchemaVersion: 1,
        acceptedSchemaVersion: 1,
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "2026-07-31T09:00:00Z",
        now: "2026-07-30T09:00:00Z",
      }),
    ).toEqual({ status: "disabled", reason: "hardware_unverified" });
  });

  it("preserves an expired authorisation while denying new actions", () => {
    expect(
      resolveOfflineCapability({
        offlineEnabled: true,
        hardwareVerifiedAt: "2026-07-30T08:00:00Z",
        revokedAt: null,
        refreshRequired: false,
        clientSchemaVersion: 1,
        acceptedSchemaVersion: 1,
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "2026-07-30T08:59:59Z",
        now: "2026-07-30T09:00:00Z",
      }),
    ).toEqual({
      status: "expired",
      expiresAt: "2026-07-30T08:59:59Z",
    });
  });

  it("treats exact expiry as expired", () => {
    expect(
      resolveOfflineCapability({
        offlineEnabled: true,
        hardwareVerifiedAt: "2026-07-30T08:00:00Z",
        revokedAt: null,
        refreshRequired: false,
        clientSchemaVersion: 1,
        acceptedSchemaVersion: 1,
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "2026-07-30T09:00:00Z",
        now: "2026-07-30T09:00:00Z",
      }).status,
    ).toBe("expired");
  });

  it("returns an active server-issued authorisation when every gate passes", () => {
    expect(
      resolveOfflineCapability({
        offlineEnabled: true,
        hardwareVerifiedAt: "2026-07-30T08:00:00Z",
        revokedAt: null,
        refreshRequired: false,
        clientSchemaVersion: 1,
        acceptedSchemaVersion: 1,
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "2026-07-31T09:00:00Z",
        now: "2026-07-30T09:00:00Z",
      }),
    ).toEqual({
      status: "active",
      authorisationId: "authorisation-1",
      rosterVersion: "roster-1",
      expiresAt: "2026-07-31T09:00:00Z",
    });
  });

  it("rejects invalid timestamps instead of trusting the client clock", () => {
    expect(() =>
      resolveOfflineCapability({
        offlineEnabled: true,
        hardwareVerifiedAt: "2026-07-30T08:00:00Z",
        revokedAt: null,
        refreshRequired: false,
        clientSchemaVersion: 1,
        acceptedSchemaVersion: 1,
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "not-a-date",
        now: "2026-07-30T09:00:00Z",
      }),
    ).toThrow(/valid timestamp/i);
  });

  it("warns when an otherwise active authorisation is within two hours of expiry", () => {
    expect(resolveOfflineCapability({
      offlineEnabled: true,
      hardwareVerifiedAt: "2026-07-30T08:00:00Z",
      revokedAt: null,
      refreshRequired: false,
      clientSchemaVersion: 1,
      acceptedSchemaVersion: 1,
      authorisationId: "authorisation-1",
      rosterVersion: "roster-1",
      expiresAt: "2026-07-30T10:30:00Z",
      now: "2026-07-30T09:00:00Z",
    })).toEqual(expect.objectContaining({ status: "expiring" }));
  });

  it.each([
    [{ revokedAt: "2026-07-30T08:30:00Z" }, "revoked"],
    [{ refreshRequired: true }, "refresh_required"],
    [{ clientSchemaVersion: 2 }, "schema_incompatible"],
  ] as const)("returns %s lifecycle state", (override, expected) => {
    expect(resolveOfflineCapability({
      offlineEnabled: true,
      hardwareVerifiedAt: "2026-07-30T08:00:00Z",
      revokedAt: null,
      refreshRequired: false,
      clientSchemaVersion: 1,
      acceptedSchemaVersion: 1,
      authorisationId: "authorisation-1",
      rosterVersion: "roster-1",
      expiresAt: "2026-07-31T09:00:00Z",
      now: "2026-07-30T09:00:00Z",
      ...override,
    }).status).toBe(expected);
  });
});

describe("offline sync result policy", () => {
  it.each([
    ["accepted", { complete: true, retry: false, managerReview: false, blocksStaffStream: false }],
    ["accepted_with_warning", { complete: true, retry: false, managerReview: true, blocksStaffStream: false }],
    ["state_conflict", { complete: true, retry: false, managerReview: true, blocksStaffStream: true }],
    ["roster_outdated", { complete: false, retry: true, managerReview: false, blocksStaffStream: true, refreshRoster: true }],
    ["device_revoked", { complete: true, retry: false, managerReview: true, blocksStaffStream: true, reprovision: true }],
    ["retryable_failure", { complete: false, retry: true, managerReview: false, blocksStaffStream: true }],
  ] as const)("defines durable handling for %s", (outcome, expected) => {
    expect(dispositionForSyncOutcome(outcome)).toEqual(expect.objectContaining(expected));
  });
});
