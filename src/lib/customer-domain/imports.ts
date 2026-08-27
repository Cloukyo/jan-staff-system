import { z } from "zod";
import type {
  StaffImportInputRow,
  StaffImportPreview,
  StaffImportPreviewError,
  StaffImportPreviewRow,
} from "@/types/customer-domain";

type StaffImportContext = {
  organisationId: string;
  targetSiteId: string;
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const emailSchema = z.email();

function isValidIsoDate(value: string): boolean {
  if (!isoDate.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function previewStaffImport(
  context: StaffImportContext,
  input: readonly StaffImportInputRow[],
): StaffImportPreview {
  const seenKeys = new Set<string>();
  const seenEmails = new Set<string>();
  const errors: StaffImportPreviewError[] = [];
  const rows: StaffImportPreviewRow[] = [];

  for (const candidate of input) {
    const sourceRow = candidate.sourceRow.trim();
    const externalKey = candidate.externalKey.trim();
    const fullName = candidate.fullName.trim();
    const employmentRole = candidate.employmentRole.trim();
    const normalisedKey = externalKey.toLowerCase();

    for (const [field, value] of [["externalKey", externalKey], ["fullName", fullName], ["employmentRole", employmentRole], ["siteId", candidate.siteId.trim()]] as const) {
      if (!value) errors.push({ sourceRow, code: "missing_required_value", field });
    }
    if (candidate.siteId.trim() !== context.targetSiteId) {
      errors.push({ sourceRow, code: "site_not_permitted", field: "siteId" });
    }
    if (!isValidIsoDate(candidate.effectiveFrom)) {
      errors.push({ sourceRow, code: "invalid_date", field: "effectiveFrom" });
    }
    const email = candidate.email?.trim().toLowerCase() || null;
    if (email && !emailSchema.safeParse(email).success) {
      errors.push({ sourceRow, code: "invalid_email", field: "email" });
    } else if (email && seenEmails.has(email)) {
      errors.push({ sourceRow, code: "duplicate_email", field: "email" });
    }
    if (email) seenEmails.add(email);
    if (seenKeys.has(normalisedKey)) {
      errors.push({ sourceRow, code: "duplicate_external_key", field: "externalKey" });
    }
    seenKeys.add(normalisedKey);

    rows.push({
      sourceRow,
      externalKey,
      organisationId: context.organisationId,
      siteId: candidate.siteId.trim(),
      fullName,
      displayName: candidate.displayName?.trim() || fullName.split(/\s+/)[0],
      employmentRole,
      effectiveFrom: candidate.effectiveFrom,
      primarySite: candidate.primarySite ?? false,
      email,
    });
  }

  return { valid: errors.length === 0, rows, errors };
}
