import { describe, expect, it } from "vitest";
import {
  OFFLINE_AUTHORISATION_HOURS,
  OFFLINE_CLOCK_DRIFT_SECONDS,
  OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS,
  OFFLINE_PIN_MAX_FAILURES,
  OFFLINE_RECEIPT_RETENTION_DAYS,
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
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "2026-07-30T09:00:00Z",
        now: "2026-07-30T09:00:00Z",
      }).status,
    ).toBe("expired");
  });

  it("returns the server-issued authorisation when every gate passes", () => {
    expect(
      resolveOfflineCapability({
        offlineEnabled: true,
        hardwareVerifiedAt: "2026-07-30T08:00:00Z",
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "2026-07-31T09:00:00Z",
        now: "2026-07-30T09:00:00Z",
      }),
    ).toEqual({
      status: "ready",
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
        authorisationId: "authorisation-1",
        rosterVersion: "roster-1",
        expiresAt: "not-a-date",
        now: "2026-07-30T09:00:00Z",
      }),
    ).toThrow(/valid timestamp/i);
  });
});
