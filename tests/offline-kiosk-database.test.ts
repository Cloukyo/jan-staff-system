import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupOfflineData,
  closeOfflineDatabase,
  deleteOfflineDatabase,
  enqueueAttendanceAction,
  getActiveRoster,
  getDeviceKeys,
  getOfflinePinLockout,
  getOfflinePinVerifier,
  getSyncReceipt,
  getTrustedState,
  listPendingActions,
  persistSyncReceipt,
  putOfflinePinLockout,
  putOfflinePinVerifier,
  putTrustedState,
  replaceRosterAtomically,
  resetOfflineDatabaseSafely,
  OFFLINE_DB_VERSION,
  saveDeviceKeys,
} from "@/lib/kiosk/offline/database";
import {
  createDeviceKeys,
  createOfflinePinLockout,
  enrolOfflinePin,
  signOfflinePayload,
} from "@/lib/kiosk/offline/crypto";
import { buildProvisionalState } from "@/lib/kiosk/offline/projection";
import type {
  OfflineRosterSnapshot,
  TrustedAttendanceState,
  UnsignedPendingAction,
} from "@/lib/kiosk/offline/types";

function roster(
  version: string,
  entries: OfflineRosterSnapshot["entries"],
): OfflineRosterSnapshot {
  return {
    schemaVersion: 1,
    rosterVersion: version,
    authorisationId: "authorisation-1",
    issuedAt: "2026-07-30T08:00:00Z",
    expiresAt: "2026-07-31T08:00:00Z",
    serverTime: "2026-07-30T08:00:00Z",
    entries,
  };
}

function trustedState(
  staffId = "staff-a",
  state: TrustedAttendanceState["state"]["state"] = "clocked_out",
): TrustedAttendanceState {
  return {
    staffId,
    rosterVersion: "roster-1",
    trustedAt: "2026-07-30T08:00:00Z",
    state: {
      state,
      operationalDate: "2026-07-30",
      currentEvent: null,
      unresolvedExceptions: [],
      allowedActions: state === "clocked_out" ? ["clock_in"] : ["clock_out"],
      warnings: [],
      revision: `revision-${staffId}`,
      evaluatedAt: "2026-07-30T08:00:00Z",
    },
  };
}

function pending(
  overrides: Partial<UnsignedPendingAction> = {},
): UnsignedPendingAction {
  return {
    idempotencyKey: crypto.randomUUID(),
    authorisationId: "authorisation-1",
    rosterVersion: "roster-1",
    deviceId: "device-1",
    staffId: "staff-a",
    action: "clock_in",
    occurredAtDevice: "2026-07-30T08:30:00Z",
    deviceTimezone: "Europe/London",
    operationalDateAtDevice: "2026-07-30",
    trustedSnapshotRevision: "revision-staff-a",
    priorPendingActionId: null,
    unresolvedOlderException: false,
    signature: "signed-payload",
    ...overrides,
  };
}

beforeEach(async () => {
  await deleteOfflineDatabase();
});

afterEach(async () => {
  await deleteOfflineDatabase();
});

