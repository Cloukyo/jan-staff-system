import type {
  EvidenceStatus,
  StaffCertificate,
  StaffCentralRecord,
  StaffProfile,
  StaffQualification,
  StaffReferenceCheck,
} from "@/types";
import { getAppMode } from "@/lib/app-mode";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type ComplianceImportWarning = {
  id: string;
  staffId: string | null;
  status: string;
  warnings: string[];
  createdAt: string;
};

export type ComplianceAccountStatus = {
  staffId: string;
  email: string | null;
  authUserId: string | null;
  active: boolean;
};

export type ComplianceDataset = {
  staff: StaffProfile[];
  qualifications: StaffQualification[];
  certificates: StaffCertificate[];
  centralRecords: StaffCentralRecord[];
  references: StaffReferenceCheck[];
  importWarnings: ComplianceImportWarning[];
  accounts: ComplianceAccountStatus[];
  centralItems: Array<{ id: string; staffId: string; itemKey: string; status: string; checkedAt: string | null; checkedBy: string | null; notes: string | null }>;
};

export type StaffComplianceRecord = {
  staff: StaffProfile;
  qualifications: StaffQualification[];
  certificates: StaffCertificate[];
  centralRecord: StaffCentralRecord | null;
  centralItems: Array<{ id: string; itemKey: string; status: string; checkedAt: string | null; checkedBy: string | null; notes: string | null }>;
  references: StaffReferenceCheck[];
  importWarnings: ComplianceImportWarning[];
  account: ComplianceAccountStatus | null;
};

