import { z } from "zod";

export const MANAGER_INVITATION_ROLES = [
  "organisation_admin",
  "hr_admin",
  "payroll_admin",
  "site_manager",
  "scheduler",
] as const;

export const managerInvitationRoleSchema = z.enum(MANAGER_INVITATION_ROLES);
export const managerInvitationScopeSchema = z.enum(["organisation", "site"]);

export const MANAGER_ROLE_PRESENTATION: Record<
  (typeof MANAGER_INVITATION_ROLES)[number],
  { label: string; description: string; scope: "organisation" | "site" }
> = {
  organisation_admin: {
    label: "Organisation administrator",
    description:
      "Manages organisation settings, sites, staff and attendance operations.",
    scope: "organisation",
  },
  hr_admin: {
    label: "HR administrator",
    description:
      "Manages people, compliance and leave across the organisation.",
    scope: "organisation",
  },
  payroll_admin: {
    label: "Payroll administrator",
    description:
      "Reviews attendance and prepares payroll information across the organisation.",
    scope: "organisation",
  },
  site_manager: {
    label: "Site manager",
    description:
      "Manages day-to-day people, rota and attendance for selected sites.",
    scope: "site",
  },
  scheduler: {
    label: "Scheduler",
    description:
      "Plans rotas for selected sites without broader management access.",
    scope: "site",
  },
};

export const managerInvitationPayloadSchema = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((value) => value.toLowerCase()),
    role: managerInvitationRoleSchema,
    scopeType: managerInvitationScopeSchema,
    siteIds: z.array(z.uuid()).max(50),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedScope = MANAGER_ROLE_PRESENTATION[value.role].scope;
    if (value.scopeType !== expectedScope)
      context.addIssue({
        code: "custom",
        message: "The selected role does not support this scope",
        path: ["scopeType"],
      });
    if (value.scopeType === "site" && value.siteIds.length === 0)
      context.addIssue({
        code: "custom",
        message: "Select at least one site",
        path: ["siteIds"],
      });
    if (value.scopeType === "organisation" && value.siteIds.length !== 0)
      context.addIssue({
        code: "custom",
        message: "Organisation roles cannot carry site access",
        path: ["siteIds"],
      });
    if (new Set(value.siteIds).size !== value.siteIds.length)
      context.addIssue({
        code: "custom",
        message: "Site access cannot contain duplicates",
        path: ["siteIds"],
      });
  });

export const managerInvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "expired",
  "revoked",
  "superseded",
]);
export const managerInvitationDeliveryStatusSchema = z.enum([
  "queued",
  "sent",
  "retryable_failure",
  "permanent_failure",
]);

export const managerInvitationSummarySchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: managerInvitationRoleSchema,
    scopeType: managerInvitationScopeSchema,
    siteIds: z.array(z.uuid()).max(50),
    status: managerInvitationStatusSchema,
    deliveryStatus: managerInvitationDeliveryStatusSchema,
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const managerInvitationSnapshotSchema = z
  .object({
    soleManagerAcknowledged: z.boolean(),
    invitations: z.array(managerInvitationSummarySchema).max(100),
    availableSites: z
      .array(
        z.object({ id: z.uuid(), name: z.string().min(1).max(160) }).strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();

export const managerInvitationAcceptanceStateSchema = z.enum([
  "valid",
  "sign_in_required",
  "account_creation_required",
  "email_verification_required",
  "mfa_required",
  "expired",
  "revoked",
  "superseded",
  "already_accepted",
  "membership_already_exists",
  "accepted",
  "unavailable",
]);

export const soleManagerAcknowledgementPayloadSchema = z
  .object({ acknowledgement: z.literal("sole_manager_for_now") })
  .strict();
export const invitationReferencePayloadSchema = z
  .object({ invitationId: z.uuid() })
  .strict();

export type ManagerInvitationSnapshot = z.infer<
  typeof managerInvitationSnapshotSchema
>;
