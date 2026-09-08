import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { decryptDbsReference } from "@/lib/compliance/dbs-reference-crypto";
import { deriveRecruitmentReadiness } from "@/lib/compliance/recruitment-readiness";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";
import { isoDateInLondon } from "@/lib/dates/format";
import { buildComplianceEvidenceWorkbook, complianceEvidenceFilename } from "@/lib/exports/compliance-evidence";

function label(value: unknown): string {
  return value ? String(value).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()) : "Not recorded";
}

export async function buildComplianceEvidenceExportServer() {
  const actor = await requireCustomerDomainActor("compliance.manage");
  if (actor.kind !== "commercial") throw new Error("Commercial organisation access is required.");
  const supabase = await createSupabaseServerClient();
  const organisationId = actor.context.organisationId;
  const [organisationResult, staffResult, centralResult, membershipResult, readinessResult] = await Promise.all([
    supabase.from("organisations").select("display_name").eq("id", organisationId).single(),
    supabase.from("staff_profiles").select("id,full_name,employment_role,engagement_type,appointment_date,active").eq("organisation_id", organisationId).order("full_name"),
    supabase.from("staff_central_records").select("*").eq("organisation_id", organisationId),
    supabase.from("organisation_memberships").select("id,staff_id").eq("organisation_id", organisationId),
    supabase.from("staff_recruitment_readiness").select("staff_id,dbs_receipt_confirmed").eq("organisation_id", organisationId),
  ]);
  if (organisationResult.error || staffResult.error || centralResult.error || membershipResult.error || readinessResult.error) throw new Error("Staff checks evidence could not be loaded.");
  const receipts = new Map((readinessResult.data ?? []).map((row) => [String(row.staff_id), row.dbs_receipt_confirmed === true]));
  const centralByStaff = new Map((centralResult.data ?? []).map((row) => [String(row.staff_id), row]));
  const staffNames = new Map((staffResult.data ?? []).map((row) => [String(row.id), String(row.full_name)]));
  const verifierNames = new Map((membershipResult.data ?? []).map((row) => [String(row.id), row.staff_id ? staffNames.get(String(row.staff_id)) ?? "Organisation manager" : "Organisation owner account"]));
  const today = isoDateInLondon();
  const rows = (staffResult.data ?? []).map((staff) => {
    const record = centralByStaff.get(String(staff.id));
    const readiness = deriveRecruitmentReadiness({
      active: Boolean(staff.active), engagementType: staff.engagement_type ?? "employee", proposedStartDate: staff.appointment_date,
      dbsRequirement: record?.dbs_requirement ?? "assessment_needed", dbsCheckLevel: record?.dbs_check_level ?? null,
      dbsStatus: record?.dbs_status ?? "not_started", dbsCertificateReceivedDate: record?.dbs_certificate_received_date ?? null,
      dbsVerifiedAt: record?.dbs_verified_at ?? null, hasFullDbsReference: Boolean(record?.dbs_reference_encrypted),
      dbsReceiptConfirmed: receipts.get(String(staff.id)) === true, dbsRecorded: record?.dbs_recorded === true,
      suitabilityStatus: record?.suitability_status ?? "not_assessed", suitabilityDecidedAt: record?.suitability_decided_at ?? null,
      startAuthorisedAt: record?.start_authorised_at ?? null, volunteerException: record?.volunteer_exception ?? null,
    }, today);
    return {
      staffName: staff.full_name, engagementType: label(staff.engagement_type), role: staff.employment_role,
      proposedStartDate: staff.appointment_date, dbsRequirement: label(record?.dbs_requirement), dbsCheckLevel: label(record?.dbs_check_level),
      dbsStatus: label(record?.dbs_status), dbsReference: record?.dbs_reference_encrypted ? decryptDbsReference(record.dbs_reference_encrypted) : "Not fully recorded",
      dbsCertificateReceivedDate: record?.dbs_certificate_received_date ?? null, dbsVerifiedAt: record?.dbs_verified_at ?? null,
      receiptTiming: record?.dbs_requirement === "not_required" ? "Not applicable" : receipts.get(String(staff.id)) ? "Confirmed by manager" : "Receipt timing unconfirmed - manager confirmation required",
      dbsVerifiedBy: record?.dbs_verified_by_membership_id ? verifierNames.get(String(record.dbs_verified_by_membership_id)) ?? "Organisation manager" : "Not recorded",
      suitabilityStatus: label(record?.suitability_status), suitabilityDecidedAt: record?.suitability_decided_at ?? null,
      restrictions: readiness.restrictionCodes.length ? readiness.restrictionCodes.map(label).join(", ") : "None",
      outstandingActions: readiness.blockerCodes.length ? readiness.blockerCodes.map(label).join(", ") : "None",
    };
  });
  const now = new Date();
  const bytes = await buildComplianceEvidenceWorkbook({ organisationName: organisationResult.data.display_name, generatedAt: now, rows });
  const fileName = complianceEvidenceFilename(now);
  const audit = await supabase.from("compliance_evidence_export_audits").insert({
    organisation_id: organisationId, exported_by_membership_id: actor.context.membershipId, file_name: fileName,
    digest: createHash("sha256").update(bytes).digest("hex"), row_count: rows.length,
  });
  if (audit.error) throw new Error("Staff checks export audit could not be recorded.");
  return { bytes, fileName, rowCount: rows.length };
}
