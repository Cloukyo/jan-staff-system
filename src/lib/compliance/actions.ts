"use server";

import { revalidatePath } from "next/cache";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";
import { encryptDbsReference } from "@/lib/compliance/dbs-reference-crypto";

export type ComplianceActionState = {
  ok: boolean;
  message: string;
};

const ok = (message: string): ComplianceActionState => ({ ok: true, message });
const fail = (message: string): ComplianceActionState => ({ ok: false, message });

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

async function managerSupabase(permission: "staff.manage" | "compliance.manage") {
  const actor = await requireCustomerDomainActor(permission);
  if (!hasSupabaseConfig()) return null;
  return { actor, supabase: await createSupabaseServerClient() };
}

function revalidateStaffProfileViews(staffId: string): void {
  revalidatePath("/staff");
  revalidatePath("/compliance");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/clock");
  revalidatePath("/attendance");
  revalidatePath("/settings/kiosk");
}

export async function quickUpdateStaffProfileAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const access = await managerSupabase("staff.manage");
  if (!access) return fail("Production Supabase configuration is required.");
  const staffId = text(formData, "staffId");
  const employmentRole = text(formData, "employmentRole");
  if (!staffId || !employmentRole) return fail("Staff ID and role are required.");
  const quickPayload: Record<string, unknown> = {
    employment_role: employmentRole,
    main_qualification_level: text(formData, "mainQualificationLevel"),
  };
  let query = access.supabase.from("staff_profiles").update(quickPayload).eq("id", staffId);
  if (access.actor.kind === "commercial") query = query.eq("organisation_id", access.actor.context.organisationId);
  const { error } = await query;
  if (error) return fail("Quick edit could not be saved.");
  revalidateStaffProfileViews(staffId);
  return ok("Quick edit saved.");
}

export async function updateStaffProfileAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const access = await managerSupabase("staff.manage");
  if (!access) return fail("Demo mode is local only. Configure Supabase to save production staff profiles.");
  const staffId = text(formData, "staffId");
  const fullName = text(formData, "fullName");
  const employmentRole = text(formData, "employmentRole");
  if (!staffId || !fullName || !employmentRole) return fail("Full name and role are required.");
  const profilePayload: Record<string, unknown> = {
    full_name: fullName,
    display_name: text(formData, "displayName") ?? fullName.split(" ")[0],
    employment_role: employmentRole,
    main_qualification_level: text(formData, "mainQualificationLevel"),
    is_apprentice: bool(formData, "isApprentice"),
    is_cover_staff: bool(formData, "isCoverStaff"),
    appointment_date: text(formData, "appointmentDate"),
    email: text(formData, "email"),
    notes: text(formData, "notes"),
  };
  if (access.actor.kind === "commercial") profilePayload.engagement_type = text(formData, "engagementType") ?? "employee";
  let query = access.supabase.from("staff_profiles").update(profilePayload).eq("id", staffId);
  if (access.actor.kind === "commercial") query = query.eq("organisation_id", access.actor.context.organisationId);
  const { error } = await query;
  if (error) return fail("Staff profile could not be saved.");
  revalidateStaffProfileViews(staffId);
  return ok("Staff details saved.");
}

export async function saveQualificationAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const actor = await requireCustomerDomainActor("compliance.manage");
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save production qualifications.");
  const staffId = text(formData, "staffId");
  const name = text(formData, "qualificationName");
  if (!staffId || !name) return fail("Qualification name is required.");
  const id = text(formData, "qualificationId");
  const payload = {
    organisation_id: actor.kind === "commercial" ? actor.context.organisationId : null,
    staff_id: staffId,
    qualification_name: name,
    qualification_level: text(formData, "qualificationLevel"),
    awarding_organisation: text(formData, "awardingOrganisation"),
    award_date: text(formData, "awardDate"),
    expected_completion_date: text(formData, "expectedCompletionDate"),
    permanent: bool(formData, "permanent"),
    evidence_status: text(formData, "evidenceStatus") ?? "awaiting",
    notes: text(formData, "notes"),
    verified_by: bool(formData, "verified") && actor.kind === "legacy" ? actor.account.id : null,
    verified_by_membership_id: bool(formData, "verified") && actor.kind === "commercial" ? actor.context.membershipId : null,
    verified_at: bool(formData, "verified") ? new Date().toISOString() : null,
  };
  let query = id ? supabase.from("staff_qualifications").update(payload).eq("id", id) : supabase.from("staff_qualifications").insert(payload);
  if (id && actor.kind === "commercial") query = query.eq("organisation_id", actor.context.organisationId);
  const { error } = await query;
  if (error) return fail("Qualification could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Qualification saved.");
}

