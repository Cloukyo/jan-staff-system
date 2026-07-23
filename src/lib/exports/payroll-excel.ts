import ExcelJS from "exceljs";
import { format, parseISO } from "date-fns";
import { formatTimeUk } from "@/lib/dates/format";
import type { PayrollExportDetail, PayrollPreparationRow } from "@/lib/payroll/types";

const decimalHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export type PayrollWorkbookReviewState = {
  unresolved: number;
  pendingRequests: number;
};

export async function createPayrollPreparationWorkbook(
  rows: PayrollPreparationRow[],
  periodStart: string,
  periodEnd: string,
  reviewState: PayrollWorkbookReviewState = { unresolved: 0, pendingRequests: 0 },
  detail: PayrollExportDetail = { dates: [], plannedRows: [], dailyRows: [] },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jan Pre-School Staff System";
  workbook.created = new Date();
  const isUnreviewed = reviewState.unresolved > 0 || reviewState.pendingRequests > 0;
  const workbookLabel = isUnreviewed
    ? "UNREVIEWED PAYROLL PREPARATION"
    : "Jan Pre-School payroll preparation";
  workbook.subject = workbookLabel;
  const sheet = workbook.addWorksheet("Payroll Preparation", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Staff name", key: "staff", width: 30 },
    { header: "Role", key: "role", width: 24 },
    { header: "Period start", key: "start", width: 14 },
    { header: "Period end", key: "end", width: 14 },
    { header: "Pay type", key: "payType", width: 13 },
    { header: "Hours basis", key: "hoursBasis", width: 20 },
    { header: "Contracted weekly hours", key: "contracted", width: 24 },
    { header: "Raw worked hours", key: "raw", width: 18 },
    { header: "Reviewed worked hours", key: "reviewed", width: 22 },
    { header: "Ordinary hours", key: "ordinary", width: 16 },
    { header: "Overtime hours", key: "overtime", width: 16 },
    { header: "Hourly rate", key: "hourlyRate", width: 15 },
    { header: "Estimated gross", key: "estimatedGross", width: 17 },
    { header: "Salary period basis", key: "salaryBasis", width: 19 },
    { header: "Attendance review", key: "reviewStatus", width: 20 },
    { header: "Adjustment notes", key: "adjustments", width: 38 },
    { header: "Warnings", key: "warnings", width: 42 },
  ];
  for (const row of rows) {
    sheet.addRow({
      staff: row.fullName,
      role: row.employmentRole,
      start: periodStart,
      end: periodEnd,
      payType: row.payType ?? "",
      hoursBasis: row.hoursBasis?.replaceAll("_", " ") ?? "",
      contracted: row.contractedWeeklyHours ?? "",
      raw: decimalHours(row.recordedMinutes),
      reviewed: decimalHours(row.adjustedMinutes),
      ordinary: decimalHours(row.ordinaryMinutes),
      overtime: decimalHours(row.overtimeMinutes),
      hourlyRate: row.hourlyRate ?? "",
      estimatedGross: row.estimatedGross ?? "",
      salaryBasis: row.salaryBasis ?? "",
      reviewStatus: row.reviewStatus.replaceAll("_", " "),
      adjustments: row.adjustmentNotes.join("; "),
      warnings: row.warnings.join("; "),
    });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B21B6" } };
  sheet.autoFilter = { from: "A1", to: "Q1" };
  for (const key of ["L", "M", "N"]) sheet.getColumn(key).numFmt = '£#,##0.00';
  for (const key of ["G", "H", "I", "J", "K"]) sheet.getColumn(key).numFmt = "0.00";
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: rowNumber > 1 };
  });

  const planned = workbook.addWorksheet("Planned Rota", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });
  const totalColumnNumber = detail.dates.length + 3;
  planned.mergeCells(1, 1, 1, totalColumnNumber);
  planned.getCell(1, 1).value =
    "Planned rota hours include future scheduled shifts. Planned breaks are deducted. These hours may differ from clocked attendance.";
  planned.getCell(1, 1).font = { bold: true, color: { argb: "FF4C1D95" } };
  planned.getCell(1, 1).alignment = { wrapText: true, vertical: "middle" };
  planned.getRow(1).height = 32;
  planned.addRow([
    "Staff name",
    "Role",
    ...detail.dates.map((date) => format(parseISO(date), "EEE dd/MM")),
    "Total planned hours",
  ]);
  for (const row of detail.plannedRows) {
    const worksheetRow = planned.addRow([
      row.fullName,
      row.employmentRole,
      ...detail.dates.map((date) => decimalHours(row.plannedMinutesByDate[date] ?? 0)),
      "",
    ]);
    const totalCell = worksheetRow.getCell(totalColumnNumber);
    if (detail.dates.length > 0) {
      const firstDateColumn = planned.getColumn(3).letter;
      const lastDateColumn = planned.getColumn(detail.dates.length + 2).letter;
      totalCell.value = {
        formula: `SUM(${firstDateColumn}${worksheetRow.number}:${lastDateColumn}${worksheetRow.number})`,
      };
    } else {
      totalCell.value = 0;
    }
  }
  planned.getColumn(1).width = 30;
  planned.getColumn(2).width = 24;
  for (let column = 3; column < totalColumnNumber; column += 1) {
    planned.getColumn(column).width = 12;
    planned.getColumn(column).numFmt = "0.00";
  }
  planned.getColumn(totalColumnNumber).width = 20;
  planned.getColumn(totalColumnNumber).numFmt = "0.00";
  planned.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
  planned.getRow(2).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B21B6" },
  };
  planned.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: totalColumnNumber },
  };
  planned.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });

  const daily = workbook.addWorksheet("Daily Clocking", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });
  daily.columns = [
    { header: "Staff name", key: "staff", width: 30 },
    { header: "Role", key: "role", width: 24 },
    { header: "Date", key: "date", width: 13 },
    { header: "Planned start", key: "plannedStart", width: 16 },
    { header: "Planned finish", key: "plannedEnd", width: 16 },
    { header: "Planned break minutes", key: "plannedBreak", width: 22 },
    { header: "Planned net hours", key: "plannedHours", width: 19 },
    { header: "Original clock-ins", key: "originalIns", width: 22 },
    { header: "Original clock-outs", key: "originalOuts", width: 22 },
    { header: "Manager correction clock-ins", key: "managerIns", width: 29 },
    { header: "Manager correction clock-outs", key: "managerOuts", width: 30 },
    { header: "Raw worked hours", key: "rawHours", width: 18 },
    { header: "Worked hours including corrections", key: "workedHours", width: 32 },
    { header: "Attendance review status", key: "reviewStatus", width: 25 },
    { header: "Review or correction reason", key: "reviewReason", width: 36 },
    { header: "Warnings", key: "warnings", width: 42 },
  ];
  for (const row of detail.dailyRows) {
    daily.addRow({
      staff: row.fullName,
      role: row.employmentRole,
      date: parseISO(row.date),
      plannedStart: row.plannedStart ?? "",
      plannedEnd: row.plannedEnd ?? "",
      plannedBreak: row.plannedBreakMinutes,
      plannedHours: decimalHours(row.plannedMinutes),
      originalIns: row.originalClockIns.map(formatTimeUk).join(", "),
      originalOuts: row.originalClockOuts.map(formatTimeUk).join(", "),
      managerIns: row.managerClockIns.map(formatTimeUk).join(", "),
      managerOuts: row.managerClockOuts.map(formatTimeUk).join(", "),
      rawHours: decimalHours(row.rawWorkedMinutes),
      workedHours: decimalHours(row.workedMinutes),
      reviewStatus: row.reviewStatus.replaceAll("_", " "),
      reviewReason: row.reviewReason ?? "",
      warnings: row.warnings.join("; "),
    });
  }
  daily.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  daily.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B21B6" },
  };
  daily.autoFilter = { from: "A1", to: "P1" };
  daily.getColumn("C").numFmt = "dd/mm/yyyy";
  for (const column of ["G", "L", "M"]) daily.getColumn(column).numFmt = "0.00";
  daily.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: rowNumber > 1 };
  });

  const notes = workbook.addWorksheet("Read Me");
  notes.addRows([
    [workbookLabel],
    [`Period: ${periodStart} to ${periodEnd}`],
    ...(isUnreviewed
      ? [
          [`${reviewState.unresolved} worked day(s) are not reviewed.`],
          [`${reviewState.pendingRequests} staff correction request(s) remain open.`],
          ["Check and correct these hours manually before using them for payroll."],
        ]
      : [["This workbook contains manager-reviewed preparation figures only."]]),
    ["It does not calculate PAYE, National Insurance, pensions, student loans or payslips."],
    ["Original clock events remain unchanged. Manager correction events and review notes are shown separately."],
  ]);
  notes.getColumn(1).width = 100;
  notes.getRow(1).font = { bold: true, size: 14 };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
