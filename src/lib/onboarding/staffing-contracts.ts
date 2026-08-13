import { z } from "zod";

export const staffingEmploymentStatusSchema = z.enum(["active", "future_starter"]);
export const staffingRoleSchema = z.enum(["staff", "supervisor", "manager"]);
export const staffingRowDecisionSchema = z.enum(["include", "exclude", "needs_review", "confirm_new"]);
export const staffingValidationCodeSchema = z.enum([
  "missing_required_field", "malformed_email", "malformed_date", "ambiguous_date",
  "invalid_employment_status", "unsupported_role", "unknown_site",
  "duplicate_external_id_upload", "duplicate_external_id_organisation",
  "duplicate_email_upload", "duplicate_email_organisation", "probable_duplicate_name",
  "invalid_attendance_eligibility", "staff_plan_limit_breach", "invalid_assignment_dates",
]);

export const manualStaffPayloadSchema = z.object({
  externalStaffId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  fullName: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(1).max(80),
  email: z.union([z.literal(""), z.email().max(254)]).optional(),
  employmentStatus: staffingEmploymentStatusSchema,
  startDate: z.iso.date(),
  jobRole: staffingRoleSchema,
  attendanceEligible: z.boolean(),
}).strict();

export const manualStaffDraftPayloadSchema = z.object({
  externalStaffId: z.string().trim().max(64).optional(), fullName: z.string().trim().max(160).optional(),
  displayName: z.string().trim().max(80).optional(), email: z.string().trim().max(254).optional(),
  employmentStatus: z.string().trim().max(40).optional(), startDate: z.string().trim().max(32).optional(),
  jobRole: z.string().trim().max(40).optional(), attendanceEligible: z.boolean().optional(),
}).strict();

export const staffImportRowSchema = z.object({
  sourceRowNumber: z.number().int().min(2).max(251),
  externalStaffId: z.string().trim().max(64), fullName: z.string().trim().max(160),
  displayName: z.string().trim().max(80), email: z.string().trim().max(254).optional(),
  employmentStatus: z.string().trim().max(40), startDate: z.string().trim().max(32),
  jobRole: z.string().trim().max(40), siteName: z.string().trim().max(160).optional(),
  attendanceEligible: z.union([z.boolean(), z.string().trim().max(20)]),
}).strict();

export const staffImportUploadPayloadSchema = z.object({
  safeFilename: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*\.csv$/i),
  fileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(staffImportRowSchema).min(1).max(250),
}).strict();

export const staffImportDecisionPayloadSchema = z.object({
  batchId: z.uuid(), rowId: z.uuid(), decision: staffingRowDecisionSchema,
}).strict();
export const staffImportCommitPayloadSchema = z.object({ batchId: z.uuid(), reviewedSetHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const staffingSkipPayloadSchema = z.object({ acknowledgement: z.literal("staffing_not_ready") }).strict();

export const staffingSnapshotSchema = z.object({
  firstSiteId: z.uuid().nullable(), firstSiteName: z.string().nullable(),
  activeStaffCount: z.number().int().nonnegative(), staffLimit: z.number().int().nonnegative().nullable(),
  remainingStaffAllowance: z.number().int().nonnegative().nullable(), committedThisStep: z.number().int().nonnegative(),
  skipped: z.boolean(),
  activeBatch: z.object({
    id: z.uuid(), status: z.enum(["uploaded", "validating", "invalid", "ready", "committing", "committed", "expired"]),
    safeFilename: z.string(), totalRows: z.number().int().nonnegative(), includedRows: z.number().int().nonnegative(),
    excludedRows: z.number().int().nonnegative(), invalidRows: z.number().int().nonnegative(), expiresAt: z.iso.datetime({ offset: true }),
    rows: z.array(z.object({ id: z.uuid(), sourceRowNumber: z.number().int(), externalStaffId: z.string(), fullName: z.string(),
      email: z.string().nullable(), jobRole: staffingRoleSchema, attendanceEligible: z.boolean(), decision: staffingRowDecisionSchema,
      validationCodes: z.array(staffingValidationCodeSchema), importedStaffId: z.string().nullable() }).strict()),
  }).strict().nullable(),
}).strict();

export type ManualStaffPayload = z.infer<typeof manualStaffPayloadSchema>;
export type StaffingSnapshot = z.infer<typeof staffingSnapshotSchema>;
