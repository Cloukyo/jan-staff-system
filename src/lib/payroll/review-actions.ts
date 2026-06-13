"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { loadPayrollReview } from "@/lib/payroll/review";
import type { PayrollActionState } from "@/lib/payroll/actions";

const ok = (message: string): PayrollActionState => ({ ok: true, message });
const fail = (message: string): PayrollActionState => ({ ok: false, message });
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const optionalNumber = (value: string) => value && Number.isFinite(Number(value)) ? Number(value) : null;
const normaliseName = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

export async function createPayrollReviewBatchAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const account = await requireAccount(["manager"]);
  const file = formData.get("workbook");
  const proposedEffectiveDate = text(formData, "proposedEffectiveDate");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size === 0 || file.size > 5_000_000) {
    return fail("Choose a valid .xlsx workbook smaller than 5 MB.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedEffectiveDate)) return fail("Choose a proposed effective date.");

  let sourceRows: unknown[][];
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    sourceRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: null, raw: true }) as unknown[][];
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
  const profilesResult = await supabase.from("staff_profiles").select("id,full_name");
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

  const batchResult = await supabase.from("payroll_import_batches").insert({
    source_filename: file.name,
    proposed_effective_date: proposedEffectiveDate,
    created_by: account.id,
  }).select("id").single();
  if (batchResult.error) return fail("The private payroll review batch could not be created.");

  const reviewRows = candidates.map((candidate) => {
    const matches = profilesByName.get(normaliseName(candidate.sourceName)) ?? [];
    const suggested = matches.length === 1 ? matches[0] : null;
    return {
      batch_id: batchResult.data.id,
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
      created_by: account.id,
      updated_by: account.id,
    };
  });
  const rowsResult = await supabase.from("payroll_import_review_rows").insert(reviewRows);
  if (rowsResult.error) {
    await supabase.from("payroll_import_batches").delete().eq("id", batchResult.data.id);
    return fail("The workbook rows could not be saved for private review.");
  }
  revalidatePath("/payroll/review");
  return ok(`Private review batch created with ${reviewRows.length} row(s). No pay arrangements were imported.`);
}

export async function savePayrollReviewRowAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const account = await requireAccount(["manager"]);
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
    updated_by: account.id,
  }).eq("id", rowId).eq("batch_id", batchId);
  if (error) return fail("This review row could not be saved. Ready or imported batches are locked.");
  revalidatePath("/payroll/review");
  return ok("Review row saved. No pay arrangement was imported.");
}

export async function updatePayrollBatchDateConfirmationAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  await requireAccount(["manager"]);
  const batchId = text(formData, "batchId");
  const date = text(formData, "proposedEffectiveDate");
  if (!batchId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Choose a valid proposed date.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("payroll_import_batches").update({
    proposed_effective_date: date,
    global_effective_date_confirmed: formData.get("globalEffectiveDateConfirmed") === "on",
  }).eq("id", batchId).eq("status", "draft");
  if (error) return fail("The batch date confirmation could not be saved.");
  revalidatePath("/payroll/review");
  return ok("Batch date settings saved.");
}

export async function markPayrollBatchReadyAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const account = await requireAccount(["manager"]);
  const batchId = text(formData, "batchId");
  const review = await loadPayrollReview(batchId);
  if (!review.batch || !review.validation?.summary.readyForImport) return fail("Resolve every warning before marking this batch ready.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("payroll_import_batches").update({
    status: "ready",
    approved_by: account.id,
    approved_at: new Date().toISOString(),
  }).eq("id", batchId).eq("status", "draft");
  if (error) return fail("The review batch could not be marked ready.");
  revalidatePath("/payroll/review");
  return ok("Review approved and locked. A separate final confirmation is still required to import arrangements.");
}

export async function importPayrollBatchAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  await requireAccount(["manager"]);
  const batchId = text(formData, "batchId");
  if (text(formData, "confirmation") !== "IMPORT") return fail("Type IMPORT to confirm the production write.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("apply_payroll_import_batch", { target_batch_id: batchId });
  if (error) return fail("The import was blocked. Check readiness and existing arrangement overlaps.");
  revalidatePath("/payroll/review");
  revalidatePath("/payroll/arrangements");
  revalidatePath("/payroll");
  return ok(`${Number(data)} approved pay arrangement(s) imported.`);
}