describe("offline kiosk IndexedDB", () => {
  it("uses schema version 2 and preserves a version 1 pending action during upgrade", async () => {
    expect(OFFLINE_DB_VERSION).toBe(2);
    const legacy = pending();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("jan-staff-clock", 1);
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore("metadata", { keyPath: "key" });
        request.result.createObjectStore("pendingActions", { keyPath: "idempotencyKey" })
          .add({ ...legacy, schemaVersion: 1, deviceSequence: 1, queueCreatedAt: "2026-07-30T08:31:00Z", status: "pending", retryCount: 0, lastErrorCategory: null });
      });
      request.addEventListener("success", () => {
        request.result.close();
        resolve();
      });
      request.addEventListener("error", () => reject(request.error));
    });

    expect(await listPendingActions()).toEqual([
      expect.objectContaining({
        idempotencyKey: legacy.idempotencyKey,
        schemaVersion: 1,
        status: "pending",
        clockConfidence: "uncertain",
        elapsedSinceAuthorisationMs: null,
      }),
    ]);
  });

  it("keeps the old roster active when replacement fails atomically", async () => {
    await replaceRosterAtomically(
      roster("roster-1", [
        {
          staffId: "staff-a",
          displayName: "Areeg",
          employmentRole: "Practitioner",
          offlineReady: true,
        },
      ]),
    );

    await expect(
      replaceRosterAtomically(
        roster("roster-2", [
          {
            staffId: "staff-b",
            displayName: "Maya",
            employmentRole: "Practitioner",
            offlineReady: true,
          },
          {
            staffId: "staff-b",
            displayName: "Duplicate",
            employmentRole: "Practitioner",
            offlineReady: false,
          },
        ]),
      ),
    ).rejects.toBeTruthy();

    expect(await getActiveRoster()).toEqual(
      expect.objectContaining({
        rosterVersion: "roster-1",
        entries: [
          expect.objectContaining({
            staffId: "staff-a",
            displayName: "Areeg",
          }),
        ],
      }),
    );
  });

  it("keeps pending actions after database close and reopen", async () => {
    const queued = await enqueueAttendanceAction(pending());
    await closeOfflineDatabase();

    expect(await listPendingActions()).toEqual([
      expect.objectContaining({
        idempotencyKey: queued.idempotencyKey,
        status: "pending",
        retryCount: 0,
      }),
    ]);
  });

  it("builds provisional state without mutating the trusted snapshot", async () => {
    const trusted = trustedState();
    await putTrustedState(trusted);
    await enqueueAttendanceAction(pending());

    const provisional = await buildProvisionalState("staff-a");

    expect(provisional.state).toBe("clocked_in");
    expect(provisional.allowedActions).toEqual(["clock_out"]);
    expect(await getTrustedState("staff-a")).toEqual(trusted);
  });

  it("assigns one global device sequence and retains per-staff order", async () => {
    const first = await enqueueAttendanceAction(
      pending({ staffId: "staff-a", action: "clock_in" }),
    );
    const second = await enqueueAttendanceAction(
      pending({
        staffId: "staff-b",
        action: "clock_in",
        trustedSnapshotRevision: "revision-staff-b",
      }),
    );
    const third = await enqueueAttendanceAction(
      pending({
        staffId: "staff-a",
        action: "clock_out",
        priorPendingActionId: first.idempotencyKey,
      }),
    );

    expect([
      first.deviceSequence,
      second.deviceSequence,
      third.deviceSequence,
    ]).toEqual([1, 2, 3]);
    expect(
      (await listPendingActions())
        .filter((action) => action.staffId === "staff-a")
        .map((action) => action.idempotencyKey),
    ).toEqual([first.idempotencyKey, third.idempotencyKey]);
  });

  it("commits receipt, trusted state, and definitive queue status together", async () => {
    const queued = await enqueueAttendanceAction(pending());
    const nextTrusted = trustedState("staff-a", "clocked_in");

    await persistSyncReceipt({
      actionId: queued.idempotencyKey,
      definitiveStatus: "synced",
      receipt: {
        schemaVersion: 1,
        idempotencyKey: queued.idempotencyKey,
        outcome: "synced",
        receivedAtServer: "2026-07-30T08:31:00Z",
        retainedUntil: "2026-08-29T08:31:00Z",
      },
      trustedState: nextTrusted,
    });

    expect(await getSyncReceipt(queued.idempotencyKey)).toEqual(
      expect.objectContaining({ outcome: "synced" }),
    );
    expect(await getTrustedState("staff-a")).toEqual(nextTrusted);
    expect(await listPendingActions({ includeDefinitive: true })).toEqual([
      expect.objectContaining({ status: "synced" }),
    ]);
  });

  it("retains version 1 actions after closing and reopening the schema", async () => {
    const queued = await enqueueAttendanceAction(pending());
    await closeOfflineDatabase();

    expect(await listPendingActions()).toContainEqual(
      expect.objectContaining({
        schemaVersion: 1,
        idempotencyKey: queued.idempotencyKey,
      }),
    );
  });

  it("routine cleanup never removes pending or conflicted evidence", async () => {
    const pendingAction = await enqueueAttendanceAction(
      pending({ occurredAtDevice: "2026-06-01T08:30:00Z" }),
    );
    const conflictAction = await enqueueAttendanceAction(
      pending({ occurredAtDevice: "2026-06-01T09:00:00Z" }),
    );
    await persistSyncReceipt({
      actionId: conflictAction.idempotencyKey,
      definitiveStatus: "conflicted",
      receipt: {
        schemaVersion: 1,
        idempotencyKey: conflictAction.idempotencyKey,
        outcome: "conflicted",
        receivedAtServer: "2026-06-01T09:01:00Z",
        retainedUntil: "2026-07-01T09:01:00Z",
      },
      trustedState: trustedState(),
    });

    await cleanupOfflineData("2026-07-30T09:00:00Z");

    expect(
      (await listPendingActions({ includeDefinitive: true })).map(
        (action) => action.idempotencyKey,
      ),
    ).toEqual([pendingAction.idempotencyKey, conflictAction.idempotencyKey]);
  });

  it("refuses a normal local reset while unsynchronised evidence exists", async () => {
    const queued = await enqueueAttendanceAction(pending());

    const result = await resetOfflineDatabaseSafely({
      managerAuthorised: false,
      reason: "",
    });

    expect(result).toEqual(expect.objectContaining({ status: "blocked", pendingCount: 1 }));
    expect(await listPendingActions()).toEqual([
      expect.objectContaining({ idempotencyKey: queued.idempotencyKey }),
    ]);
  });

  it("stores no PIN, PIN hash, hourly rate, or salary fields in roster and actions", async () => {
    await replaceRosterAtomically(
      roster("roster-1", [
        {
          staffId: "staff-a",
          displayName: "Areeg",
          employmentRole: "Practitioner",
          offlineReady: true,
        },
      ]),
    );
    await enqueueAttendanceAction(pending());

    const serialised = JSON.stringify({
      roster: await getActiveRoster(),
      actions: await listPendingActions({ includeDefinitive: true }),
    });

    expect(serialised).not.toMatch(/pin|pin_hash|hourly|salary/i);
  });

  it("persists non-extractable device keys and authenticated verifier records", async () => {
    const keys = await createDeviceKeys();
    const envelope = await enrolOfflinePin({
      pin: "482731",
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      expiresAt: "2026-07-31T09:00:00Z",
      verifierKey: keys.verifierKey,
    });
    const lockout = await createOfflinePinLockout({
      staffId: "staff-a",
      authorisationId: "authorisation-1",
      verifierKey: keys.verifierKey,
      updatedAt: "2026-07-30T09:00:00Z",
    });
    await saveDeviceKeys(keys);
    await putOfflinePinVerifier(envelope);
    await putOfflinePinLockout(lockout);
    await closeOfflineDatabase();

    const restored = await getDeviceKeys();
    expect(restored?.signingPrivateKey.extractable).toBe(false);
    expect(restored?.verifierKey.extractable).toBe(false);
    await expect(
      signOfflinePayload({ action: "clock_in" }, restored!.signingPrivateKey),
    ).resolves.toEqual(expect.any(String));
    expect(
      await getOfflinePinVerifier("staff-a", "authorisation-1"),
    ).toEqual(envelope);
    expect(await getOfflinePinLockout("staff-a", "authorisation-1")).toEqual(
      lockout,
    );
  });
});
