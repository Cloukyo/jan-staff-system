import type { AttendanceDay, PayPeriodSummary, StaffMember } from "@/types";
import { formatDateUk, formatDecimalHours, formatDurationCompact, formatHours, formatMoney, formatTimeUk } from "@/lib/dates/format";

export function escapeCsv(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createCsvContent(rows: (string | number | null | undefined)[][]): string {
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const csv = createCsvContent(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportAttendanceCsv(days: AttendanceDay[], staff: StaffMember[], periodStart: string, periodEnd: string): void {
  const rows = [
    [
      "Staff name",
      "Role",
      "Date",
      "Scheduled start",
      "Scheduled finish",
      "First clock-in",
      "Final clock-out",
      "Break minutes",
      "Recorded hours",
      "Credited paid-status hours",
      "Approved payable hours",
      "Attendance status",
      "Exception flags",
      "Manager adjustment reason",
      "Manager note",
    ],
    ...days.map((day) => {
      const person = staff.find((item) => item.id === day.staffId);
      return [
        person?.fullName ?? "Unknown",
        person?.role ?? "",
        formatDateUk(day.date),
        day.shift?.scheduledStart ?? "",
        day.shift?.scheduledEnd ?? "",
        formatTimeUk(day.firstClockIn),
        formatTimeUk(day.finalClockOut),
        day.breakMinutes,
        formatHours(day.recordedMinutes),
        formatHours(day.creditedPaidMinutes),
        formatHours(day.approvedPayableMinutes),
        day.approvalStatus,
        day.exceptionFlags.join("; "),
        day.adjustmentReason ?? "",
        day.managerNote,
      ];
    }),
  ];
  downloadCsv(`jan-staff-attendance-${periodStart}-to-${periodEnd}.csv`, rows);
}

export function exportPayCsv(summaries: PayPeriodSummary[], staff: StaffMember[], periodStart: string, periodEnd: string): void {
  const rows = [
    [
      "Staff name",
      "Pay type",
      "Period start",
      "Period end",
      "Contracted weekly hours",
      "Recorded attendance hours",
      "Approved payable hours",
      "Provisional hours",
      "Paid holiday hours",
      "Paid sickness hours",
      "Paid training hours",
      "Hourly rate",
      "Calculated hourly pay",
      "Standard salary",
      "Additions",
      "Deductions",
      "Final gross pay",
      "Review status",
      "Manager notes",
    ],
    ...summaries.map((summary) => {
      const person = staff.find((item) => item.id === summary.staffId);
      return [
        person?.fullName ?? "Unknown",
        summary.payType,
        formatDateUk(summary.periodStart),
        formatDateUk(summary.periodEnd),
        formatDurationCompact(person?.contractedWeeklyMinutes ?? 0),
        formatHours(summary.recordedMinutes),
        formatHours(summary.approvedMinutes),
        formatHours(summary.provisionalMinutes),
        formatDecimalHours(summary.paidHolidayMinutes),
        formatDecimalHours(summary.paidSicknessMinutes),
        formatDecimalHours(summary.paidTrainingMinutes),
        summary.applicableHourlyRatePence ? formatMoney(summary.applicableHourlyRatePence) : "",
        formatMoney(summary.calculatedHourlyPayPence),
        formatMoney(summary.standardSalaryPence),
        formatMoney(summary.additionsPence),
        formatMoney(summary.deductionsPence),
        formatMoney(summary.finalGrossPayPence),
        summary.status,
        summary.managerNotes,
      ];
    }),
  ];
  downloadCsv(`jan-staff-pay-preparation-${periodStart}-to-${periodEnd}.csv`, rows);
}
