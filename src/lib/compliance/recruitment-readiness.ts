import { isoDateInLondon } from "@/lib/dates/format";

export type StaffEngagementType = "employee" | "volunteer";
export type DbsRequirement = "assessment_needed" | "required" | "not_required";
export type DbsCheckLevel = "enhanced_childrens_barred_list" | "enhanced" | "other";
export type DbsLifecycleStatus = "not_started" | "application_submitted" | "certificate_received" | "verified" | "renewal_required" | "not_required" | "legacy_recorded";
export type SuitabilityStatus = "not_assessed" | "suitable" | "suitable_with_restrictions" | "not_suitable";
export type VolunteerException = "occasional_supervised";

export type RecruitmentReadinessInput = {
  active: boolean;
  engagementType: StaffEngagementType;
  proposedStartDate: string | null;
  dbsRequirement: DbsRequirement;
  dbsCheckLevel: DbsCheckLevel | null;
  dbsStatus: DbsLifecycleStatus;
  dbsCertificateReceivedDate: string | null;
  /** Only the authoritative receipt-confirmation view may supply true. */
  dbsReceiptConfirmed?: boolean;
  dbsRecorded?: boolean;
  dbsVerifiedAt: string | null;
  hasFullDbsReference: boolean;
  suitabilityStatus: SuitabilityStatus;
  suitabilityDecidedAt: string | null;
  startAuthorisedAt: string | null;
  volunteerException: VolunteerException | null;
};

export type RecruitmentReadiness = {
  evidenceState: "ready" | "future_effective" | "missing" | "receipt_unconfirmed" | "permitted_exception" | "inactive";
  status: "blocked" | "needs_attention" | "ready" | "information";
  mayStartWork: boolean;
  blockerCodes: string[];
  warningCodes: string[];
  restrictionCodes: string[];
};

export function deriveRecruitmentReadiness(input: RecruitmentReadinessInput, today: string): RecruitmentReadiness {
  if (!input.active) return { status: "information", evidenceState: "inactive", mayStartWork: false, blockerCodes: [], warningCodes: [], restrictionCodes: [] };
  const blockers: string[] = [];
  const warnings: string[] = [];
  const restrictions: string[] = [];
  const startIsDue = !input.proposedStartDate || input.proposedStartDate <= today;
  if (!startIsDue) blockers.push("appointment_future_effective");
  const timestampEffective = (value: string | null, missing: string, future: string) => {
    if (!value || !Number.isFinite(Date.parse(value))) blockers.push(missing);
    else if (isoDateInLondon(new Date(value)) > today) blockers.push(future);
  };
  if (input.dbsRequirement === "assessment_needed") blockers.push("dbs_assessment_required");
  if (input.dbsRequirement === "required") {
    if (input.dbsCheckLevel !== "enhanced_childrens_barred_list") blockers.push("dbs_level_incomplete");
    if (!["verified", "legacy_recorded"].includes(input.dbsStatus)) blockers.push("dbs_not_verified");
    if (!input.dbsCertificateReceivedDate) blockers.push("dbs_certificate_not_received");
    else {
      if (!input.dbsReceiptConfirmed) blockers.push("dbs_receipt_timing_unconfirmed");
      if (input.dbsCertificateReceivedDate > today) blockers.push("dbs_receipt_future_effective");
    }
    if (input.dbsStatus !== "legacy_recorded") timestampEffective(input.dbsVerifiedAt, "dbs_verification_missing", "dbs_verification_future_effective");
    if (input.dbsStatus !== "legacy_recorded" && !input.hasFullDbsReference) blockers.push("dbs_reference_incomplete");
    if (input.dbsStatus === "legacy_recorded") {
      warnings.push("legacy_dbs_record_review");
      if (!input.dbsRecorded || !input.proposedStartDate || input.proposedStartDate >= "2026-09-01") blockers.push("legacy_dbs_eligibility_unconfirmed");
    }
  }
  if (input.dbsRequirement === "not_required") {
    if (input.engagementType !== "volunteer" || input.dbsStatus !== "not_required" || input.volunteerException !== "occasional_supervised") blockers.push("dbs_exception_not_recorded");
    else restrictions.push("supervision_required");
  }
  if (input.dbsStatus === "renewal_required") blockers.push("dbs_renewal_required");
  if (!input.suitabilityDecidedAt || !["suitable", "suitable_with_restrictions"].includes(input.suitabilityStatus)) blockers.push("suitability_not_confirmed");
  if (input.suitabilityStatus === "suitable_with_restrictions") restrictions.push("manager_restrictions_apply");
  timestampEffective(input.suitabilityDecidedAt, "suitability_not_confirmed", "suitability_future_effective");
  timestampEffective(input.startAuthorisedAt, "start_not_authorised", "start_authorisation_future_effective");
  const blockerCodes = [...new Set(blockers)];
  const mayStartWork = blockerCodes.length === 0;
  return {
    evidenceState: blockerCodes.includes("dbs_receipt_timing_unconfirmed") ? "receipt_unconfirmed"
      : blockerCodes.some((code) => !code.endsWith("_future_effective")) ? "missing"
      : blockerCodes.length ? "future_effective"
      : restrictions.includes("supervision_required") ? "permitted_exception" : "ready",
    status: mayStartWork ? (warnings.length ? "needs_attention" : "ready") : startIsDue ? "blocked" : "needs_attention",
    mayStartWork,
    blockerCodes,
    warningCodes: [...new Set(warnings)],
    restrictionCodes: [...new Set(restrictions)],
  };
}
