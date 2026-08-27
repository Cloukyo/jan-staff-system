import { z } from "zod";
import {
  managerInvitationDeliveryStatusSchema,
  managerInvitationStatusSchema,
} from "./manager-invitation-contracts";

export const staffInvitationStaffIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const staffInvitationSelectionPayloadSchema = z
  .object({
    staffIds: z.array(staffInvitationStaffIdSchema).min(1).max(250),
    reviewedSetHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.staffIds).size !== value.staffIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each staff profile may be selected only once",
        path: ["staffIds"],
      });
    }
  });

export const staffInvitationReferencePayloadSchema = z
  .object({ invitationId: z.uuid() })
  .strict();

export const staffInvitationSkipPayloadSchema = z
  .object({ acknowledgement: z.literal("invite_staff_later") })
  .strict();

export const staffAccountStateSchema = z.enum([
  "no_account",
  "invitation_pending",
  "delivery_failed",
  "invitation_expired",
  "account_linked",
  "pin_only",
  "needs_review",
]);

export const staffInvitationAcceptanceStateSchema = z.enum([
  "valid",
  "sign_in_required",
  "account_creation_required",
  "email_verification_required",
  "expired",
  "revoked",
  "superseded",
  "already_accepted",
  "already_linked",
  "membership_conflict",
  "capacity_changed",
  "accepted",
  "unavailable",
]);

const staffInvitationSummarySchema = z
  .object({
    staffId: staffInvitationStaffIdSchema,
    displayName: z.string().trim().min(1).max(160),
    maskedEmail: z.string().trim().min(3).max(254).nullable(),
    siteIds: z.array(z.uuid()).max(100),
    accountState: staffAccountStateSchema,
    invitationId: z.uuid().nullable(),
    invitationStatus: managerInvitationStatusSchema.nullable(),
    deliveryStatus: managerInvitationDeliveryStatusSchema.nullable(),
    attendanceMode: z.enum(["account_optional", "pin_only"]),
  })
  .strict();

export const staffInvitationSnapshotSchema = z
  .object({
    skipped: z.boolean(),
    staff: z.array(staffInvitationSummarySchema).max(5_000),
  })
  .strict();

export type StaffInvitationSnapshot = z.infer<
  typeof staffInvitationSnapshotSchema
>;
