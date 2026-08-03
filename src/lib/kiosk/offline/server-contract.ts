import { z } from "zod";

const timestamp = z.iso.datetime({ offset: true });
const base64UrlCoordinate = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const signingPublicJwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: base64UrlCoordinate,
  y: base64UrlCoordinate,
}).strict();
export { signingPublicJwkSchema };

export const offlineProvisionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string().trim().min(1).max(40),
  deviceTime: timestamp,
  signingPublicJwk: signingPublicJwkSchema,
}).strict();

const attendanceStateSchema = z.object({
  state: z.enum([
    "clocked_out",
    "clocked_in",
    "missing_clock_out",
    "missing_clock_in",
    "awaiting_manager_review",
  ]),
  operationalDate: z.iso.date(),
  currentEvent: z.unknown().nullable(),
  unresolvedExceptions: z.array(z.unknown()),
  allowedActions: z.array(z.enum(["clock_in", "clock_out", "start_new_shift"])),
  warnings: z.array(z.unknown()),
  revision: z.string().min(1),
  evaluatedAt: timestamp,
}).strict();

export const offlineProvisioningPackageSchema = z.object({
  schemaVersion: z.literal(1),
  featureEnabled: z.literal(true),
  device: z.object({
    id: z.uuid(),
    name: z.string().trim().min(3).max(100),
  }).strict(),
  authorisation: z.object({
    id: z.uuid(),
    issuedAt: timestamp,
    expiresAt: timestamp,
    rosterVersion: z.string().min(1).max(128),
  }).strict(),
  server: z.object({
    time: timestamp,
    timezone: z.literal("Europe/London"),
    operationalDayStart: z.literal("00:00"),
  }).strict(),
  roster: z.array(z.object({
    staffId: z.string().min(1).max(100),
    displayName: z.string().min(1).max(100),
    employmentRole: z.string().min(1).max(100),
    pinVersion: z.string().min(1).max(128),
    trustedState: attendanceStateSchema,
  }).strict()),
}).strict().superRefine((value, context) => {
  const issuedAt = new Date(value.authorisation.issuedAt).getTime();
  const expiresAt = new Date(value.authorisation.expiresAt).getTime();
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 24 * 60 * 60 * 1000) {
    context.addIssue({
      code: "custom",
      message: "Offline authorisation may not exceed 24 hours",
      path: ["authorisation", "expiresAt"],
    });
  }
});

const provisioningDenialCodeSchema = z.enum([
  "device_revoked",
  "feature_disabled",
  "hardware_unverified",
  "reprovision_required",
  "schema_incompatible",
  "invalid_request",
  "rate_limited",
]);

export const offlineProvisionDatabaseResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), package: offlineProvisioningPackageSchema }).strict(),
  z.object({
    ok: z.literal(false),
    code: provisioningDenialCodeSchema,
    acceptedSchemaVersion: z.number().int().positive().optional(),
  }).strict(),
]);

export const offlineSyncRequestSchema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: z.uuid(),
  authorisationId: z.uuid(),
  rosterVersion: z.string().regex(/^[a-f0-9]{64}$/),
  deviceId: z.uuid(),
  staffId: z.string().min(1).max(100),
  action: z.enum(["clock_in", "clock_out", "start_new_shift"]),
  occurredAtDevice: timestamp,
  deviceTimezone: z.literal("Europe/London"),
  operationalDateAtDevice: z.iso.date(),
  deviceSequence: z.number().int().positive(),
  queueCreatedAt: timestamp,
  trustedSnapshotRevision: z.string().min(1).max(256),
  priorPendingActionId: z.uuid().nullable(),
  unresolvedOlderException: z.boolean(),
  clockConfidence: z.enum(["anchored", "uncertain"]),
  elapsedSinceAuthorisationMs: z.number().int().nonnegative().max(7 * 24 * 60 * 60 * 1000).nullable(),
  signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(8).max(512),
}).strict().superRefine((value, context) => {
  if (value.clockConfidence === "anchored" && value.elapsedSinceAuthorisationMs === null) {
    context.addIssue({
      code: "custom",
      message: "Anchored clock evidence requires elapsed milliseconds",
      path: ["elapsedSinceAuthorisationMs"],
    });
  }
});

export type OfflineSyncRequest = z.infer<typeof offlineSyncRequestSchema>;

export function payloadForOfflineSignature(
  request: OfflineSyncRequest,
): Omit<OfflineSyncRequest, "signature"> {
  return Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== "signature"),
  ) as Omit<OfflineSyncRequest, "signature">;
}

export const offlineSyncContextSchema = z.object({
  ok: z.literal(true),
  deviceId: z.uuid(),
  signingPublicJwk: signingPublicJwkSchema,
}).strict();

const offlineSyncOutcomeSchema = z.enum([
  "accepted",
  "accepted_with_warning",
  "already_processed",
  "state_conflict",
  "clock_drift_conflict",
  "authorisation_expired",
  "device_revoked",
  "staff_not_authorised",
  "roster_outdated",
  "schema_incompatible",
  "invalid_signature",
  "invalid_sequence",
  "retryable_failure",
  "permanently_invalid",
]);

export const offlineSyncResponseSchema = z.object({
  outcome: offlineSyncOutcomeSchema,
  receipt: z.object({
    schemaVersion: z.literal(1),
    idempotencyKey: z.uuid(),
    outcome: z.enum(["synced", "conflicted", "rejected"]),
    receivedAtServer: timestamp,
    retainedUntil: timestamp,
  }).strict(),
  trustedState: z.object({
    staffId: z.string().min(1).max(100),
    rosterVersion: z.string().min(1).max(128),
    state: attendanceStateSchema,
    trustedAt: timestamp,
  }).strict(),
}).strict();

export const offlineHealthReportSchema = z.object({
  authorisationId: z.uuid(),
  pendingCount: z.number().int().min(0).max(10_000),
  oldestPendingActionAt: timestamp.nullable(),
  storagePersisted: z.boolean(),
  storageEstimateBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  appVersion: z.string().trim().min(1).max(40),
}).strict().superRefine((value, context) => {
  if ((value.pendingCount === 0) !== (value.oldestPendingActionAt === null)) {
    context.addIssue({ code: "custom", message: "Pending count and oldest action must agree" });
  }
});

export const offlineHealthContextSchema = z.object({
  deviceId: z.uuid(),
  active: z.boolean(),
  revokedAt: timestamp.nullable(),
  offlineEnabled: z.boolean(),
  hardwareVerifiedAt: timestamp.nullable(),
  reprovisionRequired: z.boolean(),
  acceptedSchemaVersion: z.number().int().positive(),
  authorisation: z.object({
    id: z.uuid(),
    expiresAt: timestamp,
    revokedAt: timestamp.nullable(),
    rosterVersion: z.string().min(1).max(128),
  }).strict().nullable(),
  serverTime: timestamp,
}).strict();

export type OfflineProvisionRequest = z.infer<typeof offlineProvisionRequestSchema>;
export type OfflineProvisioningPackage = z.infer<typeof offlineProvisioningPackageSchema>;
