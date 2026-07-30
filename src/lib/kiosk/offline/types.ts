import type { AttendanceAction, AttendanceStateResult } from "@/lib/attendance/types";

export const OFFLINE_AUTHORISATION_HOURS = 24;
export const OFFLINE_CLOCK_DRIFT_SECONDS = 5 * 60;
export const OFFLINE_PIN_MAX_FAILURES = 3;
export const OFFLINE_RECEIPT_RETENTION_DAYS = 30;
export const OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS = 7;

export type OfflineCapability =
  | {
      status: "disabled";
      reason: "feature_flag" | "hardware_unverified";
    }
  | {
      status: "expired";
      expiresAt: string;
    }
  | {
      status: "ready";
      authorisationId: string;
      rosterVersion: string;
      expiresAt: string;
    };

export type OfflineCapabilityInput = {
  offlineEnabled: boolean;
  hardwareVerifiedAt: string | null;
  authorisationId: string;
  rosterVersion: string;
  expiresAt: string;
  now: string;
};

export type PendingAttendanceAction = {
  schemaVersion: 1;
  idempotencyKey: string;
  authorisationId: string;
  rosterVersion: string;
  deviceId: string;
  staffId: string;
  action: AttendanceAction;
  occurredAtDevice: string;
  deviceTimezone: string;
  operationalDateAtDevice: string;
  deviceSequence: number;
  queueCreatedAt: string;
  trustedSnapshotRevision: string;
  priorPendingActionId: string | null;
  unresolvedOlderException: boolean;
  status: "pending" | "syncing" | "synced" | "conflicted" | "rejected";
  retryCount: number;
  lastErrorCategory: string | null;
  signature: string;
};

export type TrustedAttendanceState = {
  staffId: string;
  rosterVersion: string;
  state: AttendanceStateResult;
  trustedAt: string;
};

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    throw new RangeError("Offline capability requires a valid timestamp");
  }
  return parsed;
}

export function resolveOfflineCapability(
  input: OfflineCapabilityInput,
): OfflineCapability {
  if (!input.offlineEnabled) {
    return { status: "disabled", reason: "feature_flag" };
  }
  if (!input.hardwareVerifiedAt) {
    return { status: "disabled", reason: "hardware_unverified" };
  }

  timestamp(input.hardwareVerifiedAt);
  const now = timestamp(input.now);
  const expiresAt = timestamp(input.expiresAt);
  if (now >= expiresAt) {
    return { status: "expired", expiresAt: input.expiresAt };
  }
  if (!input.authorisationId || !input.rosterVersion) {
    throw new TypeError("Offline capability requires server-issued identifiers");
  }

  return {
    status: "ready",
    authorisationId: input.authorisationId,
    rosterVersion: input.rosterVersion,
    expiresAt: input.expiresAt,
  };
}
