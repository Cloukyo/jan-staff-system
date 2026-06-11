"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/permissions";
import { hasSupabaseConfig } from "@/lib/auth/config";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

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

async function managerSupabase() {
  await requireAccount(["manager"]);
  if (!hasSupabaseConfig()) return null;
  return createSupabaseServerClient();
}

export async function createStaffProfileAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const supabase = await managerSupabase();
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save production staff profiles.");
  const fullName = text(formData, "fullName");
  const employmentRole = text(formData, "employmentRole");
  if (!fullName || !employmentRole) return fail("Full name and role are required.");
  const id = crypto.randomUUID();
  const { error } = await supabase.from("staff_profiles").insert({
    id,
    full_name: fullName,
    display_name: text(formData, "displayName") ?? fullName.split(" ")[0],
    employment_role: employmentRole,
    main_qualification_level: text(formData, "mainQualificationLevel"),
    appointment_date: text(formData, "appointmentDate"),
    active: bool(formData, "active"),
  });
  if (error) return fail("Staff profile could not be created. Check for a duplicate staff record.");
  revalidatePath("/compliance");
  redirect(`/compliance/staff/${id}`);
}

export async function quickUpdateStaffProfileAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const supabase = await managerSupabase();
  if (!supabase) return fail("Production Supabase configuration is required.");
  const staffId = text(formData, "staffId");
  const employmentRole = text(formData, "employmentRole");
  if (!staffId || !employmentRole) return fail("Staff ID and role are required.");
  const { error } = await supabase.from("staff_profiles").update({
    employment_role: employmentRole,
    main_qualification_level: text(formData, "mainQualificationLevel"),
    active: bool(formData, "active"),
  }).eq("id", staffId);
  if (error) return fail("Quick edit could not be saved.");
  revalidatePath("/compliance");
  revalidatePath(`/compliance/staff/${staffId}`);
  return ok("Quick edit saved.");
}

export async function updateStaffProfileAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const supabase = await managerSupabase();
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save production staff profiles.");
  const staffId = text(formData, "staffId");
  const fullName = text(formData, "fullName");
  const employmentRole = text(formData, "employmentRole");
  if (!staffId || !fullName || !employmentRole) return fail("Full name and role are required.");
  const { error } = await supabase.from("staff_profiles").update({
    full_name: fullName,
    display_name: text(formData, "displayName") ?? fullName.split(" ")[0],
    employment_role: employmentRole,
    main_qualification_level: text(formData, "mainQualificationLevel"),
    is_apprentice: bool(formData, "isApprentice"),
    is_cover_staff: bool(formData, "isCoverStaff"),
    appointment_date: text(formData, "appointmentDate"),
    active: bool(formData, "active"),
    email: text(formData, "email"),
    notes: text(formData, "notes"),
  }).eq("id", staffId);
  if (error) return fail("Staff profile could not be saved.");
  revalidatePath("/compliance");
  revalidatePath(`/compliance/staff/${staffId}`);
  return ok("Staff details saved.");
}

export async function saveQualificationAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const account = await requireAccount(["manager"]);
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save production qualifications.");
  const staffId = text(formData, "staffId");
  const name = text(formData, "qualificationName");
  if (!staffId || !name) return fail("Qualification name is required.");
  const id = text(formData, "qualificationId");
  const payload = {
    staff_id: staffId,
    qualification_name: name,
    qualification_level: text(formData, "qualificationLevel"),
    awarding_organisation: text(formData, "awardingOrganisation"),
    award_date: text(formData, "awardDate"),
    expected_completion_date: text(formData, "expectedCompletionDate"),
    permanent: bool(formData, "permanent"),
    evidence_status: text(formData, "evidenceStatus") ?? "awaiting",
    notes: text(formData, "notes"),
    verified_by: bool(formData, "verified") ? account.id : null,
    verified_at: bool(formData, "verified") ? new Date().toISOString() : null,
  };
  const { error } = id ? await supabase.from("staff_qualifications").update(payload).eq("id", id) : await supabase.from("staff_qualifications").insert(payload);
  if (error) return fail("Qualification could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Qualification saved.");
}

