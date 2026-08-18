import { z } from "zod";

const nullableText = z.string().nullable();
const uuid = z.string().uuid();

const siteSchema = z.object({
  id: uuid, name: z.string(), slug: z.string(), active: z.boolean(), timezone: z.string(),
  addressLine1: nullableText, locality: nullableText, postcode: nullableText,
  phone: nullableText, email: nullableText, archivedAt: nullableText, revision: z.number().int().positive(),
});

const assignmentSchema = z.object({
  id: uuid, siteId: uuid, siteName: z.string(), effectiveFrom: z.string(), effectiveTo: nullableText,
  primary: z.boolean(), revision: z.number().int().positive(),
});

export const commercialAdminSnapshotSchema = z.object({
  organisation: z.object({
    id: uuid, displayName: z.string(), legalName: z.string(), contactEmail: nullableText,
    contactPhone: nullableText, countryCode: z.string(), timezone: z.string(), operationalState: z.string(),
    addressLine1: nullableText, addressLine2: nullableText, locality: nullableText, region: nullableText,
    postcode: nullableText, revision: z.number().int().positive(),
  }),
  actor: z.object({ membershipId: uuid, revision: z.number().int().nonnegative(), permissions: z.array(z.string()) }),
  selectedSiteId: uuid.nullable(),
  sites: z.array(siteSchema),
  staff: z.array(z.object({
    id: z.string(), fullName: z.string(), displayName: z.string(), employmentRole: z.string(), email: nullableText,
    active: z.boolean(), appointmentDate: nullableText, revision: z.number().int().positive(),
    assignments: z.array(assignmentSchema), kiosk: z.object({ enabled: z.boolean(), pinReady: z.boolean() }),
  })),
  memberships: z.array(z.object({
    id: uuid, email: nullableText, status: z.string(), staffId: nullableText, revision: z.number().int().nonnegative(),
    roles: z.array(z.object({ role: z.string(), scopeType: z.string(), siteId: uuid.nullable() })), siteIds: z.array(uuid),
  })),
  invitations: z.array(z.object({ id: uuid, email: z.string(), kind: z.string(), status: z.string(), expiresAt: z.string(), staffId: nullableText, deliveryStatus: z.enum(["queued","processing","accepted_by_provider","retrying","permanently_failed","not_queued"]) })),
  workAreas: z.array(z.object({ id: uuid, siteId: uuid, name: z.string(), code: z.string(), active: z.boolean(), revision: z.number().int().positive() })),
  closures: z.array(z.object({ id: uuid, siteId: uuid, label: z.string(), startsOn: z.string(), endsOn: z.string(), revision: z.number().int().positive() })),
  devices: z.array(z.object({ id: uuid, siteId: uuid, deviceName: z.string(), active: z.boolean(), lastSeenAt: nullableText, appVersion: nullableText, protocolVersion: z.number().int().nullable(), reprovisionRequired: z.boolean(), offlineEnabled: z.literal(false) })),
  settings: z.object({
    organisation: z.object({ workWeekStarts: z.number().int(), defaultTimezone: z.string(), operatingDefaults: z.record(z.string(), z.unknown()), staffingDefaults: z.record(z.string(), z.unknown()), branding: z.record(z.string(), z.unknown()), revision: z.number().int().positive() }).nullable(),
    sites: z.array(z.object({ siteId: uuid, openingTime: nullableText, closingTime: nullableText, timezoneOverride: nullableText, workWeekStartsOverride: z.number().int().nullable(), operatingOverrides: z.record(z.string(), z.unknown()), staffingOverrides: z.record(z.string(), z.unknown()), revision: z.number().int().positive() })),
  }),
});

export type CommercialAdminSnapshot = z.infer<typeof commercialAdminSnapshotSchema>;

export const commercialAdminCommandNameSchema = z.enum([
  "update_organisation", "create_site", "update_site", "archive_site", "create_staff", "update_staff", "deactivate_staff", "set_staff_attendance_eligibility",
  "upsert_assignment", "update_membership_access", "suspend_membership", "revoke_membership", "create_work_area", "update_work_area",
  "archive_work_area", "create_site_closure", "archive_site_closure", "update_organisation_settings", "update_site_settings",
  "create_manager_invitation", "create_staff_invitation", "resend_invitation", "revoke_invitation", "start_kiosk_registration",
  "replace_kiosk_device", "revoke_kiosk_device", "require_kiosk_reprovision", "reset_staff_pin",
]);

export type CommercialAdminCommandName = z.infer<typeof commercialAdminCommandNameSchema>;

export const commercialAdminCommandSchema = z.object({
  organisationId: uuid,
  commandName: commercialAdminCommandNameSchema,
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: uuid,
  expectedRevision: z.number().int().positive(),
});

export const commercialAdminCommandResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("success"), code: z.string(), resourceId: nullableText.optional(), revision: z.number().int().positive() }),
  z.object({ outcome: z.literal("workflow_changed"), revision: z.number().int().positive() }),
  z.object({ outcome: z.enum(["permission_denied", "mfa_required", "not_live", "not_found", "invalid_request", "idempotency_conflict", "indeterminate", "conflict", "upgrade_required"]), code: z.string().optional(), capabilityKey: z.string().optional(), decisionCode: z.string().optional() }),
]);

export type CommercialAdminCommandResult = z.infer<typeof commercialAdminCommandResultSchema>;
