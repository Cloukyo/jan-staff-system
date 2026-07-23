import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createPayrollPreparationWorkbook } from "@/lib/exports/payroll-excel";
import { validatePayrollReview, type PayrollImportBatch, type PayrollImportReviewRow } from "@/lib/payroll/review";
import type { PayrollExportDetail, PayrollPreparationRow } from "@/lib/payroll/types";

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
  const detail: PayrollExportDetail = {
    dates: ["2026-07-01", "2026-07-02", "2026-07-03"],
    plannedRows: [{
      staffId: "staff",
      fullName: "Staff Member",
      employmentRole: "Practitioner",
      plannedMinutesByDate: {
        "2026-07-01": 450,
        "2026-07-02": 480,
        "2026-07-03": 0,
      },
    }],
    dailyRows: [{
      staffId: "staff",
      fullName: "Staff Member",
      employmentRole: "Practitioner",
      date: "2026-07-01",
      plannedStart: "08:00",
      plannedEnd: "16:30",
      plannedBreakMinutes: 30,
      plannedMinutes: 480,
      originalClockIns: ["2026-07-01T08:00:00+01:00"],
      originalClockOuts: ["2026-07-01T16:00:00+01:00"],
      managerClockIns: ["2026-07-01T08:15:00+01:00"],
      managerClockOuts: ["2026-07-01T16:00:00+01:00"],
      rawWorkedMinutes: 480,
      workedMinutes: 465,
      reviewStatus: "corrected",
      reviewReason: "Manager corrected arrival",
      warnings: ["Manager correction"],
    }, {
      staffId: "staff",
      fullName: "Staff Member",
      employmentRole: "Practitioner",
      date: "2026-07-02",
      plannedStart: "08:00",
      plannedEnd: "17:00",
      plannedBreakMinutes: 60,
      plannedMinutes: 480,
      originalClockIns: [],
      originalClockOuts: [],
      managerClockIns: [],
      managerClockOuts: [],
      rawWorkedMinutes: 0,
      workedMinutes: 0,
      reviewStatus: "not_reviewed",
      reviewReason: null,
      warnings: [],
    }],
  };

  it("creates a valid workbook with preparation and warning data", async () => {
    const buffer = await createPayrollPreparationWorkbook([preparation], "2026-06-01", "2026-06-30");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const preparationSheet = workbook.getWorksheet("Payroll Preparation");
    expect(preparationSheet?.rowCount).toBe(2);
    expect(preparationSheet?.getCell("N2").value).toBeNull();
    expect(workbook.getWorksheet("Read Me")).toBeTruthy();
  });

  it("labels incomplete attendance as unreviewed and includes readiness counts", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-06-01",
      "2026-06-30",
      { unresolved: 12, pendingRequests: 2 },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    const readMe = workbook.getWorksheet("Read Me");
    const values = readMe?.getColumn(1).values.map(String).join(" ") ?? "";
    expect(values).toContain("UNREVIEWED PAYROLL PREPARATION");
    expect(values).toContain("12 worked day(s) are not reviewed");
    expect(values).toContain("2 staff correction request(s) remain open");
    expect(values).toContain("Check and correct these hours manually");
  });

  it("keeps the normal label when attendance is fully reviewed", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-06-01",
      "2026-06-30",
      { unresolved: 0, pendingRequests: 0 },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.getWorksheet("Read Me")?.getCell("A1").value).toBe(
      "Jan Pre-School payroll preparation",
    );
  });

  it("adds a planned rota matrix with every selected date and formula totals", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-07-01",
      "2026-07-03",
      { unresolved: 0, pendingRequests: 0 },
      detail,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Payroll Preparation",
      "Planned Rota",
      "Daily Clocking",
      "Read Me",
    ]);
    const planned = workbook.getWorksheet("Planned Rota")!;
    expect(planned.getCell("A1").value).toContain("future scheduled shifts");
    expect(planned.getCell("C2").value).toBe("Wed 01/07");
    expect(planned.getCell("D2").value).toBe("Thu 02/07");
    expect(planned.getCell("E2").value).toBe("Fri 03/07");
    expect(planned.getCell("C3").value).toBe(7.5);
    expect(planned.getCell("D3").value).toBe(8);
    expect(planned.getCell("F3").formula).toBe("SUM(C3:E3)");
    expect(planned.getCell("C3").numFmt).toBe("0.00");
    expect(planned.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 2 });
  });

  it("adds daily clocking rows with original and manager events in separate columns", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-07-01",
      "2026-07-03",
      { unresolved: 1, pendingRequests: 0 },
      detail,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    const daily = workbook.getWorksheet("Daily Clocking")!;
    expect(daily.getCell("C2").value).toBeInstanceOf(Date);
    expect((daily.getCell("C2").value as Date).toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(daily.getCell("C2").numFmt).toBe("dd/mm/yyyy");
    expect(daily.getCell("H2").value).toBe("08:00");
    expect(daily.getCell("I2").value).toBe("16:00");
    expect(daily.getCell("J2").value).toBe("08:15");
    expect(daily.getCell("K2").value).toBe("16:00");
    expect(daily.getCell("L2").value).toBe(8);
    expect(daily.getCell("M2").value).toBe(7.75);
    expect(daily.getCell("N2").value).toBe("corrected");
    expect(daily.getCell("O2").value).toBe("Manager corrected arrival");
    expect(daily.getCell("C3").value).toBeInstanceOf(Date);
    expect(daily.getCell("H3").value).toBeNull();
    expect(daily.getCell("M3").value).toBe(0);
  });
});
