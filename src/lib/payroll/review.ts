import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { PayrollHoursBasis, ProductionPayType } from "@/lib/payroll/types";

export type PayrollImportResolution = "unresolved" | "current_staff" | "former_staff" | "external" | "excluded";

export type PayrollImportBatch = {
  id: string;
  sourceFilename: string;
  status: "draft" | "ready" | "imported" | "cancelled";
  proposedEffectiveDate: string | null;
  globalEffectiveDateConfirmed: boolean;
  createdAt: string;
  approvedAt: string | null;
  importedAt: string | null;
};

export type PayrollImportReviewRow = {
  id: string;
  sourceRowIndex: number;
  sourceName: string;
  suggestedStaffId: string | null;
  selectedStaffId: string | null;
  matchConfidence: "none" | "low" | "medium" | "high";
  resolution: PayrollImportResolution;
  payType: ProductionPayType | null;
  hourlyRate: number | null;
  annualSalary: number | null;
  monthlySalary: number | null;
  contractedWeeklyHours: number | null;
  hoursBasis: PayrollHoursBasis;
  effectiveFrom: string | null;
  managerNotes: string | null;
  sourceWarnings: string[];
  duplicateMappingConfirmed: boolean;
};

export type PayrollReviewSummary = {
  totalRows: number;
  resolvedRows: number;
  unresolvedRows: number;
  excludedRows: number;
  formerRows: number;
  externalRows: number;
  missingRates: number;
  missingHours: number;
  duplicateMappings: number;
  effectiveDateConflicts: number;
  rowsWithWarnings: number;
  readyForImport: boolean;
};

type ExistingArrangement = {
  staffId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
};

export function validatePayrollReview(
  batch: PayrollImportBatch,
  rows: PayrollImportReviewRow[],
  arrangements: ExistingArrangement[],
): { summary: PayrollReviewSummary; warningsByRow: Record<string, string[]> } {
  const warningsByRow: Record<string, string[]> = {};
  const mappings = new Map<string, PayrollImportReviewRow[]>();
  const importable = rows.filter((row) => row.resolution === "current_staff" || row.resolution === "former_staff");

  for (const row of rows) {
    const warnings: string[] = [];
    if (row.resolution === "unresolved") warnings.push("Choose how this source row should be handled.");
    if ((row.resolution === "current_staff" || row.resolution === "former_staff") && !row.selectedStaffId) {
      warnings.push("Select a canonical staff profile.");
    }
    if (row.resolution === "current_staff" || row.resolution === "former_staff") {
      if (!row.payType) warnings.push("Choose hourly or salaried pay.");
      if (row.payType === "hourly" && (!row.hourlyRate || row.hourlyRate <= 0)) warnings.push("Hourly rate is required.");
      if (row.payType === "salaried" && !((row.annualSalary ?? 0) > 0 || (row.monthlySalary ?? 0) > 0)) {
        warnings.push("Annual or monthly salary basis is required.");
      }
      if (row.hoursBasis === "contracted" && (!row.contractedWeeklyHours || row.contractedWeeklyHours <= 0)) {
        warnings.push("Contracted weekly hours or an allowed hours exception is required.");
      }
      if (!row.effectiveFrom) warnings.push("An effective date is required.");
    }
    if (row.selectedStaffId && (row.resolution === "current_staff" || row.resolution === "former_staff")) {
      const mapped = mappings.get(row.selectedStaffId) ?? [];
      mapped.push(row);
      mappings.set(row.selectedStaffId, mapped);
      if (row.effectiveFrom && arrangements.some((item) =>
        item.staffId === row.selectedStaffId &&
        item.active &&
        item.effectiveFrom <= row.effectiveFrom! &&
        (!item.effectiveTo || item.effectiveTo >= row.effectiveFrom!)
      )) {
        warnings.push("An existing active pay arrangement covers this effective date.");
      }
    }
    warningsByRow[row.id] = warnings;
  }

  let duplicateMappings = 0;
  for (const duplicates of mappings.values()) {
    if (duplicates.length < 2) continue;
    duplicateMappings += duplicates.length;
    for (const row of duplicates) {
      if (!row.duplicateMappingConfirmed) warningsByRow[row.id].push("Confirm that this is a separate pay arrangement.");
    }
  }

  const allUseProposedDate = importable.length > 0
    && Boolean(batch.proposedEffectiveDate)
    && importable.every((row) => row.effectiveFrom === batch.proposedEffectiveDate);
  if (allUseProposedDate && !batch.globalEffectiveDateConfirmed) {
    for (const row of importable) warningsByRow[row.id].push("Confirm applying the proposed date to every importable row.");
  }

  const warningRows = Object.values(warningsByRow);
  return {
    summary: {
      totalRows: rows.length,
      resolvedRows: rows.filter((row) => row.resolution !== "unresolved").length,
      unresolvedRows: rows.filter((row) => row.resolution === "unresolved").length,
      excludedRows: rows.filter((row) => row.resolution === "excluded").length,
      formerRows: rows.filter((row) => row.resolution === "former_staff").length,
      externalRows: rows.filter((row) => row.resolution === "external").length,
      missingRates: importable.filter((row) =>
        (row.payType === "hourly" && (!row.hourlyRate || row.hourlyRate <= 0))
        || (row.payType === "salaried" && !((row.annualSalary ?? 0) > 0 || (row.monthlySalary ?? 0) > 0))
        || !row.payType
      ).length,
      missingHours: importable.filter((row) =>
        row.hoursBasis === "contracted" && (!row.contractedWeeklyHours || row.contractedWeeklyHours <= 0)
      ).length,
      duplicateMappings,
      effectiveDateConflicts: warningRows.filter((warnings) =>
        warnings.some((warning) => warning.includes("effective date") || warning.includes("proposed date"))
      ).length,
      rowsWithWarnings: warningRows.filter((warnings) => warnings.length > 0).length,
      readyForImport: rows.length > 0 && warningRows.every((warnings) => warnings.length === 0),
    },
    warningsByRow,
  };
}