export async function saveCertificateAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const actor = await requireCustomerDomainActor("compliance.manage");
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save production certificates.");
  const staffId = text(formData, "staffId");
  const certificateType = text(formData, "certificateType");
  if (!staffId || !certificateType) return fail("Training type is required.");
  const id = text(formData, "certificateId");
  const noExpiry = bool(formData, "noExpiry");
  const validityMonths = text(formData, "validityMonths");
  const payload = {
    organisation_id: actor.kind === "commercial" ? actor.context.organisationId : null,
    staff_id: staffId,
    certificate_type: certificateType,
    custom_title: text(formData, "customTitle"),
    completion_date: text(formData, "completionDate"),
    expiry_date: noExpiry ? null : text(formData, "expiryDate"),
    validity_months: validityMonths ? Number(validityMonths) : null,
    permanent: bool(formData, "permanent") || noExpiry,
    evidence_status: text(formData, "evidenceStatus") ?? "awaiting",
    notes: text(formData, "notes"),
    verified_by: bool(formData, "verified") && actor.kind === "legacy" ? actor.account.id : null,
    verified_by_membership_id: bool(formData, "verified") && actor.kind === "commercial" ? actor.context.membershipId : null,
    verified_at: bool(formData, "verified") ? new Date().toISOString() : null,
  };
  let query = id ? supabase.from("staff_certificates").update(payload).eq("id", id) : supabase.from("staff_certificates").insert(payload);
  if (id && actor.kind === "commercial") query = query.eq("organisation_id", actor.context.organisationId);
  const { error } = await query;
  if (error) return fail("Certificate could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Certificate saved.");
}

export async function archiveComplianceRecordAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const actor = await requireCustomerDomainActor("compliance.manage");
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to archive production records.");
  const table = text(formData, "table");
  const id = text(formData, "id");
  const staffId = text(formData, "staffId");
  if (!id || !staffId || !["staff_qualifications", "staff_certificates", "staff_reference_checks"].includes(table ?? "")) return fail("Archive request is invalid.");
  let query = supabase.from(table!).update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (actor.kind === "commercial") query = query.eq("organisation_id", actor.context.organisationId);
  const { error } = await query;
  if (error) return fail("Record could not be archived.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Record archived.");
}

