import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteOfflineDatabase,
  enqueueAttendanceAction,
  getSyncReceipt,
  listPendingActions,
  putTrustedState,
} from "@/lib/kiosk/offline/database";
import { createOfflineSyncWorker } from "@/lib/kiosk/offline/sync";
import type {
  OfflineSyncResponse,
  TrustedAttendanceState,
  UnsignedPendingAction,
} from "@/lib/kiosk/offline/types";

function trustedState(staffId: string): TrustedAttendanceState {
  return {
    staffId,
    rosterVersion: "roster-1",
    trustedAt: "2026-07-30T09:00:00Z",
    state: {
      state: "clocked_out",
      operationalDate: "2026-07-30",
      currentEvent: null,
      unresolvedExceptions: [],
      allowedActions: ["clock_in"],
      warnings: [],
      revision: `revision-${staffId}`,
      evaluatedAt: "2026-07-30T09:00:00Z",
    },
  };
}

function action(
  staffId: string,
  overrides: Partial<UnsignedPendingAction> = {},
): UnsignedPendingAction {
  return {
    idempotencyKey: crypto.randomUUID(),
    authorisationId: "authorisation-1",
    rosterVersion: "roster-1",
    deviceId: "device-1",
    staffId,
    action: "clock_in",
    occurredAtDevice: "2026-07-30T09:00:00Z",
    deviceTimezone: "Europe/London",
    operationalDateAtDevice: "2026-07-30",
    trustedSnapshotRevision: `revision-${staffId}`,
    priorPendingActionId: null,
    unresolvedOlderException: false,
    signature: "signed-payload",
    ...overrides,
  };
}

function response(
  idempotencyKey: string,
  staffId: string,
  outcome: OfflineSyncResponse["outcome"] = "synced",
): OfflineSyncResponse {
  return {
    outcome,
    receipt: {
      schemaVersion: 1,
      idempotencyKey,
      outcome: outcome === "conflicted" ? "conflicted" : "synced",
      receivedAtServer: "2026-07-30T09:01:00Z",
      retainedUntil: "2026-08-29T09:01:00Z",
    },
    trustedState: trustedState(staffId),
  };
}

beforeEach(async () => {
  await deleteOfflineDatabase();
  await putTrustedState(trustedState("staff-a"));
  await putTrustedState(trustedState("staff-b"));
});

afterEach(async () => {
  await deleteOfflineDatabase();
});