function mapBatch(row: Record<string, unknown>): PayrollImportBatch {
  return {
    id: String(row.id),
    sourceFilename: String(row.source_filename),
    status: String(row.status) as PayrollImportBatch["status"],
    proposedEffectiveDate: row.proposed_effective_date ? String(row.proposed_effective_date) : null,
    globalEffectiveDateConfirmed: Boolean(row.global_effective_date_confirmed),
    createdAt: String(row.created_at),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    importedAt: row.imported_at ? String(row.imported_at) : null,
  };
}

function mapRow(row: Record<string, unknown>): PayrollImportReviewRow {
  return {
    id: String(row.id),
    sourceRowIndex: Number(row.source_row_index),
    sourceName: String(row.source_name),
    suggestedStaffId: row.suggested_staff_id ? String(row.suggested_staff_id) : null,
    selectedStaffId: row.selected_staff_id ? String(row.selected_staff_id) : null,
    matchConfidence: String(row.match_confidence) as PayrollImportReviewRow["matchConfidence"],
    resolution: String(row.resolution) as PayrollImportResolution,
    payType: row.pay_type ? String(row.pay_type) as ProductionPayType : null,
    hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate),
    annualSalary: row.annual_salary === null ? null : Number(row.annual_salary),
    monthlySalary: row.monthly_salary === null ? null : Number(row.monthly_salary),
    contractedWeeklyHours: row.contracted_weekly_hours === null ? null : Number(row.contracted_weekly_hours),
    hoursBasis: String(row.hours_basis) as PayrollHoursBasis,
    effectiveFrom: row.effective_from ? String(row.effective_from) : null,
    managerNotes: row.manager_notes ? String(row.manager_notes) : null,
    sourceWarnings: Array.isArray(row.source_warnings) ? row.source_warnings.map(String) : [],
    duplicateMappingConfirmed: Boolean(row.duplicate_mapping_confirmed),
  };
}

export async function loadPayrollReview(selectedBatchId?: string) {
  await requireAccount(["manager"]);
  const supabase = await createSupabaseServerClient();
  const [batchesResult, profilesResult, arrangementsResult] = await Promise.all([
    supabase.from("payroll_import_batches").select("*").order("created_at", { ascending: false }),
    supabase.from("staff_profiles").select("id,full_name,active").order("full_name"),
    supabase.from("staff_pay_arrangements").select("staff_id,effective_from,effective_to,is_active"),
  ]);
  if (batchesResult.error || profilesResult.error || arrangementsResult.error) {
    throw new Error("Payroll review data could not be loaded.");
  }
  const batches = ((batchesResult.data ?? []) as Record<string, unknown>[]).map(mapBatch);
  const batch = batches.find((item) => item.id === selectedBatchId) ?? batches[0] ?? null;
  let rows: PayrollImportReviewRow[] = [];
  if (batch) {
    const result = await supabase.from("payroll_import_review_rows").select("*").eq("batch_id", batch.id).order("source_row_index");
    if (result.error) throw new Error("Payroll review rows could not be loaded.");
    rows = ((result.data ?? []) as Record<string, unknown>[]).map(mapRow);
  }
  const arrangements: ExistingArrangement[] = (arrangementsResult.data ?? []).map((row) => ({
    staffId: row.staff_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    active: row.is_active,
  }));
  return {
    batches,
    batch,
    rows,
    profiles: (profilesResult.data ?? []).map((row) => ({ id: row.id, fullName: row.full_name, active: row.active })),
    validation: batch ? validatePayrollReview(batch, rows, arrangements) : null,
  };
}
