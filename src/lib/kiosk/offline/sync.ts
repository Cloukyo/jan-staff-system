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
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    throw new Error(`Offline sync failed with status ${response.status}`);
  }
  return (await response.json()) as OfflineSyncResponse;
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

      for (const action of actions) {
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
          break;
        }

        if (response.outcome === "retryable_failure") {
          await markPendingActionRetryable(
            action.idempotencyKey,
            "retryable_response",
          );
          summary.retryableFailures += 1;
          break;
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
          break;
        }

        if (
          response.outcome === "synced" ||
          response.outcome === "already_processed"
        ) {
          await persistSyncReceipt({
            actionId: action.idempotencyKey,
            definitiveStatus: "synced",
            receipt: response.receipt,
            trustedState: response.trustedState,
          });
          summary.synced += 1;
          continue;
        }

        if (response.outcome === "conflicted") {
          await persistSyncReceipt({
            actionId: action.idempotencyKey,
            definitiveStatus: "conflicted",
            receipt: response.receipt,
            trustedState: response.trustedState,
          });
          summary.conflicted += 1;
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