describe("offline kiosk synchronisation worker", () => {
  it("shares one single-flight worker across foreground triggers", async () => {
    const queued = await enqueueAttendanceAction(action("staff-a"));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.fn(async () => {
      await blocked;
      return response(queued.idempotencyKey, "staff-a");
    });
    const worker = createOfflineSyncWorker({ send, ownerId: "worker-1" });

    const launch = worker.sync("launch");
    const online = worker.sync("online");
    const visibility = worker.sync("visibility");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release();

    const results = await Promise.all([launch, online, visibility]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      expect.objectContaining({ synced: 1 }),
      expect.objectContaining({ synced: 1 }),
      expect.objectContaining({ synced: 1 }),
    ]);
  });

  it("uses an IndexedDB lease to prevent another worker instance overlapping", async () => {
    const queued = await enqueueAttendanceAction(action("staff-a"));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstSend = vi.fn(async () => {
      await blocked;
      return response(queued.idempotencyKey, "staff-a");
    });
    const secondSend = vi.fn();
    const firstWorker = createOfflineSyncWorker({
      send: firstSend,
      ownerId: "worker-1",
    });
    const secondWorker = createOfflineSyncWorker({
      send: secondSend,
      ownerId: "worker-2",
    });

    const firstRun = firstWorker.sync("launch");
    await vi.waitFor(() => expect(firstSend).toHaveBeenCalledTimes(1));
    const secondRun = await secondWorker.sync("background");

    expect(secondRun.leaseUnavailable).toBe(true);
    expect(secondSend).not.toHaveBeenCalled();
    release();
    await firstRun;
  });

  it("sends actions in device sequence and per-staff order", async () => {
    const first = await enqueueAttendanceAction(action("staff-a"));
    const second = await enqueueAttendanceAction(action("staff-b"));
    const third = await enqueueAttendanceAction(
      action("staff-a", {
        action: "clock_out",
        priorPendingActionId: first.idempotencyKey,
      }),
    );
    const sent: string[] = [];
    const worker = createOfflineSyncWorker({
      ownerId: "worker-1",
      send: async (queued) => {
        sent.push(queued.idempotencyKey);
        return response(queued.idempotencyKey, queued.staffId);
      },
    });

    await worker.sync("manual");

    expect(sent).toEqual([
      first.idempotencyKey,
      second.idempotencyKey,
      third.idempotencyKey,
    ]);
  });

  it("stops after network loss and leaves that action and later actions pending", async () => {
    const first = await enqueueAttendanceAction(action("staff-a"));
    const second = await enqueueAttendanceAction(action("staff-b"));
    const third = await enqueueAttendanceAction(action("staff-a"));
    const send = vi
      .fn()
      .mockResolvedValueOnce(response(first.idempotencyKey, "staff-a"))
      .mockRejectedValueOnce(new TypeError("network offline"));
    const worker = createOfflineSyncWorker({ send, ownerId: "worker-1" });

    const summary = await worker.sync("online");

    expect(summary).toEqual(
      expect.objectContaining({ synced: 1, retryableFailures: 1 }),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      (await listPendingActions({ includeDefinitive: true })).map(
        (queued) => [queued.idempotencyKey, queued.status],
      ),
    ).toEqual([
      [first.idempotencyKey, "synced"],
      [second.idempotencyKey, "pending"],
      [third.idempotencyKey, "pending"],
    ]);
  });

  it("recovers a lost accepted response with the unchanged UUID", async () => {
    const queued = await enqueueAttendanceAction(action("staff-a"));
    const observed: string[] = [];
    let attempt = 0;
    const worker = createOfflineSyncWorker({
      ownerId: "worker-1",
      send: async (pendingAction) => {
        observed.push(pendingAction.idempotencyKey);
        attempt += 1;
        if (attempt === 1) {
          throw new TypeError("response lost");
        }
        return response(
          pendingAction.idempotencyKey,
          pendingAction.staffId,
          "already_processed",
        );
      },
    });

    await worker.sync("online");
    await worker.sync("manual");

    expect(observed).toEqual([
      queued.idempotencyKey,
      queued.idempotencyKey,
    ]);
    expect(await getSyncReceipt(queued.idempotencyKey)).toEqual(
      expect.objectContaining({ idempotencyKey: queued.idempotencyKey }),
    );
  });

  it("stores a durable receipt before a synced payload becomes definitive", async () => {
    const queued = await enqueueAttendanceAction(action("staff-a"));
    const worker = createOfflineSyncWorker({
      ownerId: "worker-1",
      send: async (pendingAction) =>
        response(pendingAction.idempotencyKey, pendingAction.staffId),
    });

    await worker.sync("background");

    expect(await getSyncReceipt(queued.idempotencyKey)).not.toBeNull();
    expect(await listPendingActions({ includeDefinitive: true })).toEqual([
      expect.objectContaining({ status: "synced" }),
    ]);
  });

  it("continues another staff stream after preserving a conflict", async () => {
    const conflicted = await enqueueAttendanceAction(action("staff-a"));
    const accepted = await enqueueAttendanceAction(action("staff-b"));
    const worker = createOfflineSyncWorker({
      ownerId: "worker-1",
      send: async (queued) =>
        response(
          queued.idempotencyKey,
          queued.staffId,
          queued.staffId === "staff-a" ? "conflicted" : "synced",
        ),
    });

    const summary = await worker.sync("periodic");

    expect(summary).toEqual(
      expect.objectContaining({ synced: 1, conflicted: 1 }),
    );
    expect(
      (await listPendingActions({ includeDefinitive: true })).map(
        (queued) => [queued.idempotencyKey, queued.status],
      ),
    ).toEqual([
      [conflicted.idempotencyKey, "conflicted"],
      [accepted.idempotencyKey, "synced"],
    ]);
  });
});
