import type { RecruitmentReadiness } from "@/lib/compliance/recruitment-readiness";

export type RecruitmentPriorityPresentation = {
  label: string;
  heading: string;
  description: string;
  tone: "danger" | "warning" | "success" | "information";
};

const issueCopy: Record<string, { label: string; target: string }> = {
  appointment_future_effective: { label: "The proposed start date is later than the selected work date.", target: "basic-information" },
  dbs_assessment_required: { label: "Confirm whether a DBS check is required.", target: "dbs-suitability" },
  dbs_level_incomplete: { label: "Record the required DBS check level.", target: "dbs-suitability" },
  dbs_not_verified: { label: "Complete DBS verification.", target: "dbs-suitability" },
  dbs_certificate_not_received: { label: "Record when the DBS certificate was received.", target: "dbs-suitability" },
  dbs_receipt_timing_unconfirmed: { label: "Confirm when the historical DBS evidence was received.", target: "dbs-receipt-confirmation" },
  dbs_receipt_future_effective: { label: "The confirmed DBS receipt date is later than the selected work date.", target: "dbs-suitability" },
  dbs_verification_missing: { label: "Record the DBS verification date.", target: "dbs-suitability" },
  dbs_verification_future_effective: { label: "The DBS verification date is later than the selected work date.", target: "dbs-suitability" },
  dbs_reference_incomplete: { label: "Record the DBS reference evidence.", target: "dbs-suitability" },
  legacy_dbs_eligibility_unconfirmed: { label: "Review the legacy DBS evidence and confirm receipt timing.", target: "dbs-receipt-confirmation" },
  dbs_exception_not_recorded: { label: "Record the supported volunteer exception or complete the required DBS evidence.", target: "dbs-suitability" },
  dbs_renewal_required: { label: "Resolve the DBS renewal requirement.", target: "dbs-suitability" },
  suitability_not_confirmed: { label: "Complete the suitability decision.", target: "dbs-suitability" },
  suitability_future_effective: { label: "The suitability decision is later than the selected work date.", target: "dbs-suitability" },
  start_not_authorised: { label: "Authorise the staff member to begin work.", target: "dbs-suitability" },
  start_authorisation_future_effective: { label: "The start authorisation is later than the selected work date.", target: "dbs-suitability" },
};

export function recruitmentPriorityPresentation(readiness: RecruitmentReadiness): RecruitmentPriorityPresentation {
  if (readiness.evidenceState === "inactive") {
    return { label: "Inactive", heading: "Inactive staff record", description: "This person is not currently available for operational work.", tone: "information" };
  }
  if (readiness.evidenceState === "receipt_unconfirmed") {
    return {
      label: "Action required",
      heading: "Historical DBS evidence needs manager confirmation",
      description: "DBS evidence is recorded, but the date it was received has not been confirmed. This is not a missing or failed DBS check.",
      tone: "warning",
    };
  }
  if (readiness.evidenceState === "future_effective") {
    return { label: "Not yet effective", heading: "Evidence is recorded for a later date", description: "Review the effective dates before scheduling operational work.", tone: "warning" };
  }
  if (readiness.evidenceState === "permitted_exception") {
    return { label: "Permitted exception", heading: "Ready with recorded supervision", description: "The supported volunteer exception is recorded. Follow the stated supervision restriction.", tone: "information" };
  }
  if (readiness.mayStartWork) {
    return { label: "Ready", heading: "Ready to begin operational work", description: "The required recruitment evidence and manager authorisation are effective.", tone: "success" };
  }
  return { label: "Blocking", heading: "Cannot begin operational work", description: "Resolve the required recruitment actions before scheduling or clocking in.", tone: "danger" };
}

export function recruitmentIssuePresentation(code: string): { label: string; target: string } {
  return issueCopy[code] ?? { label: "Review the recruitment record before operational work begins.", target: "dbs-suitability" };
}