export async function saveCentralRecordAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const actor = await requireCustomerDomainActor("compliance.manage");
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save central records.");
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  const basePayload = {
    organisation_id: actor.kind === "commercial" ? actor.context.organisationId : null,
    staff_id: staffId,
    appointment_induction_completed: bool(formData, "appointmentInductionCompleted"),
    contract_form: bool(formData, "contractForm"),
    id_checked: bool(formData, "idChecked"),
    address_evidence_checked: bool(formData, "addressEvidenceChecked"),
    additional_employment_tax_evidence_checked: bool(formData, "additionalEmploymentTaxEvidenceChecked"),
    dbs_recorded: bool(formData, "dbsRecorded"),
    dbs_update_service: bool(formData, "dbsUpdateService"),
    dbs_issue_date: text(formData, "dbsIssueDate"),
    dbs_last_checked_at: text(formData, "dbsLastCheckedAt"),
    dbs_new_check_required: bool(formData, "dbsNewCheckRequired"),
    dbs_number_last4: text(formData, "dbsNumberLast4"),
    references_complete: bool(formData, "referencesComplete"),
    starter_form: bool(formData, "starterForm"),
    suitability_declaration: bool(formData, "suitabilityDeclaration"),
    medical_declaration: bool(formData, "medicalDeclaration"),
    employee_information_form: bool(formData, "employeeInformationForm"),
    checked_by: actor.kind === "legacy" ? actor.account.id : null,
    checked_by_membership_id: actor.kind === "commercial" ? actor.context.membershipId : null,
    checked_at: new Date().toISOString(),
    notes: text(formData, "notes"),
  };
  let payload: Record<string, unknown> = basePayload;
  if (actor.kind === "commercial") {
    const dbsRequirement = text(formData, "dbsRequirement") ?? "assessment_needed";
    const dbsStatus = text(formData, "dbsStatus") ?? "not_started";
    const suitabilityStatus = text(formData, "suitabilityStatus") ?? "not_assessed";
    const occasionalSupervisedVolunteer = bool(formData, "occasionalSupervisedVolunteer");
    if (dbsRequirement === "not_required" && !occasionalSupervisedVolunteer) {
      return fail("Record the supervised occasional-volunteer exception before marking a DBS check as not required.");
    }
    if (dbsRequirement !== "not_required" && dbsStatus === "not_required") {
      return fail("DBS progress can only be marked not required when the documented requirement is not required.");
    }
    const suppliedReference = text(formData, "dbsReference");
    const existing = await supabase.from("staff_central_records")
      .select("dbs_reference_encrypted,dbs_number_last4,dbs_verified_at,dbs_verified_by_membership_id,suitability_status,suitability_decided_at,suitability_decided_by_membership_id,start_authorised_at,start_authorised_by_membership_id")
      .eq("organisation_id", actor.context.organisationId).eq("staff_id", staffId).maybeSingle();
    if (existing.error) return fail("Existing DBS evidence could not be checked.");
    let encryptedReference = existing.data?.dbs_reference_encrypted ?? null;
    let lastFour = existing.data?.dbs_number_last4 ?? null;
    if (suppliedReference) {
      try {
        encryptedReference = encryptDbsReference(suppliedReference);
        lastFour = suppliedReference.replace(/\D/g, "").slice(-4);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "DBS reference could not be protected.");
      }
    }
    const now = new Date().toISOString();
    const verified = dbsStatus === "verified";
    const suitabilityDecided = suitabilityStatus !== "not_assessed";
    payload = {
      ...basePayload,
      dbs_recorded: verified || dbsStatus === "legacy_recorded",
      dbs_number_last4: lastFour,
      dbs_requirement: dbsRequirement,
      dbs_check_level: text(formData, "dbsCheckLevel"),
      dbs_status: dbsStatus,
      dbs_application_date: text(formData, "dbsApplicationDate"),
      dbs_certificate_received_date: text(formData, "dbsCertificateReceivedDate"),
      dbs_reference_encrypted: encryptedReference,
      dbs_verified_at: verified ? existing.data?.dbs_verified_at ?? now : null,
      dbs_verified_by_membership_id: verified ? existing.data?.dbs_verified_by_membership_id ?? actor.context.membershipId : null,
      volunteer_exception: dbsRequirement === "not_required" && occasionalSupervisedVolunteer ? "occasional_supervised" : null,
      suitability_declaration: ["suitable", "suitable_with_restrictions"].includes(suitabilityStatus),
      suitability_status: suitabilityStatus,
      suitability_decided_at: suitabilityDecided ? (existing.data?.suitability_status === suitabilityStatus ? existing.data.suitability_decided_at : null) ?? now : null,
      suitability_decided_by_membership_id: suitabilityDecided ? (existing.data?.suitability_status === suitabilityStatus ? existing.data.suitability_decided_by_membership_id : null) ?? actor.context.membershipId : null,
      start_authorised_at: bool(formData, "authoriseStart") ? existing.data?.start_authorised_at ?? now : null,
      start_authorised_by_membership_id: bool(formData, "authoriseStart") ? existing.data?.start_authorised_by_membership_id ?? actor.context.membershipId : null,
    };
  }
  const { error } = await supabase.from("staff_central_records").upsert(payload, { onConflict: "staff_id" });
  if (error) return fail("Central record could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Central record saved.");
}

export async function saveCentralRecordItemAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const actor = await requireCustomerDomainActor("compliance.manage");
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Production Supabase configuration is required.");
  const staffId = text(formData, "staffId");
  const itemKey = text(formData, "itemKey");
  const status = text(formData, "status");
  if (!staffId || !itemKey || !["complete", "incomplete", "not_applicable"].includes(status ?? "")) return fail("Checklist item is invalid.");
  const { error } = await supabase.from("staff_central_record_items").upsert({
    organisation_id: actor.kind === "commercial" ? actor.context.organisationId : null,
    staff_id: staffId,
    item_key: itemKey,
    status,
    checked_at: text(formData, "checkedAt"),
    checked_by: actor.kind === "legacy" ? actor.account.id : null,
    checked_by_membership_id: actor.kind === "commercial" ? actor.context.membershipId : null,
    notes: text(formData, "notes"),
  }, { onConflict: "staff_id,item_key" });
  if (error) return fail("Checklist item could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Checklist item saved.");
}

export async function saveReferenceAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const actor = await requireCustomerDomainActor("compliance.manage");
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save references.");
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  const id = text(formData, "referenceId");
  const payload = {
    organisation_id: actor.kind === "commercial" ? actor.context.organisationId : null,
    staff_id: staffId,
    reference_type: text(formData, "referenceType") ?? "alternative",
    reference_name: text(formData, "referenceName"),
    method: text(formData, "method"),
    checked_at: text(formData, "checkedAt"),
    checked_by: actor.kind === "legacy" ? actor.account.id : null,
    checked_by_membership_id: actor.kind === "commercial" ? actor.context.membershipId : null,
    satisfactory: bool(formData, "satisfactory"),
    notes: text(formData, "notes"),
  };
  let query = id ? supabase.from("staff_reference_checks").update(payload).eq("id", id) : supabase.from("staff_reference_checks").insert(payload);
  if (id && actor.kind === "commercial") query = query.eq("organisation_id", actor.context.organisationId);
  const { error } = await query;
  if (error) return fail("Reference could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  return ok("Reference saved.");
}
