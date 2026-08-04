import { describe, expect, it } from "vitest";
import {
  offlineSyncRequestSchema,
  payloadForOfflineSignature,
} from "@/lib/kiosk/offline/server-contract";
import { toOfflineSyncRequest } from "@/lib/kiosk/offline/sync";

function request() {
  return {
    schemaVersion: 1,
    idempotencyKey: "d6825598-678a-4e06-9be5-803167bbf921",
    authorisationId: "57dd448a-2480-4122-aa2e-3293155b7a1e",
    rosterVersion: "fb15c29e3f4b15f597781b085a71e466f6f95bb751e9729aa9041f328b57e211",
    deviceId: "e2619d08-63aa-44ba-957a-71f149a0783a",
    staffId: "staff-a",
    action: "clock_in",
    occurredAtDevice: "2026-08-03T19:30:00.000Z",
    deviceTimezone: "Europe/London",
    operationalDateAtDevice: "2026-08-03",
    deviceSequence: 1,
    queueCreatedAt: "2026-08-03T19:30:01.000Z",
    trustedSnapshotRevision: "revision-a",
    priorPendingActionId: null,
    unresolvedOlderException: false,
    clockConfidence: "anchored",
    elapsedSinceAuthorisationMs: 1_800_000,
    signature: "c2lnbmF0dXJl",
  } as const;
}

describe("offline synchronisation contract", () => {
  it("allows only explicit actions and Europe/London device evidence", () => {
    expect(offlineSyncRequestSchema.parse(request())).toEqual(request());
    expect(() => offlineSyncRequestSchema.parse({ ...request(), action: "toggle" })).toThrow();
    expect(() => offlineSyncRequestSchema.parse({ ...request(), deviceTimezone: "UTC" })).toThrow();
  });

  it("requires an elapsed clock anchor when confidence is anchored", () => {
    expect(() => offlineSyncRequestSchema.parse({
      ...request(),
      elapsedSinceAuthorisationMs: null,
    })).toThrow(/elapsed/i);
    expect(offlineSyncRequestSchema.parse({
      ...request(),
      clockConfidence: "uncertain",
      elapsedSinceAuthorisationMs: null,
    })).toEqual(expect.objectContaining({ clockConfidence: "uncertain" }));
  });

  it("signs every immutable identity field but never the signature itself", () => {
    const payload = payloadForOfflineSignature(request());

    expect(payload).toEqual(expect.objectContaining({
      deviceId: request().deviceId,
      staffId: "staff-a",
      action: "clock_in",
      deviceSequence: 1,
      clockConfidence: "anchored",
    }));
    expect(payload).not.toHaveProperty("signature");
  });

  it("submits the immutable signed evidence without local retry state", () => {
    const submission = toOfflineSyncRequest({
      ...request(),
      status: "pending",
      retryCount: 3,
      lastErrorCategory: "network_or_server",
    });

    expect(submission).toEqual(request());
    expect(submission).not.toHaveProperty("status");
    expect(submission).not.toHaveProperty("retryCount");
    expect(submission).not.toHaveProperty("lastErrorCategory");
  });
});
