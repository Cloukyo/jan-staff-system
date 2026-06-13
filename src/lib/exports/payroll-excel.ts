import ExcelJS from "exceljs";
import type { PayrollPreparationRow } from "@/lib/payroll/types";

const decimalHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export async function createPayrollPreparationWorkbook(
  rows: PayrollPreparationRow[],
  periodStart: string,
  periodEnd: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jan Pre-School Staff System";
  workbook.created = new Date();
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

  const notes = workbook.addWorksheet("Read Me");
  notes.addRows([
    ["Jan Pre-School payroll preparation"],
    [`Period: ${periodStart} to ${periodEnd}`],
    ["This workbook contains manager-reviewed preparation figures only."],
    ["It does not calculate PAYE, National Insurance, pensions, student loans or payslips."],
    ["Original clock events remain unchanged. Manager correction events and review notes are shown separately."],
  ]);
  notes.getColumn(1).width = 100;
  notes.getRow(1).font = { bold: true, size: 14 };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
