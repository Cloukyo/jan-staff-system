"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";
import { readFirstWorksheetRows } from "@/lib/exports/workbook-reader";
import { loadPayrollReview } from "@/lib/payroll/review";
import type { PayrollActionState } from "@/lib/payroll/actions";

const ok = (message: string): PayrollActionState => ({ ok: true, message });
const fail = (message: string): PayrollActionState => ({ ok: false, message });
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const optionalNumber = (value: string) => value && Number.isFinite(Number(value)) ? Number(value) : null;
const normaliseName = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

export async function createPayrollReviewBatchAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const actor = await requireCustomerDomainActor("payroll.prepare");
  const file = formData.get("workbook");
  const proposedEffectiveDate = text(formData, "proposedEffectiveDate");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size === 0 || file.size > 5_000_000) {
    return fail("Choose a valid .xlsx workbook smaller than 5 MB.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedEffectiveDate)) return fail("Choose a proposed effective date.");

  let sourceRows: unknown[][];
  try {
    sourceRows = await readFirstWorksheetRows(await file.arrayBuffer());
  } catch {
    return fail("The workbook could not be read.");
  }

  const headerIndex = sourceRows.slice(0, 12).reduce((best, row, index, all) => {
    const score = row.slice(1).filter((value) => typeof value === "string" && value.trim().length > 1).length;
    const bestScore = all[best]?.slice(1).filter((value) => typeof value === "string" && value.trim().length > 1).length ?? 0;
    return score > bestScore ? index : best;
  }, 0);
  const names = sourceRows[headerIndex] ?? [];
  const possibleRates = sourceRows[headerIndex + 8] ?? [];
  const candidates: Array<{ sourceRowIndex: number; sourceName: string; rate: number | null; payType: "hourly" | "salaried" | null }> = names.slice(1).map((value, offset) => ({
    sourceRowIndex: offset + 1,
    sourceName: typeof value === "string" ? value.trim() : "",
    rate: typeof possibleRates[offset + 1] === "number" ? Number(possibleRates[offset + 1]) : null,
    payType: typeof possibleRates[offset + 1] === "number" ? "hourly" as const : null,
  })).filter((row) => row.sourceName);
  if (!candidates.length) return fail("No staff columns were found in the first worksheet.");

  const supabase = await createSupabaseServerClient();
  let profilesQuery = supabase.from("staff_profiles").select("id,full_name");
  profilesQuery = actor.kind === "commercial"
    ? profilesQuery.eq("organisation_id", actor.context.organisationId)
    : profilesQuery.is("organisation_id", null);
  const profilesResult = await profilesQuery;
  if (profilesResult.error) return fail("Canonical staff profiles could not be loaded.");
  const profilesByName = new Map<string, Array<{ id: string; fullName: string }>>();
  for (const profile of profilesResult.data ?? []) {
    const key = normaliseName(profile.full_name);
    profilesByName.set(key, [...(profilesByName.get(key) ?? []), { id: profile.id, fullName: profile.full_name }]);
  }
  const existingSourceNames = new Set(candidates.map((candidate) => normaliseName(candidate.sourceName)));
  const salaryNotes = sourceRows.flat().filter((value): value is string =>
    typeof value === "string" && /salary|salaried/i.test(value)
  );
  for (const profile of profilesResult.data ?? []) {
    const profileName = normaliseName(profile.full_name);
    if (existingSourceNames.has(profileName)) continue;
    if (salaryNotes.some((note) => normaliseName(note).includes(profileName))) {
      candidates.push({
        sourceRowIndex: candidates.length + 1,
        sourceName: profile.full_name,
        rate: null,
        payType: "salaried",
      });
      existingSourceNames.add(profileName);
    }
  }

  const reviewRows = candidates.map((candidate) => {
    const matches = profilesByName.get(normaliseName(candidate.sourceName)) ?? [];
    const suggested = matches.length === 1 ? matches[0] : null;
    return {
      source_row_index: candidate.sourceRowIndex,
      source_name: candidate.sourceName,
      suggested_staff_id: suggested?.id ?? null,
      match_confidence: suggested ? "high" : "none",
      pay_type: candidate.payType,
      hourly_rate: candidate.rate && candidate.rate > 0 ? candidate.rate : null,
      effective_from: proposedEffectiveDate,
      source_warnings: [
        ...(suggested ? [] : ["No exact canonical staff match was found."]),
        ...(candidate.rate && candidate.rate > 0 ? [] : ["Rate or salary basis requires manager review."]),
        "Contracted weekly hours require manager review.",
        "The proposed effective date requires manager confirmation.",
      ],
    };
  });

  if (actor.kind === "commercial") {
    const { data, error } = await supabase.rpc("preview_commercial_payroll_import_batch", {
      target_membership_id: actor.context.membershipId,
      target_site_id: actor.context.selectedSiteId,
      target_operation_id: crypto.randomUUID(),
      target_source_filename: file.name,
      target_proposed_effective_date: proposedEffectiveDate,
      target_global_effective_date_confirmed: false,
      input_rows: reviewRows.map((row) => ({
        sourceRowIndex: row.source_row_index,
        sourceName: row.source_name,
        suggestedStaffId: row.suggested_staff_id,
        selectedStaffId: null,
        matchConfidence: row.match_confidence,
        resolution: "unresolved",
        payType: row.pay_type,
        hourlyRate: row.hourly_rate,
        annualSalary: null,
        monthlySalary: null,
        contractedWeeklyHours: null,
        hoursBasis: "contracted",
        effectiveFrom: row.effective_from,
        managerNotes: null,
        sourceWarnings: row.source_warnings,
        duplicateMappingConfirmed: false,
      })),
    });
    if (error || !data) return fail("The commercial payroll review preview could not be created.");
    revalidatePath("/payroll/review");
    return ok(`Private review batch created with ${reviewRows.length} row(s). No pay arrangements were imported.`);
  }

  const batchResult = await supabase.from("payroll_import_batches").insert({
    source_filename: file.name,
    proposed_effective_date: proposedEffectiveDate,
    created_by: actor.account.id,
  }).select("id").single();
  if (batchResult.error) return fail("The private payroll review batch could not be created.");
  const legacyReviewRows = reviewRows.map((row) => ({
    ...row,
    batch_id: batchResult.data.id,
    created_by: actor.account.id,
    updated_by: actor.account.id,
  }));
  const rowsResult = await supabase.from("payroll_import_review_rows").insert(legacyReviewRows);
  if (rowsResult.error) {
    await supabase.from("payroll_import_batches").delete().eq("id", batchResult.data.id);
    return fail("The workbook rows could not be saved for private review.");
  }
  revalidatePath("/payroll/review");
  return ok(`Private review batch created with ${reviewRows.length} row(s). No pay arrangements were imported.`);
}

export async function savePayrollReviewRowAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const actor = await requireCustomerDomainActor("payroll.prepare");
  const rowId = text(formData, "rowId");
  const batchId = text(formData, "batchId");
  const resolution = text(formData, "resolution");
  const payType = text(formData, "payType");
  const salaryPeriod = text(formData, "salaryPeriod");
  const salaryBasis = optionalNumber(text(formData, "salaryBasis"));
  if (!rowId || !batchId || !["unresolved", "current_staff", "former_staff", "external", "excluded"].includes(resolution)) {
    return fail("Choose a valid row decision.");
  }
  const supabase = await createSupabaseServerClient();
  if (actor.kind === "commercial") {
    const { error } = await supabase.rpc("save_commercial_payroll_import_review_row", {
      target_batch_id: batchId,
      target_row_id: rowId,
      target_resolution: resolution,
      target_selected_staff_id: text(formData, "selectedStaffId") || null,
      target_pay_type: ["hourly", "salaried"].includes(payType) ? payType : null,
      target_hourly_rate: payType === "hourly" ? optionalNumber(text(formData, "hourlyRate")) : null,
      target_annual_salary: payType === "salaried" && salaryPeriod === "annual" ? salaryBasis : null,
      target_monthly_salary: payType === "salaried" && salaryPeriod === "monthly" ? salaryBasis : null,
      target_contracted_weekly_hours: optionalNumber(text(formData, "contractedWeeklyHours")),
      target_hours_basis: text(formData, "hoursBasis") || "contracted",
      target_effective_from: text(formData, "effectiveFrom") || null,
      target_manager_notes: text(formData, "managerNotes") || null,
      target_duplicate_mapping_confirmed: formData.get("duplicateMappingConfirmed") === "on",
    });
    if (error) return fail("This commercial review row could not be saved.");
    revalidatePath("/payroll/review");
    return ok("Review row saved. No pay arrangement was imported.");
  }
  const { error } = await supabase.from("payroll_import_review_rows").update({
    resolution,
    selected_staff_id: text(formData, "selectedStaffId") || null,
    pay_type: ["hourly", "salaried"].includes(payType) ? payType : null,
    hourly_rate: payType === "hourly" ? optionalNumber(text(formData, "hourlyRate")) : null,
    annual_salary: payType === "salaried" && salaryPeriod === "annual" ? salaryBasis : null,
    monthly_salary: payType === "salaried" && salaryPeriod === "monthly" ? salaryBasis : null,
    contracted_weekly_hours: optionalNumber(text(formData, "contractedWeeklyHours")),
    hours_basis: text(formData, "hoursBasis") || "contracted",
    effective_from: text(formData, "effectiveFrom") || null,
    manager_notes: text(formData, "managerNotes") || null,
    duplicate_mapping_confirmed: formData.get("duplicateMappingConfirmed") === "on",
    updated_by: actor.account.id,
  }).eq("id", rowId).eq("batch_id", batchId);
  if (error) return fail("This review row could not be saved. Ready or imported batches are locked.");
  revalidatePath("/payroll/review");
  return ok("Review row saved. No pay arrangement was imported.");
}

export async function updatePayrollBatchDateConfirmationAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const actor = await requireCustomerDomainActor("payroll.prepare");
  const batchId = text(formData, "batchId");
  const date = text(formData, "proposedEffectiveDate");
  if (!batchId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Choose a valid proposed date.");
  const supabase = await createSupabaseServerClient();
  if (actor.kind === "commercial") {
    const { error } = await supabase.rpc("update_commercial_payroll_import_batch_date", {
      target_batch_id: batchId,
      target_proposed_effective_date: date,
      target_global_effective_date_confirmed: formData.get("globalEffectiveDateConfirmed") === "on",
    });
    if (error) return fail("The commercial batch date confirmation could not be saved.");
    revalidatePath("/payroll/review");
    return ok("Batch date settings saved.");
  }
  const { error } = await supabase.from("payroll_import_batches").update({
    proposed_effective_date: date,
    global_effective_date_confirmed: formData.get("globalEffectiveDateConfirmed") === "on",
  }).eq("id", batchId).eq("status", "draft");
  if (error) return fail("The batch date confirmation could not be saved.");
  revalidatePath("/payroll/review");
  return ok("Batch date settings saved.");
}

export async function markPayrollBatchReadyAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const actor = await requireCustomerDomainActor("payroll.prepare");
  const batchId = text(formData, "batchId");
  if (!batchId) return fail("Choose a payroll review batch.");
  if (actor.kind === "commercial") {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("mark_commercial_payroll_import_batch_ready", {
      target_batch_id: batchId,
      target_operation_id: batchId,
    });
    if (error) return fail("Resolve every warning before marking this commercial batch ready.");
    revalidatePath("/payroll/review");
    return ok("Review approved and locked. A separate final confirmation is still required to import arrangements.");
  }
  const review = await loadPayrollReview(batchId);
  if (!review.batch || !review.validation?.summary.readyForImport) return fail("Resolve every warning before marking this batch ready.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("payroll_import_batches").update({
    status: "ready",
    approved_by: actor.account.id,
    approved_at: new Date().toISOString(),
  }).eq("id", batchId).eq("status", "draft");
  if (error) return fail("The review batch could not be marked ready.");
  revalidatePath("/payroll/review");
  return ok("Review approved and locked. A separate final confirmation is still required to import arrangements.");
}

export async function importPayrollBatchAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const actor = await requireCustomerDomainActor("payroll.prepare");
  const batchId = text(formData, "batchId");
  if (text(formData, "confirmation") !== "IMPORT") return fail("Type IMPORT to confirm the production write.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = actor.kind === "commercial"
    ? await supabase.rpc("commit_commercial_payroll_import_batch", {
      target_batch_id: batchId,
      target_operation_id: batchId,
    })
    : await supabase.rpc("apply_legacy_payroll_import_batch", { target_batch_id: batchId });
  if (error) return fail("The import was blocked. Check readiness and existing arrangement overlaps.");
  revalidatePath("/payroll/review");
  revalidatePath("/payroll/arrangements");
  revalidatePath("/payroll");
  const importedCount = actor.kind === "commercial"
    ? Number((data as { importedCount?: number } | null)?.importedCount ?? 0)
    : Number(data);
  return ok(`${importedCount} approved pay arrangement(s) imported.`);
}
