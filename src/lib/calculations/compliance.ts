import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import type { CertificateStatus, ComplianceIndicator, StaffCertificate, StaffCentralRecord, StaffProfile } from "@/types";

export function certificateStatus(certificate: Pick<StaffCertificate, "expiryDate" | "completionDate" | "evidenceReference" | "permanent">, today = new Date()): CertificateStatus {
  if (!certificate.evidenceReference && !certificate.completionDate) return "awaiting_evidence";
  if (certificate.permanent) return "no_expiry";
  if (!certificate.expiryDate) return "no_expiry";
  const days = differenceInCalendarDays(parseISO(certificate.expiryDate), today);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring_30";
  if (days <= 60) return "expiring_60";
  if (days <= 90) return "expiring_90";
  return "valid";
}

export function certificateStatusLabel(status: CertificateStatus): string {
  const labels: Record<CertificateStatus, string> = {
    valid: "Valid",
    expiring_90: "Expiring within 90 days",
    expiring_60: "Expiring within 60 days",
    expiring_30: "Expiring within 30 days",
    expired: "Expired",
    no_expiry: "No expiry date",
    awaiting_evidence: "Awaiting evidence",
    expected: "Expected or in progress",
  };
  return labels[status];
}

export function certificateStatusTone(status: CertificateStatus): "green" | "amber" | "red" | "grey" | "purple" {
  if (status === "valid") return "green";
  if (status === "expired") return "red";
  if (status.startsWith("expiring")) return "amber";
  if (status === "awaiting_evidence") return "red";
  return "grey";
}

export function centralRecordCompletion(
  record?: Partial<StaffCentralRecord> | null,
  items: Array<{ status: string }> = [],
): { completed: number; total: number; percent: number } {
  if (items.length) {
    const completed = items.filter((item) => item.status === "complete" || item.status === "not_applicable").length;
    const total = 12;
    return { completed, total, percent: Math.round((completed / total) * 100) };
  }
  const keys: (keyof StaffCentralRecord)[] = [
    "appointmentInductionCompleted",
    "contractForm",
    "idChecked",
    "addressEvidenceChecked",
    "additionalEmploymentTaxEvidenceChecked",
    "dbsRecorded",
    "referencesComplete",
    "starterForm",
    "suitabilityDeclaration",
    "medicalDeclaration",
    "employeeInformationForm",
  ];
  const completed = keys.filter((key) => Boolean(record?.[key])).length;
  return { completed, total: keys.length, percent: Math.round((completed / keys.length) * 100) };
}

export function overallComplianceIndicator(input: {
  firstAidStatus?: CertificateStatus;
  safeguardingStatus?: CertificateStatus;
  centralRecordPercent: number;
  unverifiedEvidenceCount?: number;
}): ComplianceIndicator {
  if (input.firstAidStatus === "expired" || input.safeguardingStatus === "expired") return "urgent";
  if ((input.unverifiedEvidenceCount ?? 0) > 0) return "attention";
  if (input.centralRecordPercent < 100) return "incomplete";
  if ([input.firstAidStatus, input.safeguardingStatus].some((status) => status?.startsWith("expiring"))) return "attention";
  return "complete";
}

export function findCertificate(certificates: StaffCertificate[], staffId: string, keywords: string[]): StaffCertificate | undefined {
  return certificates.find((certificate) => certificate.staffId === staffId && keywords.some((keyword) => `${certificate.certificateType} ${certificate.customTitle ?? ""}`.toLowerCase().includes(keyword.toLowerCase())) && !certificate.archivedAt);
}

export function maskDbsNumber(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const digits = value.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return last4 ? `****${last4}` : "Masked";
}

export function canEditCompliance(role: "manager" | "staff" | null | undefined): boolean {
  return role === "manager";
}

export function activeComplianceRecords<T extends { archivedAt: string | null }>(records: T[]): T[] {
  return records.filter((record) => !record.archivedAt);
}

export function complianceDashboardCounts(
  staff: StaffProfile[],
  certificates: StaffCertificate[],
  centralRecords: StaffCentralRecord[],
  today = new Date(),
  centralItems: Array<{ staffId: string; status: string }> = [],
) {
  const activeStaff = staff.filter((person) => person.active);
  const activeIds = new Set(activeStaff.map((person) => person.id));
  const activeCertificates = certificates.filter((certificate) => activeIds.has(certificate.staffId) && !certificate.archivedAt);
  const statuses = activeCertificates.map((certificate) => certificateStatus(certificate, today));
  return {
    activeStaff: activeStaff.length,
    expired: statuses.filter((status) => status === "expired").length,
    expiring30: statuses.filter((status) => status === "expiring_30").length,
    expiring60: statuses.filter((status) => status === "expiring_60").length,
    expiring90: statuses.filter((status) => status === "expiring_90").length,
    missingFirstAid: activeStaff.filter((person) => !findCertificate(activeCertificates, person.id, ["first aid"])).length,
    missingSafeguarding: activeStaff.filter((person) => !findCertificate(activeCertificates, person.id, ["safeguarding"])).length,
    incompleteCentralRecords: activeStaff.filter((person) => centralRecordCompletion(
      centralRecords.find((record) => record.staffId === person.id),
      centralItems.filter((item) => item.staffId === person.id),
    ).percent < 100).length,
    unverifiedEvidence: activeCertificates.filter((certificate) => certificate.evidenceReference && !certificate.verifiedAt).length,
  };
}

export function parseUkDateForImport(value: string): { isoDate: string | null; warning: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { isoDate: null, warning: "Missing date" };
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return { isoDate: null, warning: "Date is not in DD/MM/YYYY format" };
  const [, dayRaw, monthRaw, yearRaw] = match;
  const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const parsed = parseISO(iso);
  if (!isValid(parsed) || parsed.getFullYear() !== year || parsed.getMonth() + 1 !== month || parsed.getDate() !== day) {
    return { isoDate: null, warning: `Invalid calendar date: ${trimmed}` };
  }
  return { isoDate: iso, warning: null };
}
