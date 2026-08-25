import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createPayrollPreparationWorkbook } from "@/lib/exports/payroll-excel";
import { calculateClockTotals, createPayrollPreparationRow } from "@/lib/payroll/calculations";
import { validatePayrollReview, type PayrollImportBatch, type PayrollImportReviewRow } from "@/lib/payroll/review";
import { buildProductionAttendanceData } from "@/lib/payroll/server";
import type { PayrollExportDetail, PayrollPreparationRow, ProductionStaffRow } from "@/lib/payroll/types";

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
  it("calculates raw and reviewed pay-preparation time from separate audit representations", () => {
    const attendance = buildProductionAttendanceData(
      [{
        id: "raw-in",
        staff_id: "staff",
        event_type: "clock_in",
        event_timestamp: "2026-07-28T08:00:00+01:00",
        recorded_date: "2026-07-28",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }, {
        id: "raw-out",
        staff_id: "staff",
        event_type: "clock_out",
        event_timestamp: "2026-07-28T16:00:00+01:00",
        recorded_date: "2026-07-28",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }],
      [{
        id: "fixed-in",
        batch_id: "batch",
        correction_role: "primary",
        staff_id: "staff",
        correction_kind: "replace",
        original_event_id: "raw-in",
        supersedes_correction_id: null,
        event_type: "clock_in",
        event_timestamp: "2026-07-28T09:00:00+01:00",
        recorded_date: "2026-07-28",
        reason: "Manager confirmed arrival",
        created_by: "manager",
        created_at: "2026-07-29T09:00:00Z",
      }],
    );

    expect(calculateClockTotals(attendance.effectiveEvents).recordedMinutes).toBe(420);
    expect(attendance.audit.originalEvents.map((event) => event.eventTimestamp)).toEqual([
      "2026-07-28T08:00:00+01:00",
      "2026-07-28T16:00:00+01:00",
    ]);
    expect(attendance.audit.correctionRecords).toEqual([
      expect.objectContaining({
        id: "fixed-in",
        sourceLabel: "Manager correction",
        reason: "Manager confirmed arrival",
      }),
    ]);

    const staff: ProductionStaffRow = {
      id: "staff",
      fullName: "Staff Member",
      displayName: "Staff",
      employmentRole: "Practitioner",
      mainQualificationLevel: null,
      active: true,
      loginStatus: "Active login",
      kioskStatus: "Enabled",
      isManager: false,
      payArrangements: [{
        id: "arrangement",
        staffId: "staff",
        payType: "hourly",
        hourlyRate: 12,
        annualSalary: null,
        monthlySalary: null,
        contractedWeeklyHours: 35,
        hoursBasis: "contracted",
        standardDailyHours: null,
        overtimeMultiplier: 1,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        isActive: true,
        managerNotes: null,
        createdByName: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      }],
    };
    const preparation = createPayrollPreparationRow(
      staff,
      attendance.audit.originalEvents,
      attendance.effectiveEvents,
      "2026-07-28",
      "2026-07-28",
    );
    expect(preparation.recordedMinutes).toBe(480);
    expect(preparation.adjustedMinutes).toBe(420);
  });

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
      correctionRecords: [{
        id: "arrival-fix",
        batchId: "batch-1",
        correctionRole: "primary",
        staffId: "staff-1",
        kind: "replace",
        originalEventId: "original-in",
        supersedesCorrectionId: null,
        eventType: "clock_in",
        eventTimestamp: "2026-07-01T08:15:00+01:00",
        recordedDate: "2026-07-01",
        reason: "Manager corrected arrival",
        createdBy: "manager",
        createdAt: "2026-07-02T09:00:00Z",
        sourceLabel: "Manager correction",
        status: "active",
      }],
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
      correctionRecords: [],
      rawWorkedMinutes: 0,
      workedMinutes: 0,
      reviewStatus: "not_reviewed",
      reviewReason: null,
      warnings: [],
    }],
  };
  const weeklyDetail: PayrollExportDetail = {
    ...detail,
    dates: [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ],
    plannedRows: [{
      ...detail.plannedRows[0],
      plannedMinutesByDate: {
        ...detail.plannedRows[0].plannedMinutesByDate,
        "2026-07-04": 0,
        "2026-07-05": 0,
        "2026-07-06": 420,
        "2026-07-07": 0,
        "2026-07-08": 0,
        "2026-07-09": 0,
        "2026-07-10": 0,
      },
    }],
    dailyRows: [
      ...detail.dailyRows,
      {
        ...detail.dailyRows[0],
        date: "2026-07-06",
        plannedStart: "09:00",
        plannedEnd: "16:30",
        plannedBreakMinutes: 30,
        plannedMinutes: 420,
        originalClockIns: ["2026-07-06T09:00:00+01:00"],
        originalClockOuts: ["2026-07-06T16:00:00+01:00"],
        managerClockIns: [],
        managerClockOuts: [],
        correctionRecords: [],
        rawWorkedMinutes: 420,
        workedMinutes: 420,
        reviewStatus: "approved",
        reviewReason: null,
        warnings: [],
      },
    ],
  };

  it("creates a valid workbook with preparation and warning data", async () => {
    const buffer = await createPayrollPreparationWorkbook([preparation], "2026-06-01", "2026-06-30");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const preparationSheet = workbook.getWorksheet("Pay Summary");
    expect(preparationSheet?.rowCount).toBe(2);
    expect(preparationSheet?.getCell("O2").value).toBeNull();
    expect(workbook.getWorksheet("Read Me")).toBeTruthy();
  });

  it("shows each staff member's total planned net hours in Pay Summary", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-07-01",
      "2026-07-03",
      { unresolved: 0, pendingRequests: 0 },
      detail,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    const preparationSheet = workbook.getWorksheet("Pay Summary");
    expect(preparationSheet?.getCell("H1").value).toBe("Total planned hours");
    expect(preparationSheet?.getCell("H2").value).toBe(15.5);
    expect(preparationSheet?.getCell("H2").numFmt).toBe("0.00");
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
    expect(values).toContain("Each numbered worksheet covers one Monday-to-Sunday week");
    expect(values).toContain("Planned hours deduct planned rota breaks");
    expect(values).toContain("Clocked-out breaks are unpaid");
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

  it("creates numbered weekly sheets with planned and clocked sub-rows and visible totals", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-07-01",
      "2026-07-10",
      { unresolved: 0, pendingRequests: 0 },
      weeklyDetail,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Pay Summary",
      "Week 1",
      "Week 2",
      "Daily Clocking",
      "Read Me",
    ]);
    const week1 = workbook.getWorksheet("Week 1")!;
    expect(week1.getCell("D2").value).toBe("Wed 01/07");
    expect(week1.getCell("H2").value).toBe("Sun 05/07");
    expect(week1.getCell("C3").value).toBe("Planned hours");
    expect(week1.getCell("C4").value).toBe("Clocked hours");
    expect(week1.getCell("I3").value).toEqual({ formula: "SUM(D3:H3)", result: 15.5 });
    expect(week1.getCell("I4").value).toEqual({ formula: "SUM(D4:H4)", result: 7.75 });
    expect(week1.getCell("I3").numFmt).toBe("0.00");
    expect(week1.getCell("J2").value).toBe("Hourly pay");
    expect(week1.getCell("K2").value).toBe("Estimated pay");
    expect(week1.getCell("J3").value).toBe(12);
    expect(week1.getCell("J3").isMerged).toBe(true);
    expect(week1.getCell("K3").value).toEqual({
      formula: 'IF(J3="","",I3*J3)',
      result: 186,
    });
    expect(week1.getCell("K4").value).toEqual({
      formula: 'IF(J3="","",I4*J3)',
      result: 93,
    });
    expect(week1.getCell("J3").numFmt).toBe('"£"#,##0.00');
    expect(week1.getCell("K3").numFmt).toBe('"£"#,##0.00');
    expect(week1.getCell("A3").isMerged).toBe(true);
    expect(week1.views[0]).toMatchObject({ state: "frozen", xSplit: 3, ySplit: 2 });

    const week2 = workbook.getWorksheet("Week 2")!;
    expect(week2.getCell("D2").value).toBe("Mon 06/07");
    expect(week2.getCell("H2").value).toBe("Fri 10/07");
    expect(week2.getCell("I3").value).toEqual({ formula: "SUM(D3:H3)", result: 7 });
    expect(week2.getCell("I4").value).toEqual({ formula: "SUM(D4:H4)", result: 7 });
    expect(workbook.getWorksheet("Planned Rota")).toBeUndefined();
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbookXml).toContain('fullCalcOnLoad="1"');
  });

  it("creates a planned-only workbook without attendance-derived sheets", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-07-01",
      "2026-07-10",
      { unresolved: 12, pendingRequests: 0 },
      weeklyDetail,
      { hours: "planned" },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Week 1",
      "Week 2",
      "Read Me",
    ]);
    expect(workbook.getWorksheet("Pay Summary")).toBeUndefined();
    expect(workbook.getWorksheet("Daily Clocking")).toBeUndefined();
    const week1 = workbook.getWorksheet("Week 1")!;
    expect(week1.getCell("C2").value).toBe("Wed 01/07");
    expect(week1.getCell("G2").value).toBe("Sun 05/07");
    expect(week1.getCell("A3").value).toBe("Staff Member");
    expect(week1.getCell("H3").value).toEqual({
      formula: "SUM(C3:G3)",
      result: 15.5,
    });
    expect(week1.getCell("I2").value).toBe("Hourly pay");
    expect(week1.getCell("J2").value).toBe("Estimated pay");
    expect(week1.getCell("I3").value).toBe(12);
    expect(week1.getCell("J3").value).toEqual({
      formula: 'IF(I3="","",H3*I3)',
      result: 186,
    });
    expect(week1.getRow(2).values).not.toContain("Hours type");
    expect(week1.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 2 });
    const readMe = workbook.getWorksheet("Read Me")!;
    expect(readMe.getColumn(1).values.map(String).join(" ")).toContain(
      "Planned hours only",
    );
  });

  it("creates a clocked-only workbook with attendance support sheets", async () => {
    const buffer = await createPayrollPreparationWorkbook(
      [preparation],
      "2026-07-01",
      "2026-07-10",
      { unresolved: 12, pendingRequests: 0 },
      weeklyDetail,
      { hours: "clocked" },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Pay Summary",
      "Week 1",
      "Week 2",
      "Daily Clocking",
      "Read Me",
    ]);
    const week1 = workbook.getWorksheet("Week 1")!;
    expect(week1.getCell("C2").value).toBe("Wed 01/07");
    expect(week1.getCell("G2").value).toBe("Sun 05/07");
    expect(week1.getCell("A3").value).toBe("Staff Member");
    expect(week1.getCell("H3").value).toEqual({
      formula: "SUM(C3:G3)",
      result: 7.75,
    });
    expect(week1.getCell("I3").value).toBe(12);
    expect(week1.getCell("J3").value).toEqual({
      formula: 'IF(I3="","",H3*I3)',
      result: 93,
    });
    expect(week1.getRow(2).values).not.toContain("Hours type");
    expect(week1.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 2 });
    const readMe = workbook.getWorksheet("Read Me")!;
    expect(readMe.getColumn(1).values.map(String).join(" ")).toContain(
      "Clocked hours only",
    );
  });

  it.each([
    { label: "missing", payrollRow: { ...preparation, hourlyRate: null } },
    {
      label: "salaried",
      payrollRow: {
        ...preparation,
        payType: "salaried" as const,
        hourlyRate: null,
      },
    },
  ])("leaves the $label hourly rate editable and blank", async ({ payrollRow }) => {
    const buffer = await createPayrollPreparationWorkbook(
      [payrollRow],
      "2026-07-01",
      "2026-07-10",
      { unresolved: 0, pendingRequests: 0 },
      weeklyDetail,
      { hours: "planned" },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const week1 = workbook.getWorksheet("Week 1")!;

    expect(week1.getCell("I3").value).toBeNull();
    expect(week1.getCell("J3").value).toMatchObject({
      formula: 'IF(I3="","",H3*I3)',
    });
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
    const weekly = workbook.getWorksheet("Week 1")!;
    expect(weekly.getCell("D4").value).toBe(7.75);
    expect(daily.getCell("C2").value).toBeInstanceOf(Date);
    expect((daily.getCell("C2").value as Date).toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(daily.getCell("C2").numFmt).toBe("dd/mm/yyyy");
    expect(daily.getCell("H2").value).toBe("08:00");
    expect(daily.getCell("I2").value).toBe("16:00");
    expect(daily.getCell("J2").value).toBe("08:15");
    expect(daily.getCell("K2").value).toBe("16:00");
    expect(daily.getCell("L2").value).toContain("arrival-fix | active | replace | clock_in | 08:15");
    expect(daily.getCell("M2").value).toBe(8);
    expect(daily.getCell("N2").value).toBe(7.75);
    expect(daily.getCell("O2").value).toBe("corrected");
    expect(daily.getCell("P2").value).toBe("Manager corrected arrival");
    expect(daily.getCell("C3").value).toBeInstanceOf(Date);
    expect(daily.getCell("H3").value).toBeNull();
    expect(daily.getCell("N3").value).toBe(0);
  });
});
