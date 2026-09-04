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
  dbsVerifiedAt: string | null;
  hasFullDbsReference: boolean;
  suitabilityStatus: SuitabilityStatus;
  suitabilityDecidedAt: string | null;
  startAuthorisedAt: string | null;
  volunteerException: VolunteerException | null;
};

export type RecruitmentReadiness = {
  status: "blocked" | "needs_attention" | "ready" | "information";
  mayStartWork: boolean;
  blockerCodes: string[];
  warningCodes: string[];
  restrictionCodes: string[];
};

export function deriveRecruitmentReadiness(input: RecruitmentReadinessInput, today: string): RecruitmentReadiness {
  if (!input.active) return { status: "information", mayStartWork: false, blockerCodes: [], warningCodes: [], restrictionCodes: [] };
  const blockers: string[] = [];
  const warnings: string[] = [];
  const restrictions: string[] = [];
  const startIsDue = !input.proposedStartDate || input.proposedStartDate <= today;
  if (input.dbsRequirement === "assessment_needed") blockers.push("dbs_assessment_required");
  if (input.dbsRequirement === "required") {
    if (input.dbsCheckLevel !== "enhanced_childrens_barred_list") blockers.push("dbs_level_incomplete");
    if (!["verified", "legacy_recorded"].includes(input.dbsStatus)) blockers.push("dbs_not_verified");
    if (!input.dbsCertificateReceivedDate) blockers.push("dbs_certificate_not_received");
    if (input.dbsStatus !== "legacy_recorded" && !input.dbsVerifiedAt) blockers.push("dbs_verification_missing");
    if (input.dbsStatus !== "legacy_recorded" && !input.hasFullDbsReference) blockers.push("dbs_reference_incomplete");
    if (input.dbsStatus === "legacy_recorded") warnings.push("legacy_dbs_record_review");
  }
  if (input.dbsRequirement === "not_required") {
    if (input.engagementType !== "volunteer" || input.volunteerException !== "occasional_supervised") blockers.push("dbs_exception_not_recorded");
    else restrictions.push("supervision_required");
  }
  if (input.dbsStatus === "renewal_required") blockers.push("dbs_renewal_required");
  if (!input.suitabilityDecidedAt || !["suitable", "suitable_with_restrictions"].includes(input.suitabilityStatus)) blockers.push("suitability_not_confirmed");
  if (input.suitabilityStatus === "suitable_with_restrictions") restrictions.push("manager_restrictions_apply");
  if (!input.startAuthorisedAt) blockers.push("start_not_authorised");
  const blockerCodes = [...new Set(blockers)];
  const mayStartWork = blockerCodes.length === 0;
  return {
    status: mayStartWork ? (warnings.length ? "needs_attention" : "ready") : startIsDue ? "blocked" : "needs_attention",
    mayStartWork,
    blockerCodes,
    warningCodes: [...new Set(warnings)],
    restrictionCodes: [...new Set(restrictions)],
  };
}
