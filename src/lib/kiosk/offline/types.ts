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

export type UnsignedPendingAction = Omit<
  PendingAttendanceAction,
  | "schemaVersion"
  | "deviceSequence"
  | "queueCreatedAt"
  | "status"
  | "retryCount"
  | "lastErrorCategory"
>;

export type OfflineRosterEntry = {
  staffId: string;
  displayName: string;
  employmentRole: string;
  offlineReady: boolean;
};

export type OfflineRosterSnapshot = {
  schemaVersion: 1;
  rosterVersion: string;
  authorisationId: string;
  issuedAt: string;
  expiresAt: string;
  serverTime: string;
  entries: OfflineRosterEntry[];
};

export type TrustedAttendanceState = {
  staffId: string;
  rosterVersion: string;
  state: AttendanceStateResult;
  trustedAt: string;
};

export type OfflineSyncReceipt = {
  schemaVersion: 1;
  idempotencyKey: string;
  outcome: "synced" | "conflicted" | "rejected";
  receivedAtServer: string;
  retainedUntil: string;
};

export type OfflineSyncOutcome =
  | "synced"
  | "already_processed"
  | "unauthorised"
  | "conflicted"
  | "retryable_failure"
  | "permanently_invalid";

export type OfflineSyncResponse = {
  outcome: OfflineSyncOutcome;
  receipt: OfflineSyncReceipt;
  trustedState: TrustedAttendanceState;
};

export type OfflineSyncTrigger =
  | "launch"
  | "online"
  | "visibility"
  | "periodic"
  | "manual"
  | "background";

export type OfflineSyncSummary = {
  trigger: OfflineSyncTrigger;
  attempted: number;
  synced: number;
  conflicted: number;
  rejected: number;
  retryableFailures: number;
  leaseUnavailable: boolean;
};

export type OfflinePinVerifierEnvelope = {
  schemaVersion: 1;
  staffId: string;
  authorisationId: string;
  salt: string;
  iterations: number;
  verifier: string;
  expiresAt: string;
  authenticator: string;
};

export type OfflinePinLockout = {
  schemaVersion: 1;
  staffId: string;
  authorisationId: string;
  failureCount: number;
  locked: boolean;
  updatedAt: string;
  authenticator: string;
};

export type OfflinePinVerificationResult = {
  status: "verified" | "invalid" | "locked" | "expired" | "tampered";
  lockout: OfflinePinLockout;
};

export type DeviceSecurityKeys = {
  signingPrivateKey: CryptoKey;
  signingPublicJwk: JsonWebKey;
  verifierKey: CryptoKey;
};

export type SyncReceiptTransaction = {
  actionId: string;
  definitiveStatus: "synced" | "conflicted" | "rejected";
  receipt: OfflineSyncReceipt;
  trustedState: TrustedAttendanceState;
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
