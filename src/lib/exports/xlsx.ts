import * as XLSX from "xlsx";
import type { AttendanceDay, PayPeriodSummary, StaffMember } from "@/types";
import { formatDateUk, formatDecimalHours, formatDurationCompact, formatHours, formatTimeUk } from "@/lib/dates/format";

type CellValue = string | number;

function autoWidth(rows: Record<string, CellValue>[]) {
  const keys = Object.keys(rows[0] ?? {});
  return keys.map((key) => ({
    wch: Math.min(34, Math.max(key.length + 2, ...rows.map((row) => String(row[key] ?? "").length + 2))),
  }));
}

function styleSheet(sheet: XLSX.WorkSheet, rows: Record<string, CellValue>[]) {
  sheet["!cols"] = autoWidth(rows);
  sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1:A1" };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const header = sheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (header) header.s = { font: { bold: true } };
  }
}

export function createPayWorkbook(
  summaries: PayPeriodSummary[],
  days: AttendanceDay[],
  staff: StaffMember[],
  periodStart: string,
  periodEnd: string,
): XLSX.WorkBook {
  const payRows = summaries.map((summary) => {
    const person = staff.find((item) => item.id === summary.staffId);
    return {
      "Staff name": person?.fullName ?? "Unknown",
      Role: person?.role ?? "",
      "Pay type": summary.payType,
      "Period start": formatDateUk(periodStart),
      "Period end": formatDateUk(periodEnd),
      "Contracted weekly hours": formatDurationCompact(person?.contractedWeeklyMinutes ?? 0),
      "Worked approved hours": formatDecimalHours(summary.workedApprovedMinutes),
      "Paid holiday hours": formatDecimalHours(summary.paidHolidayMinutes),
      "Paid sickness hours": formatDecimalHours(summary.paidSicknessMinutes),
      "Paid training hours": formatDecimalHours(summary.paidTrainingMinutes),
      "Total approved payable hours": formatDecimalHours(summary.approvedMinutes),
      "Hourly rate": summary.applicableHourlyRatePence ? summary.applicableHourlyRatePence / 100 : "",
      "Calculated hourly pay": summary.calculatedHourlyPayPence ? summary.calculatedHourlyPayPence / 100 : "",
      "Standard salary": summary.standardSalaryPence ? summary.standardSalaryPence / 100 : "",
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

  const workbook = XLSX.utils.book_new();
  const paySheet = XLSX.utils.json_to_sheet(payRows);
  const attendanceSheet = XLSX.utils.json_to_sheet(attendanceRows);
  styleSheet(paySheet, payRows);
  styleSheet(attendanceSheet, attendanceRows);
  XLSX.utils.book_append_sheet(workbook, paySheet, "Pay Summary");
  XLSX.utils.book_append_sheet(workbook, attendanceSheet, "Attendance Detail");
  return workbook;
}

export function exportPayWorkbook(
  summaries: PayPeriodSummary[],
  days: AttendanceDay[],
  staff: StaffMember[],
  periodStart: string,
  periodEnd: string,
) {
  const workbook = createPayWorkbook(summaries, days, staff, periodStart, periodEnd);
  XLSX.writeFile(workbook, `jan-staff-pay-workbook-${periodStart}-to-${periodEnd}.xlsx`, { compression: true });
}
