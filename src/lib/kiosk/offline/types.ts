import type { AttendanceAction, AttendanceStateResult } from "@/lib/attendance/types";

export const OFFLINE_AUTHORISATION_HOURS = 24;
export const OFFLINE_CLOCK_DRIFT_SECONDS = 5 * 60;
export const OFFLINE_PIN_MAX_FAILURES = 3;
export const OFFLINE_RECEIPT_RETENTION_DAYS = 30;
export const OFFLINE_DEFINITIVE_QUEUE_RETENTION_DAYS = 7;
export const OFFLINE_EXPIRING_WARNING_MINUTES = 2 * 60;

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
      status: "revoked";
      revokedAt: string;
    }
  | {
      status: "refresh_required";
      authorisationId: string;
      rosterVersion: string;
      expiresAt: string;
    }
  | {
      status: "schema_incompatible";
      clientSchemaVersion: number;
      acceptedSchemaVersion: number;
    }
  | {
      status: "active" | "expiring";
      authorisationId: string;
      rosterVersion: string;
      expiresAt: string;
    };

export type OfflineCapabilityInput = {
  offlineEnabled: boolean;
  hardwareVerifiedAt: string | null;
  revokedAt: string | null;
  refreshRequired: boolean;
  clientSchemaVersion: number;
  acceptedSchemaVersion: number;
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
  clockConfidence: "anchored" | "uncertain";
  elapsedSinceAuthorisationMs: number | null;
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
  | "clockConfidence"
  | "elapsedSinceAuthorisationMs"
> & Partial<Pick<PendingAttendanceAction, "clockConfidence" | "elapsedSinceAuthorisationMs">>;

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
  | "accepted"
  | "accepted_with_warning"
  | "already_processed"
  | "state_conflict"
  | "clock_drift_conflict"
  | "authorisation_expired"
  | "device_revoked"
  | "staff_not_authorised"
  | "roster_outdated"
  | "schema_incompatible"
  | "invalid_signature"
  | "invalid_sequence"
  | "retryable_failure"
  | "permanently_invalid";

export type OfflineSyncDisposition = {
  complete: boolean;
  retry: boolean;
  managerReview: boolean;
  blocksStaffStream: boolean;
  refreshRoster: boolean;
  reprovision: boolean;
};

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
  rosterRefreshRequired: boolean;
  reprovisionRequired: boolean;
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
  if (input.clientSchemaVersion !== input.acceptedSchemaVersion) {
    return {
      status: "schema_incompatible",
      clientSchemaVersion: input.clientSchemaVersion,
      acceptedSchemaVersion: input.acceptedSchemaVersion,
    };
  }
  if (input.revokedAt) {
    timestamp(input.revokedAt);
    return { status: "revoked", revokedAt: input.revokedAt };
  }
  const now = timestamp(input.now);
  const expiresAt = timestamp(input.expiresAt);
  if (now >= expiresAt) {
    return { status: "expired", expiresAt: input.expiresAt };
  }
  if (!input.authorisationId || !input.rosterVersion) {
    throw new TypeError("Offline capability requires server-issued identifiers");
  }

  if (input.refreshRequired) {
    return {
      status: "refresh_required",
      authorisationId: input.authorisationId,
      rosterVersion: input.rosterVersion,
      expiresAt: input.expiresAt,
    };
  }

  return {
    status:
      expiresAt - now <= OFFLINE_EXPIRING_WARNING_MINUTES * 60_000
        ? "expiring"
        : "active",
    authorisationId: input.authorisationId,
    rosterVersion: input.rosterVersion,
    expiresAt: input.expiresAt,
  };
}

export function dispositionForSyncOutcome(
  outcome: OfflineSyncOutcome,
): OfflineSyncDisposition {
  const base = {
    refreshRoster: false,
    reprovision: false,
  };
  switch (outcome) {
    case "accepted":
    case "already_processed":
      return { ...base, complete: true, retry: false, managerReview: false, blocksStaffStream: false };
    case "accepted_with_warning":
      return { ...base, complete: true, retry: false, managerReview: true, blocksStaffStream: false };
    case "state_conflict":
    case "clock_drift_conflict":
    case "invalid_sequence":
      return { ...base, complete: true, retry: false, managerReview: true, blocksStaffStream: true };
    case "roster_outdated":
      return { ...base, complete: false, retry: true, managerReview: false, blocksStaffStream: true, refreshRoster: true };
    case "retryable_failure":
      return { ...base, complete: false, retry: true, managerReview: false, blocksStaffStream: true };
    case "schema_incompatible":
      return { ...base, complete: false, retry: false, managerReview: false, blocksStaffStream: true, reprovision: true };
    case "authorisation_expired":
    case "device_revoked":
    case "staff_not_authorised":
    case "invalid_signature":
    case "permanently_invalid":
      return { ...base, complete: true, retry: false, managerReview: true, blocksStaffStream: true, reprovision: outcome === "device_revoked" };
  }
}
