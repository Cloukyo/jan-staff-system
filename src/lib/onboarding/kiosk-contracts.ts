import { z } from "zod";
import { staffInvitationStaffIdSchema } from "./staff-invitation-contracts";

export const KIOSK_REGISTRATION_LIFETIME_MINUTES = 10 as const;
export const KIOSK_HEARTBEAT_RECENCY_MINUTES = 5 as const;

export const kioskRegistrationPayloadSchema = z
  .object({
    siteId: z.uuid(),
    deviceName: z.string().trim().min(3).max(100),
  })
  .strict();

export const kioskRegistrationReferencePayloadSchema = z
  .object({ registrationId: z.uuid() })
  .strict();

export const kioskPinSetupPayloadSchema = z
  .object({
    staffId: staffInvitationStaffIdSchema,
    temporaryPin: z.string().regex(/^\d{4,6}$/),
  })
  .strict();

export const kioskClaimPayloadSchema = z
  .object({
    registrationId: z.uuid(),
    registrationSecret: z
      .string()
      .trim()
      .regex(/^[A-HJ-NP-Z2-9]{16}$/),
    claimantNonce: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  })
  .strict();

export const kioskHeartbeatPayloadSchema = z
  .object({
    appVersion: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/),
    protocolVersion: z.number().int().min(1).max(1000),
    platformCategory: z.enum(["tablet", "desktop", "mobile", "unknown"]),
  })
  .strict();

export const kioskRegistrationStatusSchema = z.enum([
  "pending",
  "claimed",
  "verified",
  "expired",
  "revoked",
  "failed",
]);

const kioskReadinessSummarySchema = z
  .object({
    complete: z.boolean(),
    registrationReady: z.boolean(),
    deviceActive: z.boolean(),
    bindingValid: z.boolean(),
    heartbeatRecent: z.boolean(),
    rosterVerified: z.boolean(),
    eligibleStaffCount: z.number().int().nonnegative(),
    pinReadyStaffCount: z.number().int().nonnegative(),
    offlineDisabled: z.literal(true),
    offlineAuthorisationCount: z.number().int().nonnegative(),
  })
  .strict();

export const kioskSnapshotSchema = z
  .object({
    availableSites: z
      .array(
        z
          .object({
            siteId: z.uuid(),
            displayName: z.string().trim().min(1).max(160),
          })
          .strict(),
      )
      .max(100),
    registration: z
      .object({
        registrationId: z.uuid(),
        siteId: z.uuid(),
        deviceName: z.string().trim().min(3).max(100),
        status: kioskRegistrationStatusSchema,
        expiresAt: z.iso.datetime({ offset: true }),
        claimedDeviceId: z.uuid().nullable(),
        revision: z.string().regex(/^(0|[1-9]\d*)$/),
      })
      .strict()
      .nullable(),
    device: z
      .object({
        deviceId: z.uuid(),
        siteId: z.uuid(),
        deviceName: z.string().trim().min(3).max(100),
        active: z.boolean(),
        status: z.enum(["waiting", "connected", "connection_problem", "revoked"]),
        lastSeenAt: z.iso.datetime({ offset: true }).nullable(),
        appVersion: z.string().max(40).nullable(),
        protocolVersion: z.number().int().positive().nullable(),
        platformCategory: z.enum(["tablet", "desktop", "mobile", "unknown"]).nullable(),
      })
      .strict()
      .nullable(),
    readiness: kioskReadinessSummarySchema,
    staff: z
      .array(
        z
          .object({
            staffId: staffInvitationStaffIdSchema,
            displayName: z.string().trim().min(1).max(160),
            siteAssigned: z.boolean(),
            attendanceEligible: z.boolean(),
            pinRequired: z.boolean(),
            pinReady: z.boolean(),
            visibleOnKiosk: z.boolean(),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();

export const emptyKioskSnapshot = kioskSnapshotSchema.parse({
  availableSites: [],
  registration: null,
  device: null,
  readiness: {
    complete: false,
    registrationReady: false,
    deviceActive: false,
    bindingValid: false,
    heartbeatRecent: false,
    rosterVerified: false,
    eligibleStaffCount: 0,
    pinReadyStaffCount: 0,
    offlineDisabled: true,
    offlineAuthorisationCount: 0,
  },
  staff: [],
});

export type KioskOnboardingSnapshot = z.infer<typeof kioskSnapshotSchema>;
