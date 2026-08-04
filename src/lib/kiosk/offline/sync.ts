import {
  acquireSyncLease,
  listPendingActions,
  markPendingActionRetryable,
  markPendingActionSyncing,
  persistSyncReceipt,
  releaseSyncLease,
  resetInterruptedSyncActions,
} from "@/lib/kiosk/offline/database";
import type {
  OfflineSyncResponse,
  OfflineSyncSummary,
  OfflineSyncTrigger,
  PendingAttendanceAction,
} from "@/lib/kiosk/offline/types";
import { dispositionForSyncOutcome } from "@/lib/kiosk/offline/types";
import type { OfflineSyncRequest } from "@/lib/kiosk/offline/server-contract";

type OfflineSyncTransport = (
  action: PendingAttendanceAction,
) => Promise<OfflineSyncResponse>;

type OfflineSyncWorker = {
  sync(trigger: OfflineSyncTrigger): Promise<OfflineSyncSummary>;
};

function emptySummary(trigger: OfflineSyncTrigger): OfflineSyncSummary {
  return {
    trigger,
    attempted: 0,
    synced: 0,
    conflicted: 0,
    rejected: 0,
    retryableFailures: 0,
    rosterRefreshRequired: false,
    reprovisionRequired: false,
    leaseUnavailable: false,
  };
}

async function defaultTransport(
  action: PendingAttendanceAction,
): Promise<OfflineSyncResponse> {
  const response = await fetch("/api/kiosk/offline/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(toOfflineSyncRequest(action)),
  });
  if (!response.ok) {
    throw new Error(`Offline sync failed with status ${response.status}`);
  }
  return (await response.json()) as OfflineSyncResponse;
}

export function toOfflineSyncRequest(
  action: PendingAttendanceAction,
): OfflineSyncRequest {
  return {
    schemaVersion: action.schemaVersion,
    idempotencyKey: action.idempotencyKey,
    authorisationId: action.authorisationId,
    rosterVersion: action.rosterVersion,
    deviceId: action.deviceId,
    staffId: action.staffId,
    action: action.action,
    occurredAtDevice: action.occurredAtDevice,
    deviceTimezone: action.deviceTimezone as "Europe/London",
    operationalDateAtDevice: action.operationalDateAtDevice,
    deviceSequence: action.deviceSequence,
    queueCreatedAt: action.queueCreatedAt,
    trustedSnapshotRevision: action.trustedSnapshotRevision,
    priorPendingActionId: action.priorPendingActionId,
    unresolvedOlderException: action.unresolvedOlderException,
    clockConfidence: action.clockConfidence,
    elapsedSinceAuthorisationMs: action.elapsedSinceAuthorisationMs,
    signature: action.signature,
  };
}

export function createOfflineSyncWorker(input: {
  send: OfflineSyncTransport;
  ownerId?: string;
  now?: () => string;
}): OfflineSyncWorker {
  const ownerId = input.ownerId ?? crypto.randomUUID();
  const now = input.now ?? (() => new Date().toISOString());
  let inFlight: Promise<OfflineSyncSummary> | null = null;

  async function run(
    trigger: OfflineSyncTrigger,
  ): Promise<OfflineSyncSummary> {
    const summary = emptySummary(trigger);
    const hasLease = await acquireSyncLease({ ownerId, now: now() });
    if (!hasLease) {
      summary.leaseUnavailable = true;
      return summary;
    }

    try {
      await resetInterruptedSyncActions();
      const actions = (await listPendingActions({ includeDefinitive: true }))
        .filter((action) => action.status === "pending")
        .sort(
          (left, right) =>
            left.deviceSequence - right.deviceSequence ||
            left.occurredAtDevice.localeCompare(right.occurredAtDevice) ||
            left.queueCreatedAt.localeCompare(right.queueCreatedAt),
        );
      const blockedStaff = new Set<string>();

      for (const action of actions) {
        if (blockedStaff.has(action.staffId)) continue;
        summary.attempted += 1;
        await markPendingActionSyncing(action.idempotencyKey);

        let response: OfflineSyncResponse;
        try {
          response = await input.send(action);
        } catch {
          await markPendingActionRetryable(
            action.idempotencyKey,
            "network_or_server",
          );
          summary.retryableFailures += 1;
          blockedStaff.add(action.staffId);
          continue;
        }

        if (
          response.receipt.idempotencyKey !== action.idempotencyKey ||
          response.trustedState.staffId !== action.staffId
        ) {
          await markPendingActionRetryable(
            action.idempotencyKey,
            "invalid_response_identity",
          );
          summary.retryableFailures += 1;
          blockedStaff.add(action.staffId);
          continue;
        }

        const disposition = dispositionForSyncOutcome(response.outcome);
        summary.rosterRefreshRequired ||= disposition.refreshRoster;
        summary.reprovisionRequired ||= disposition.reprovision;

        if (!disposition.complete) {
          await markPendingActionRetryable(action.idempotencyKey, response.outcome);
          if (disposition.retry) summary.retryableFailures += 1;
          if (disposition.blocksStaffStream) blockedStaff.add(action.staffId);
          continue;
        }

        if (["accepted", "accepted_with_warning", "already_processed"].includes(response.outcome)) {
          await persistSyncReceipt({
            actionId: action.idempotencyKey,
            definitiveStatus: "synced",
            receipt: response.receipt,
            trustedState: response.trustedState,
          });
          summary.synced += 1;
          continue;
        }

        if (disposition.managerReview) {
          await persistSyncReceipt({
            actionId: action.idempotencyKey,
            definitiveStatus: "conflicted",
            receipt: response.receipt,
            trustedState: response.trustedState,
          });
          summary.conflicted += 1;
          if (disposition.blocksStaffStream) blockedStaff.add(action.staffId);
          continue;
        }

        await persistSyncReceipt({
          actionId: action.idempotencyKey,
          definitiveStatus: "rejected",
          receipt: response.receipt,
          trustedState: response.trustedState,
        });
        summary.rejected += 1;
      }
    } finally {
      await releaseSyncLease(ownerId);
    }

    return summary;
  }

  return {
    sync(trigger) {
      if (inFlight) {
        return inFlight;
      }
      inFlight = run(trigger).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

let defaultWorker: OfflineSyncWorker | null = null;

export function syncPendingActions(
  trigger: OfflineSyncTrigger,
): Promise<OfflineSyncSummary> {
  defaultWorker ??= createOfflineSyncWorker({ send: defaultTransport });
  return defaultWorker.sync(trigger);
}
