import ExcelJS from "exceljs";
import { format, parseISO } from "date-fns";
import { formatTimeUk } from "@/lib/dates/format";
import { splitPayrollDatesIntoWeeks } from "@/lib/exports/payroll-detail";
import {
  payrollModeIncludesClocked,
  payrollModeIncludesPlanned,
  type PayrollExportHoursMode,
} from "@/lib/exports/payroll-options";
import type { PayrollExportDetail, PayrollPreparationRow } from "@/lib/payroll/types";

const decimalHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export type PayrollWorkbookReviewState = {
  unresolved: number;
  pendingRequests: number;
};

export type PayrollWorkbookOptions = {
  hours: PayrollExportHoursMode;
};

export async function createPayrollPreparationWorkbook(
  rows: PayrollPreparationRow[],
  periodStart: string,
  periodEnd: string,
  reviewState: PayrollWorkbookReviewState = { unresolved: 0, pendingRequests: 0 },
  detail: PayrollExportDetail = { dates: [], plannedRows: [], dailyRows: [] },
  options: PayrollWorkbookOptions = { hours: "both" },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jan Pre-School Staff System";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const includePlanned = payrollModeIncludesPlanned(options.hours);
  const includeClocked = payrollModeIncludesClocked(options.hours);
  const isUnreviewed =
    includeClocked && (reviewState.unresolved > 0 || reviewState.pendingRequests > 0);
  const workbookLabel =
    options.hours === "planned"
      ? "Jan Pre-School planned hours export"
      : isUnreviewed
        ? "UNREVIEWED PAYROLL PREPARATION"
        : "Jan Pre-School payroll preparation";
  workbook.subject = workbookLabel;
  if (includeClocked) {
    const sheet = workbook.addWorksheet("Pay Summary", {
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
      contracted: row.contractedWeeklyHours,
      raw: decimalHours(row.recordedMinutes),
      reviewed: decimalHours(row.adjustedMinutes),
      ordinary: decimalHours(row.ordinaryMinutes),
      overtime: decimalHours(row.overtimeMinutes),
      hourlyRate: row.hourlyRate,
      estimatedGross: row.estimatedGross,
      salaryBasis: row.salaryBasis,
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
  }

  const rawMinutesByStaffDate = new Map(
    detail.dailyRows.map((row) => [`${row.staffId}:${row.date}`, row.rawWorkedMinutes]),
  );
  for (const [weekIndex, weekDates] of splitPayrollDatesIntoWeeks(detail.dates).entries()) {
    const isCombined = options.hours === "both";
    const firstDateColumnNumber = isCombined ? 4 : 3;
    const totalColumnNumber = firstDateColumnNumber + weekDates.length;
    const weekly = workbook.addWorksheet(`Week ${weekIndex + 1}`, {
      views: [{ state: "frozen", xSplit: isCombined ? 3 : 2, ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    weekly.mergeCells(1, 1, 1, totalColumnNumber);
    weekly.getCell(1, 1).value = isCombined
      ? "Planned hours deduct rota breaks. Clocked hours sum original completed clock-in/out sessions, so clocked-out breaks are unpaid."
      : includePlanned
        ? "Planned hours deduct planned rota breaks."
        : "Clocked hours sum original completed clock-in/out sessions, so clocked-out breaks are unpaid.";
    weekly.getCell(1, 1).font = { bold: true, color: { argb: "FF4C1D95" } };
    weekly.getCell(1, 1).alignment = { wrapText: true, vertical: "middle" };
    weekly.getRow(1).height = 32;
    weekly.addRow([
      "Staff name",
      "Role",
      ...(isCombined ? ["Hours type"] : []),
      ...weekDates.map((date) => format(parseISO(date), "EEE dd/MM")),
      "Weekly total",
    ]);

    for (const staffRow of detail.plannedRows) {
      const plannedMinutes = weekDates.map(
        (date) => staffRow.plannedMinutesByDate[date] ?? 0,
      );
      const clockedMinutes = weekDates.map(
        (date) => rawMinutesByStaffDate.get(`${staffRow.staffId}:${date}`) ?? 0,
      );
      const firstDateColumn = weekly.getColumn(firstDateColumnNumber).letter;
      const lastDateColumn = weekly.getColumn(totalColumnNumber - 1).letter;
      const addHoursRow = (
        label: "Planned hours" | "Clocked hours",
        minutes: number[],
        includeIdentity: boolean,
      ) => {
        const row = weekly.addRow([
          includeIdentity ? staffRow.fullName : null,
          includeIdentity ? staffRow.employmentRole : null,
          ...(isCombined ? [label] : []),
          ...minutes.map(decimalHours),
          null,
        ]);
        row.getCell(totalColumnNumber).value = {
          formula: `SUM(${firstDateColumn}${row.number}:${lastDateColumn}${row.number})`,
          result: decimalHours(minutes.reduce((sum, value) => sum + value, 0)),
        };
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: label === "Planned hours" ? "FFF5F3FF" : "FFFAFAFA" },
        };
        return row;
      };

      if (isCombined) {
        const plannedRow = addHoursRow("Planned hours", plannedMinutes, true);
        const clockedRow = addHoursRow("Clocked hours", clockedMinutes, false);
        weekly.mergeCells(plannedRow.number, 1, clockedRow.number, 1);
        weekly.mergeCells(plannedRow.number, 2, clockedRow.number, 2);
      } else if (includePlanned) {
        addHoursRow("Planned hours", plannedMinutes, true);
      } else {
        addHoursRow("Clocked hours", clockedMinutes, true);
      }
    }

    weekly.getColumn(1).width = 30;
    weekly.getColumn(2).width = 26;
    if (isCombined) weekly.getColumn(3).width = 18;
    for (let column = firstDateColumnNumber; column < totalColumnNumber; column += 1) {
      weekly.getColumn(column).width = 13;
      weekly.getColumn(column).numFmt = "0.00";
    }
    weekly.getColumn(totalColumnNumber).width = 16;
    weekly.getColumn(totalColumnNumber).numFmt = "0.00";
    weekly.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } };
    weekly.getRow(2).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF5B21B6" },
    };
    weekly.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.alignment = { vertical: "middle", wrapText: true };
    });
  }

  if (includeClocked) {
    const daily = workbook.addWorksheet("Daily Clocking", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
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
      date: new Date(`${row.date}T12:00:00.000Z`),
      plannedStart: row.plannedStart,
      plannedEnd: row.plannedEnd,
      plannedBreak: row.plannedBreakMinutes,
      plannedHours: decimalHours(row.plannedMinutes),
      originalIns: row.originalClockIns.length ? row.originalClockIns.map(formatTimeUk).join(", ") : null,
      originalOuts: row.originalClockOuts.length ? row.originalClockOuts.map(formatTimeUk).join(", ") : null,
      managerIns: row.managerClockIns.length ? row.managerClockIns.map(formatTimeUk).join(", ") : null,
      managerOuts: row.managerClockOuts.length ? row.managerClockOuts.map(formatTimeUk).join(", ") : null,
      rawHours: decimalHours(row.rawWorkedMinutes),
      workedHours: decimalHours(row.workedMinutes),
      reviewStatus: row.reviewStatus.replaceAll("_", " "),
      reviewReason: row.reviewReason,
      warnings: row.warnings.length ? row.warnings.join("; ") : null,
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
  }

  const notes = workbook.addWorksheet("Read Me");
  const hoursModeLabel =
    options.hours === "planned"
      ? "Planned hours only"
      : options.hours === "clocked"
        ? "Clocked hours only"
        : "Both planned and clocked hours";
  notes.addRows([
    [workbookLabel],
    [`Period: ${periodStart} to ${periodEnd}`],
    [`Hours included: ${hoursModeLabel}`],
    ...(options.hours === "planned"
      ? [["This workbook contains rota planned hours only."]]
      : isUnreviewed
        ? [
            [`${reviewState.unresolved} worked day(s) are not reviewed.`],
            [`${reviewState.pendingRequests} staff correction request(s) remain open.`],
            ["Check and correct these hours manually before using them for payroll."],
          ]
        : [["This workbook contains manager-reviewed preparation figures only."]]),
    ["It does not calculate PAYE, National Insurance, pensions, student loans or payslips."],
    ...(includeClocked
      ? [["Original clock events remain unchanged. Manager correction events and review notes are shown separately."]]
      : []),
    ["Each numbered worksheet covers one Monday-to-Sunday week within the selected period."],
    ...(includePlanned ? [["Planned hours deduct planned rota breaks."]] : []),
    ...(includeClocked
      ? [["Clocked hours sum original completed clock-in/out sessions. Clocked-out breaks are unpaid."]]
      : []),
  ]);
  notes.getColumn(1).width = 100;
  notes.getRow(1).font = { bold: true, size: 14 };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
