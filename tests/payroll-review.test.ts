import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createPayrollPreparationWorkbook } from "@/lib/exports/payroll-excel";
import { validatePayrollReview, type PayrollImportBatch, type PayrollImportReviewRow } from "@/lib/payroll/review";
import type { PayrollPreparationRow } from "@/lib/payroll/types";

const batch: PayrollImportBatch = {
  id: "batch",
  sourceFilename: "private.xlsx",
  status: "draft",
  proposedEffectiveDate: "2026-05-01",
  globalEffectiveDateConfirmed: false,
  createdAt: "2026-06-13T12:00:00Z",
  approvedAt: null,
  importedAt: null,
};

const row: PayrollImportReviewRow = {
  id: "row",
  sourceRowIndex: 1,
  sourceName: "Workbook Name",
  suggestedStaffId: "staff",
  selectedStaffId: "staff",
  matchConfidence: "high",
  resolution: "current_staff",
  payType: "hourly",
  hourlyRate: 12,
  annualSalary: null,
  monthlySalary: null,
  contractedWeeklyHours: 35,
  hoursBasis: "contracted",
  effectiveFrom: "2026-05-01",
  managerNotes: null,
  sourceWarnings: [],
  duplicateMappingConfirmed: false,
};

describe("payroll import review", () => {
  it("blocks import until the shared effective date is confirmed", () => {
    const blocked = validatePayrollReview(batch, [row], []);
    expect(blocked.summary.readyForImport).toBe(false);
    expect(blocked.warningsByRow.row).toContain("Confirm applying the proposed date to every importable row.");
    const ready = validatePayrollReview({ ...batch, globalEffectiveDateConfirmed: true }, [row], []);
    expect(ready.summary.readyForImport).toBe(true);
  });

  it("requires explicit confirmation for duplicate staff mappings", () => {
    const duplicate = { ...row, id: "row-2", sourceRowIndex: 2 };
    const result = validatePayrollReview({ ...batch, globalEffectiveDateConfirmed: true }, [row, duplicate], []);
    expect(result.summary.duplicateMappings).toBe(2);
    expect(result.summary.readyForImport).toBe(false);
  });

  it("accepts variable-hours arrangements without inserting zero contracted hours", () => {
    const variable = { ...row, contractedWeeklyHours: null, hoursBasis: "variable_hours" as const };
    const result = validatePayrollReview({ ...batch, globalEffectiveDateConfirmed: true }, [variable], []);
    expect(result.summary.missingHours).toBe(0);
    expect(result.summary.readyForImport).toBe(true);
  });

  it("keeps review and import tables manager-only with an explicit transactional import", () => {
    const migration = readFileSync(resolve("supabase/migrations/202606130008_payroll_review_and_preparation.sql"), "utf8");
    expect(migration).toContain("alter table public.payroll_import_review_rows enable row level security");
    expect(migration).toContain("current_staff_role() = 'manager'");
    expect(migration).toContain("apply_payroll_import_batch");
    expect(migration).toContain("for update");
    expect(migration).toContain("revoke all on public.payroll_import_batches");
    expect(migration).not.toMatch(/disable row level security/i);
  });
});

describe("payroll Excel export", () => {
  it("creates a valid workbook with preparation and warning data", async () => {
    const preparation: PayrollPreparationRow = {
      staffId: "staff",
      fullName: "Staff Member",
      employmentRole: "Practitioner",
      payType: "hourly",
      contractedWeeklyHours: 35,
      hoursBasis: "contracted",
      recordedMinutes: 450,
      adjustedMinutes: 480,
      ordinaryMinutes: 480,
      overtimeMinutes: 0,
      hourlyRate: 12,
      estimatedGross: 96,
      salaryBasis: null,
      workedDays: 1,
      reviewedDays: 1,
      unresolvedDays: 0,
      reviewStatus: "ready",
      adjustmentNotes: ["Manager correction events included"],
      warnings: ["Manager correction"],
    };
    const buffer = await createPayrollPreparationWorkbook([preparation], "2026-06-01", "2026-06-30");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    expect(workbook.getWorksheet("Payroll Preparation")?.rowCount).toBe(2);
    expect(workbook.getWorksheet("Read Me")).toBeTruthy();
  });
});