export async function saveCertificateAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const account = await requireAccount(["manager"]);
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save production certificates.");
  const staffId = text(formData, "staffId");
  const certificateType = text(formData, "certificateType");
  if (!staffId || !certificateType) return fail("Training type is required.");
  const id = text(formData, "certificateId");
  const noExpiry = bool(formData, "noExpiry");
  const validityMonths = text(formData, "validityMonths");
  const payload = {
    staff_id: staffId,
    certificate_type: certificateType,
    custom_title: text(formData, "customTitle"),
    completion_date: text(formData, "completionDate"),
    expiry_date: noExpiry ? null : text(formData, "expiryDate"),
    validity_months: validityMonths ? Number(validityMonths) : null,
    permanent: bool(formData, "permanent") || noExpiry,
    evidence_status: text(formData, "evidenceStatus") ?? "awaiting",
    notes: text(formData, "notes"),
    verified_by: bool(formData, "verified") ? account.id : null,
    verified_at: bool(formData, "verified") ? new Date().toISOString() : null,
  };
  const { error } = id ? await supabase.from("staff_certificates").update(payload).eq("id", id) : await supabase.from("staff_certificates").insert(payload);
  if (error) return fail("Certificate could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Certificate saved.");
}

export async function archiveComplianceRecordAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  await requireAccount(["manager"]);
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to archive production records.");
  const table = text(formData, "table");
  const id = text(formData, "id");
  const staffId = text(formData, "staffId");
  if (!id || !staffId || !["staff_qualifications", "staff_certificates", "staff_reference_checks"].includes(table ?? "")) return fail("Archive request is invalid.");
  const { error } = await supabase.from(table!).update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail("Record could not be archived.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Record archived.");
}

export async function saveCentralRecordAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const account = await requireAccount(["manager"]);
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save central records.");
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  const payload = {
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
    checked_by: account.id,
    checked_at: new Date().toISOString(),
    notes: text(formData, "notes"),
  };
  const { error } = await supabase.from("staff_central_records").upsert(payload, { onConflict: "staff_id" });
  if (error) return fail("Central record could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Central record saved.");
}

export async function saveCentralRecordItemAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const account = await requireAccount(["manager"]);
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Production Supabase configuration is required.");
  const staffId = text(formData, "staffId");
  const itemKey = text(formData, "itemKey");
  const status = text(formData, "status");
  if (!staffId || !itemKey || !["complete", "incomplete", "not_applicable"].includes(status ?? "")) return fail("Checklist item is invalid.");
  const { error } = await supabase.from("staff_central_record_items").upsert({
    staff_id: staffId,
    item_key: itemKey,
    status,
    checked_at: text(formData, "checkedAt"),
    checked_by: account.id,
    notes: text(formData, "notes"),
  }, { onConflict: "staff_id,item_key" });
  if (error) return fail("Checklist item could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  revalidatePath("/compliance");
  return ok("Checklist item saved.");
}

export async function saveReferenceAction(_state: ComplianceActionState, formData: FormData): Promise<ComplianceActionState> {
  const account = await requireAccount(["manager"]);
  const supabase = hasSupabaseConfig() ? await createSupabaseServerClient() : null;
  if (!supabase) return fail("Demo mode is local only. Configure Supabase to save references.");
  const staffId = text(formData, "staffId");
  if (!staffId) return fail("Staff profile is required.");
  const id = text(formData, "referenceId");
  const payload = {
    staff_id: staffId,
    reference_type: text(formData, "referenceType") ?? "alternative",
    reference_name: text(formData, "referenceName"),
    method: text(formData, "method"),
    checked_at: text(formData, "checkedAt"),
    checked_by: account.id,
    satisfactory: bool(formData, "satisfactory"),
    notes: text(formData, "notes"),
  };
  const { error } = id ? await supabase.from("staff_reference_checks").update(payload).eq("id", id) : await supabase.from("staff_reference_checks").insert(payload);
  if (error) return fail("Reference could not be saved.");
  revalidatePath(`/compliance/staff/${staffId}`);
  return ok("Reference saved.");
}
