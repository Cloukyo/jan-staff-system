import ExcelJS from "exceljs";
import type { AttendanceDay, PayPeriodSummary, StaffMember } from "@/types";
import {
  formatDateUk,
  formatDecimalHours,
  formatDurationCompact,
  formatHours,
  formatTimeUk,
} from "@/lib/dates/format";
import { getExportIdentity } from "@/lib/exports/identity";

type CellValue = string | number;
type WorkbookRow = Record<string, CellValue>;

function autoWidth(rows: WorkbookRow[], keys: string[]) {
  return keys.map((key) =>
    Math.min(
      34,
      Math.max(key.length + 2, ...rows.map((row) => String(row[key] ?? "").length + 2)),
    ),
  );
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: WorkbookRow[]) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const keys = Object.keys(rows[0] ?? {});
  const widths = autoWidth(rows, keys);
  sheet.columns = keys.map((key, index) => ({
    header: key,
    key,
    width: widths[index],
  }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: Math.max(1, keys.length) },
  };
  return sheet;
}

export function createPayWorkbook(
  summaries: PayPeriodSummary[],
  days: AttendanceDay[],
  staff: StaffMember[],
  periodStart: string,
  periodEnd: string,
): ExcelJS.Workbook {
  const payRows = summaries.map((summary) => {
    const person = staff.find((item) => item.id === summary.staffId);
    return {
      "Staff name": person?.fullName ?? "Unknown",
      Role: person?.role ?? "",
      "Pay type": summary.payType,
      "Period start": formatDateUk(periodStart),
      "Period end": formatDateUk(periodEnd),
      "Contracted weekly hours": formatDurationCompact(
        person?.contractedWeeklyMinutes ?? 0,
      ),
      "Worked approved hours": formatDecimalHours(summary.workedApprovedMinutes),
      "Paid holiday hours": formatDecimalHours(summary.paidHolidayMinutes),
      "Paid sickness hours": formatDecimalHours(summary.paidSicknessMinutes),
      "Paid training hours": formatDecimalHours(summary.paidTrainingMinutes),
      "Total approved payable hours": formatDecimalHours(summary.approvedMinutes),
      "Hourly rate": summary.applicableHourlyRatePence
        ? summary.applicableHourlyRatePence / 100
        : "",
      "Calculated hourly pay": summary.calculatedHourlyPayPence
        ? summary.calculatedHourlyPayPence / 100
        : "",
      "Standard salary": summary.standardSalaryPence
        ? summary.standardSalaryPence / 100
        : "",
      Additions: summary.additionsPence / 100,
      Deductions: summary.deductionsPence / 100,
      "Final gross pay": summary.finalGrossPayPence / 100,
      "Review status": summary.status,
      "Manager notes": summary.managerNotes,
    };
  });

  const attendanceRows = days.map((day) => {
    const person = staff.find((item) => item.id === day.staffId);
    return {
      "Staff name": person?.fullName ?? "Unknown",
      Role: person?.role ?? "",
      Date: formatDateUk(day.date),
      "Rota status": day.shift?.status ?? "",
      "Scheduled start": day.shift?.scheduledStart ?? "",
      "Scheduled finish": day.shift?.scheduledEnd ?? "",
      "Planned break": day.shift?.plannedBreakMinutes ?? "",
      "Actual first clock-in": formatTimeUk(day.firstClockIn),
      "Actual final clock-out": formatTimeUk(day.finalClockOut),
      "Recorded break minutes": day.breakMinutes,
      "Recorded attendance hours": formatHours(day.recordedMinutes),
      "Credited paid-status hours": formatHours(day.creditedPaidMinutes),
      "Approved payable hours": formatHours(day.approvedPayableMinutes),
      "Exception flags": day.exceptionFlags.join("; "),
      "Review status": day.approvalStatus,
      "Adjustment reason": day.adjustmentReason ?? "",
      "Manager note": day.managerNote,
    };
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = getExportIdentity().productName;
  addSheet(workbook, "Pay Summary", payRows);
  addSheet(workbook, "Attendance Detail", attendanceRows);
  return workbook;
}

export async function exportPayWorkbook(
  summaries: PayPeriodSummary[],
  days: AttendanceDay[],
  staff: StaffMember[],
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  const workbook = createPayWorkbook(summaries, days, staff, periodStart, periodEnd);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${getExportIdentity().siteSlug}-pay-workbook-${periodStart}-to-${periodEnd}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