function configurationError(): Error {
  return new Error("Production compliance mode requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
}

export function complianceRepositorySource(mode = getAppMode(), configured = hasSupabaseConfig()): "demo" | "supabase" {
  if (mode === "demo") return "demo";
  if (!configured) throw configurationError();
  return "supabase";
}

function ensureProductionConfig() {
  if (complianceRepositorySource() !== "supabase") throw new Error("The Supabase compliance repository is available only in production mode.");
}

function profile(row: Record<string, unknown>): StaffProfile {
  return {
    id: String(row.id),
    fullName: String(row.full_name),
    displayName: String(row.display_name),
    employmentRole: String(row.employment_role),
    mainQualificationLevel: row.main_qualification_level ? String(row.main_qualification_level) : null,
    isApprentice: Boolean(row.is_apprentice),
    isCoverStaff: Boolean(row.is_cover_staff),
    appointmentDate: row.appointment_date ? String(row.appointment_date) : null,
    active: Boolean(row.active),
    authUserId: row.auth_user_id ? String(row.auth_user_id) : null,
    email: row.email ? String(row.email) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function qualification(row: Record<string, unknown>): StaffQualification {
  return {
    id: String(row.id),
    staffId: String(row.staff_id),
    qualificationName: String(row.qualification_name),
    qualificationLevel: row.qualification_level ? String(row.qualification_level) : null,
    awardingOrganisation: row.awarding_organisation ? String(row.awarding_organisation) : null,
    awardDate: row.award_date ? String(row.award_date) : null,
    expectedCompletionDate: row.expected_completion_date ? String(row.expected_completion_date) : null,
    permanent: Boolean(row.permanent),
    evidenceStatus: String(row.evidence_status ?? "awaiting") as EvidenceStatus,
    evidenceReference: row.evidence_reference ? String(row.evidence_reference) : null,
    notes: row.notes ? String(row.notes) : null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function certificate(row: Record<string, unknown>): StaffCertificate {
  return {
    id: String(row.id),
    staffId: String(row.staff_id),
    certificateType: String(row.certificate_type),
    customTitle: row.custom_title ? String(row.custom_title) : null,
    completionDate: row.completion_date ? String(row.completion_date) : null,
    expiryDate: row.expiry_date ? String(row.expiry_date) : null,
    validityMonths: row.validity_months === null || row.validity_months === undefined ? null : Number(row.validity_months),
    permanent: Boolean(row.permanent),
    evidenceStatus: String(row.evidence_status ?? "awaiting") as EvidenceStatus,
    evidenceReference: row.evidence_reference ? String(row.evidence_reference) : null,
    notes: row.notes ? String(row.notes) : null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function centralRecord(row: Record<string, unknown>): StaffCentralRecord {
  return {
    id: String(row.id),
    staffId: String(row.staff_id),
    appointmentInductionCompleted: Boolean(row.appointment_induction_completed),
    appointmentInductionCheckedAt: row.appointment_induction_checked_at ? String(row.appointment_induction_checked_at) : null,
    contractForm: Boolean(row.contract_form),
    contractFormCheckedAt: row.contract_form_checked_at ? String(row.contract_form_checked_at) : null,
    idChecked: Boolean(row.id_checked),
    idCheckedAt: row.id_checked_at ? String(row.id_checked_at) : null,
    addressEvidenceChecked: Boolean(row.address_evidence_checked),
    addressEvidenceCheckedAt: row.address_evidence_checked_at ? String(row.address_evidence_checked_at) : null,
    additionalEmploymentTaxEvidenceChecked: Boolean(row.additional_employment_tax_evidence_checked),
    additionalEmploymentTaxEvidenceCheckedAt: row.additional_employment_tax_evidence_checked_at ? String(row.additional_employment_tax_evidence_checked_at) : null,
    dbsRecorded: Boolean(row.dbs_recorded),
    dbsUpdateService: Boolean(row.dbs_update_service),
    dbsIssueDate: row.dbs_issue_date ? String(row.dbs_issue_date) : null,
    dbsLastCheckedAt: row.dbs_last_checked_at ? String(row.dbs_last_checked_at) : null,
    dbsNumberLast4: row.dbs_number_last4 ? String(row.dbs_number_last4) : null,
    dbsNewCheckRequired: Boolean(row.dbs_new_check_required),
    referencesComplete: Boolean(row.references_complete),
    referencesCheckedAt: row.references_checked_at ? String(row.references_checked_at) : null,
    starterForm: Boolean(row.starter_form),
    starterFormCheckedAt: row.starter_form_checked_at ? String(row.starter_form_checked_at) : null,
    suitabilityDeclaration: Boolean(row.suitability_declaration),
    suitabilityDeclarationCheckedAt: row.suitability_declaration_checked_at ? String(row.suitability_declaration_checked_at) : null,
    medicalDeclaration: Boolean(row.medical_declaration),
    medicalDeclarationCheckedAt: row.medical_declaration_checked_at ? String(row.medical_declaration_checked_at) : null,
    employeeInformationForm: Boolean(row.employee_information_form),
    employeeInformationFormCheckedAt: row.employee_information_form_checked_at ? String(row.employee_information_form_checked_at) : null,
    checkedBy: row.checked_by ? String(row.checked_by) : null,
    checkedAt: row.checked_at ? String(row.checked_at) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function reference(row: Record<string, unknown>): StaffReferenceCheck {
  return {
    id: String(row.id),
    staffId: String(row.staff_id),
    referenceType: String(row.reference_type) as StaffReferenceCheck["referenceType"],
    referenceName: row.reference_name ? String(row.reference_name) : null,
    method: row.method ? String(row.method) as StaffReferenceCheck["method"] : null,
    satisfactory: row.satisfactory === null || row.satisfactory === undefined ? null : Boolean(row.satisfactory),
    notes: row.notes ? String(row.notes) : null,
    checkedBy: row.checked_by ? String(row.checked_by) : null,
    checkedAt: row.checked_at ? String(row.checked_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function assertQuery<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label} could not be loaded: ${result.error.message}`);
  return result.data ?? ([] as T);
}

export async function loadProductionComplianceDataset(): Promise<ComplianceDataset> {
  ensureProductionConfig();
  const supabase = await createSupabaseServerClient();
  const [staffResult, qualificationResult, certificateResult, centralResult, referenceResult, importResult, accountResult, centralItemsResult] = await Promise.all([
    supabase.from("staff_profiles").select("*").order("full_name"),
    supabase.from("staff_qualifications").select("*").is("archived_at", null),
    supabase.from("staff_certificates").select("*").is("archived_at", null),
    supabase.from("staff_central_records").select("*"),
    supabase.from("staff_reference_checks").select("*").is("archived_at", null),
    supabase.from("staff_import_reviews").select("*").order("created_at", { ascending: false }),
    supabase.from("staff_accounts").select("staff_id,email,auth_user_id,active"),
    supabase.from("staff_central_record_items").select("*"),
  ]);
  const staffRows = assertQuery(staffResult, "Staff profiles") as Record<string, unknown>[];
  const qualificationRows = assertQuery(qualificationResult, "Qualifications") as Record<string, unknown>[];
  const certificateRows = assertQuery(certificateResult, "Certificates") as Record<string, unknown>[];
  const centralRows = assertQuery(centralResult, "Central records") as Record<string, unknown>[];
  const referenceRows = assertQuery(referenceResult, "References") as Record<string, unknown>[];
  const importRows = assertQuery(importResult, "Import warnings") as Record<string, unknown>[];
  const accountRows = assertQuery(accountResult, "Account status") as Record<string, unknown>[];
  const centralItemRows = assertQuery(centralItemsResult, "Central-record items") as Record<string, unknown>[];
  return {
    staff: staffRows.map(profile),
    qualifications: qualificationRows.map(qualification),
    certificates: certificateRows.map(certificate),
    centralRecords: centralRows.map(centralRecord),
    references: referenceRows.map(reference),
    importWarnings: importRows.map((row) => ({
      id: String(row.id),
      staffId: row.imported_staff_id ? String(row.imported_staff_id) : null,
      status: String(row.review_status),
      warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
      createdAt: String(row.created_at),
    })),
    accounts: accountRows.map((row) => ({
      staffId: String(row.staff_id),
      email: row.email ? String(row.email) : null,
      authUserId: row.auth_user_id ? String(row.auth_user_id) : null,
      active: Boolean(row.active),
    })),
    centralItems: centralItemRows.map((row) => ({
      id: String(row.id),
      staffId: String(row.staff_id),
      itemKey: String(row.item_key),
      status: String(row.status),
      checkedAt: row.checked_at ? String(row.checked_at) : null,
      checkedBy: row.checked_by ? String(row.checked_by) : null,
      notes: row.notes ? String(row.notes) : null,
    })),
  };
}

export async function loadProductionStaffCompliance(staffId: string): Promise<StaffComplianceRecord | null> {
  const dataset = await loadProductionComplianceDataset();
  const staff = dataset.staff.find((person) => person.id === staffId);
  if (!staff) return null;
  return {
    staff,
    qualifications: dataset.qualifications.filter((item) => item.staffId === staffId),
    certificates: dataset.certificates.filter((item) => item.staffId === staffId),
    centralRecord: dataset.centralRecords.find((item) => item.staffId === staffId) ?? null,
    centralItems: dataset.centralItems.filter((item) => item.staffId === staffId).map((item) => ({
      id: item.id,
      itemKey: item.itemKey,
      status: item.status,
      checkedAt: item.checkedAt,
      checkedBy: item.checkedBy,
      notes: item.notes,
    })),
    references: dataset.references.filter((item) => item.staffId === staffId),
    importWarnings: dataset.importWarnings.filter((item) => item.staffId === staffId),
    account: dataset.accounts.find((item) => item.staffId === staffId) ?? null,
  };
}
