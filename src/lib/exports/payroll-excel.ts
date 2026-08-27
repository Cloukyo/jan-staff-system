import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { format, parseISO } from "date-fns";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { requirePermission } from "@/lib/commercial-identity/guards";
import { splitPayrollDatesIntoWeeks } from "@/lib/exports/payroll-detail";
import {
  payrollModeIncludesClocked,
  payrollModeIncludesPlanned,
  type PayrollExportHoursMode,
} from "@/lib/exports/payroll-options";
import type { PayrollExportDetail, PayrollPreparationRow } from "@/lib/payroll/types";
import { getCommercialExportIdentity, getExportIdentity } from "@/lib/exports/identity";
import type { CommercialPayrollCommandResult } from "@/lib/payroll/tenant-actions";
import type { CommercialMembershipContext } from "@/types/tenancy";

export const COMMERCIAL_PAYROLL_EXPORT_MAX_ROWS = 50_000;
export const COMMERCIAL_PAYROLL_EXPORT_MAX_WORKSHEETS = 4;
const COMMERCIAL_PAYROLL_EXPORT_MAX_TEXT_LENGTH = 32_767;

export type CommercialApprovedPayrollExportRow = {
  rowId?: string;
  organisationId: string;
  runId: string;
  staffId: string;
  sourceKind?: "attendance" | "staff_summary" | "adjustment_summary";
  fullName: string;
  employmentRole: string;
  siteId: string | null;
  siteDisplayName: string | null;
  operationalDate: string;
  payType: "hourly" | "salaried" | null;
  rawMinutes: number;
  adjustmentMinutes: number;
  payableMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  estimatedGrossValue: number | null;
  currencyCode: string;
  warnings: string[];
};

export type CommercialApprovedPayrollExport = {
  organisationId: string;
  organisationDisplayName: string;
  siteId: string | null;
  siteDisplayName: string | null;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  runId: string;
  approvalId: string;
  revision: number;
  approvalStatus: "approved" | "reopened";
  rowFingerprint: string;
  payableMinutesTotal: number;
  adjustmentMinutesTotal: number;
  adjustmentSnapshots: Array<{
    adjustmentId: string;
    lineageRootId: string;
    staffId: string;
    targetKind: "attendance" | "organisation_summary" | "site_summary";
    siteId: string | null;
    operationalDate: string | null;
    adjustmentMinutes: number;
    reason: string;
    createdAt: string;
  }>;
  readiness: {
    blocker: number;
    warning: number;
    informational: number;
  };
  rows: CommercialApprovedPayrollExportRow[];
};

export type CommercialPayrollExportRequest = {
  context: CommercialMembershipContext;
  periodId: string;
  approvalId: string;
  expectedRevision: number;
  requestedSiteId: string | null;
  plannedDetail?: PayrollExportDetail;
};

export type CommercialPayrollExportDependencies = {
  loadApprovedRevision: (scope: {
    organisationId: string;
    periodId: string;
    approvalId: string;
    expectedRevision: number;
    siteId: string | null;
  }) => Promise<CommercialApprovedPayrollExport>;
  recordExport: (input: {
    periodId: string;
    approvalId: string;
    expectedRevision: number;
    operationId: string;
    format: "xlsx";
    fileName: string;
    contentSha256: string;
    rowCount: number;
    rowFingerprint: string;
    payableMinutes: number;
    adjustmentMinutes: number;
  }) => Promise<CommercialPayrollCommandResult>;
  createOperationId: () => string;
};

function boundedExcelText(value: string | null | undefined): string {
  return String(value ?? "").slice(0, COMMERCIAL_PAYROLL_EXPORT_MAX_TEXT_LENGTH);
}

function safeExcelText(value: string | null | undefined): string {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text)
    ? `'${text.slice(0, COMMERCIAL_PAYROLL_EXPORT_MAX_TEXT_LENGTH - 1)}`
    : boundedExcelText(text);
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  row.alignment = { vertical: "middle", wrapText: true };
}

function commercialWorkbookText(input: CommercialApprovedPayrollExport): string {
  const identity = getCommercialExportIdentity(input);
  return boundedExcelText([identity.organisationDisplayName, identity.siteDisplayName]
    .filter(Boolean).join(" | "));
}

function assertCommercialApprovedEvidence(input: CommercialApprovedPayrollExport): void {
  const payableMinutes = input.rows.reduce((sum, row) => sum + row.payableMinutes, 0);
  const adjustmentMinutes = input.rows.reduce((sum, row) => sum + row.adjustmentMinutes, 0);
  const snapshotIds = input.adjustmentSnapshots.map((snapshot) => snapshot.adjustmentId);
  if (!validEvidenceFingerprint(input.rowFingerprint)
    || payableMinutes !== input.payableMinutesTotal
    || adjustmentMinutes !== input.adjustmentMinutesTotal
    || new Set(snapshotIds).size !== snapshotIds.length) {
    throw new Error("The approved payroll evidence does not reconcile.");
  }
}

function validEvidenceFingerprint(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export async function createCommercialPayrollWorkbook(
  input: CommercialApprovedPayrollExport,
  plannedDetail?: PayrollExportDetail,
): Promise<Buffer> {
  if (input.rows.length > COMMERCIAL_PAYROLL_EXPORT_MAX_ROWS) {
    throw new Error(`The commercial payroll export row limit is ${COMMERCIAL_PAYROLL_EXPORT_MAX_ROWS}.`);
  }
  if (!Number.isInteger(input.revision) || input.revision < 1
    || input.approvalStatus !== "approved") {
    throw new Error("The approved payroll revision is invalid.");
  }
  if (input.rows.some((row) => row.organisationId !== input.organisationId
    || row.runId !== input.runId
    || (input.siteId !== null && row.siteId !== input.siteId))) {
    throw new Error("The approved payroll revision contains rows outside its export scope.");
  }
  assertCommercialApprovedEvidence(input);

  const identity = getCommercialExportIdentity(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = identity.productName;
  workbook.subject = boundedExcelText(`${commercialWorkbookText(input)} payroll preparation revision ${input.revision}`);
  workbook.title = boundedExcelText(`${identity.organisationDisplayName} payroll preparation`);
  workbook.company = boundedExcelText(identity.organisationDisplayName);
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const organisationMinutes = input.payableMinutesTotal;
  const adjustmentMinutes = input.adjustmentMinutesTotal;
  const siteMinutes = new Map<string, number>();
  const categoryMinutes = new Map<string, number>();
  for (const row of input.rows) {
    if (row.sourceKind !== "staff_summary") {
      const site = row.siteDisplayName ?? "Unattributed";
      siteMinutes.set(site, (siteMinutes.get(site) ?? 0) + row.payableMinutes);
    }
    const category = row.payType ?? "Missing pay category";
    categoryMinutes.set(category, (categoryMinutes.get(category) ?? 0) + row.payableMinutes);
  }
  summary.columns = [
    { header: "Report", key: "label", width: 34 },
    { header: "Value", key: "value", width: 52 },
  ];
  summary.addRows([
    { label: "Product", value: identity.productName },
    { label: "Organisation", value: safeExcelText(identity.organisationDisplayName) },
    { label: "Site filter", value: safeExcelText(identity.siteDisplayName ?? "All authorised sites") },
    { label: "Period", value: `${formatDateUk(input.periodStart)} to ${formatDateUk(input.periodEnd)}` },
    { label: "Approved revision", value: `Revision ${input.revision}` },
    { label: "Approval state", value: "Approved" },
    { label: "Organisation total", value: `${organisationMinutes} minutes` },
    { label: "Adjustment total", value: `${adjustmentMinutes} minutes` },
    { label: "Readiness blockers", value: input.readiness.blocker },
    { label: "Readiness warnings", value: input.readiness.warning },
    { label: "Readiness information", value: input.readiness.informational },
    ...[...siteMinutes].map(([site, minutes]) => ({
      label: safeExcelText(`Site-attributed minutes: ${site}`),
      value: minutes,
    })),
    ...[...categoryMinutes].map(([category, minutes]) => ({
      label: safeExcelText(`Pay category: ${category}`),
      value: minutes,
    })),
  ]);
  styleHeader(summary.getRow(1));
  summary.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });

  const groupedStaff = new Map<string, {
    fullName: string;
    employmentRole: string;
    payType: string;
    payableMinutes: number;
    ordinaryMinutes: number;
    overtimeMinutes: number;
    adjustmentMinutes: number;
    estimatedGrossValue: number | null;
  }>();
  for (const row of input.rows) {
    const current = groupedStaff.get(row.staffId) ?? {
      fullName: row.fullName,
      employmentRole: row.employmentRole,
      payType: row.payType ?? "Missing",
      payableMinutes: 0,
      ordinaryMinutes: 0,
      overtimeMinutes: 0,
      adjustmentMinutes: 0,
      estimatedGrossValue: null,
    };
    current.payableMinutes += row.payableMinutes;
    current.ordinaryMinutes += row.ordinaryMinutes;
    current.overtimeMinutes += row.overtimeMinutes;
    current.adjustmentMinutes += row.adjustmentMinutes;
    if (row.estimatedGrossValue !== null) {
      current.estimatedGrossValue = (current.estimatedGrossValue ?? 0) + row.estimatedGrossValue;
    }
    groupedStaff.set(row.staffId, current);
  }
  const staff = workbook.addWorksheet("Staff totals", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  staff.columns = [
    { header: "Staff name", key: "fullName", width: 30 },
    { header: "Role", key: "employmentRole", width: 24 },
    { header: "Pay category", key: "payType", width: 18 },
    { header: "Payable minutes", key: "payableMinutes", width: 18 },
    { header: "Ordinary minutes", key: "ordinaryMinutes", width: 18 },
    { header: "Overtime minutes", key: "overtimeMinutes", width: 18 },
    { header: "Adjustment minutes", key: "adjustmentMinutes", width: 20 },
    { header: "Estimated preparation value", key: "estimatedGrossValue", width: 28 },
  ];
  for (const value of groupedStaff.values()) {
    staff.addRow({
      ...value,
      fullName: safeExcelText(value.fullName),
      employmentRole: safeExcelText(value.employmentRole),
      payType: safeExcelText(value.payType),
    });
  }
  styleHeader(staff.getRow(1));
  staff.getColumn("H").numFmt = '£#,##0.00';

  const detail = workbook.addWorksheet("Approved detail", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  detail.columns = [
    { header: "Staff name", key: "fullName", width: 30 },
    { header: "Role", key: "employmentRole", width: 24 },
    { header: "Site", key: "site", width: 24 },
    { header: "Date", key: "date", width: 14 },
    { header: "Pay category", key: "payType", width: 18 },
    { header: "Raw minutes", key: "rawMinutes", width: 15 },
    { header: "Adjustment minutes", key: "adjustmentMinutes", width: 20 },
    { header: "Payable minutes", key: "payableMinutes", width: 18 },
    { header: "Ordinary minutes", key: "ordinaryMinutes", width: 18 },
    { header: "Overtime minutes", key: "overtimeMinutes", width: 18 },
    { header: "Estimated preparation value", key: "estimatedGrossValue", width: 28 },
    { header: "Warnings", key: "warnings", width: 42 },
  ];
  for (const row of input.rows) {
    detail.addRow({
      fullName: safeExcelText(row.fullName),
      employmentRole: safeExcelText(row.employmentRole),
      site: safeExcelText(row.sourceKind === "staff_summary"
        ? "No attendance"
        : row.sourceKind === "adjustment_summary" && row.siteId === null
          ? "Organisation adjustment"
          : row.siteDisplayName ?? "Unattributed"),
      date: row.sourceKind === "attendance"
        ? new Date(`${row.operationalDate}T12:00:00.000Z`)
        : null,
      payType: safeExcelText(row.payType ?? "Missing"),
      rawMinutes: row.rawMinutes,
      adjustmentMinutes: row.adjustmentMinutes,
      payableMinutes: row.payableMinutes,
      ordinaryMinutes: row.ordinaryMinutes,
      overtimeMinutes: row.overtimeMinutes,
      estimatedGrossValue: row.estimatedGrossValue,
      warnings: safeExcelText(row.warnings.join("; ")),
    });
  }
  styleHeader(detail.getRow(1));
  detail.getColumn("D").numFmt = "dd/mm/yyyy";
  detail.getColumn("K").numFmt = '£#,##0.00';

  if (plannedDetail) {
    const planned = workbook.addWorksheet("Planned hours", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    planned.columns = [
      { header: "Staff name", key: "fullName", width: 30 },
      { header: "Role", key: "employmentRole", width: 24 },
      { header: "Date", key: "date", width: 14 },
      { header: "Planned break minutes", key: "plannedBreakMinutes", width: 24 },
      { header: "Planned net hours", key: "plannedHours", width: 20 },
    ];
    for (const row of plannedDetail.dailyRows.filter((detailRow) => detailRow.plannedMinutes > 0)) {
      planned.addRow({
        fullName: safeExcelText(row.fullName),
        employmentRole: safeExcelText(row.employmentRole),
        date: new Date(`${row.date}T12:00:00.000Z`),
        plannedBreakMinutes: row.plannedBreakMinutes,
        plannedHours: decimalHours(row.plannedMinutes),
      });
    }
    styleHeader(planned.getRow(1));
    planned.autoFilter = { from: "A1", to: "E1" };
    planned.getColumn("C").numFmt = "dd/mm/yyyy";
    planned.getColumn("E").numFmt = "0.00";
    planned.eachRow((row, rowNumber) => {
      row.alignment = { vertical: "top", wrapText: rowNumber > 1 };
    });
  }

  if (workbook.worksheets.length > COMMERCIAL_PAYROLL_EXPORT_MAX_WORKSHEETS) {
    throw new Error("The commercial payroll export workbook limit was exceeded.");
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function assertApprovedExportMatchesRequest(
  stored: CommercialApprovedPayrollExport,
  request: CommercialPayrollExportRequest,
  siteId: string | null,
): void {
  if (stored.organisationId !== request.context.organisationId
    || stored.periodId !== request.periodId
    || stored.approvalId !== request.approvalId
    || stored.revision !== request.expectedRevision
    || stored.approvalStatus !== "approved"
    || stored.siteId !== siteId
    || stored.rows.some((row) => row.organisationId !== stored.organisationId
      || row.runId !== stored.runId
      || (siteId !== null && row.siteId !== siteId))) {
    throw new Error("The approved payroll revision does not match the authorised export request.");
  }
}

export async function prepareCommercialPayrollExport(
  request: CommercialPayrollExportRequest,
  dependencies: CommercialPayrollExportDependencies,
) {
  requirePermission(request.context, "payroll.read");
  requirePermission(request.context, "payroll.export");
  const siteId = request.context.selectedSiteId;
  if (request.requestedSiteId !== siteId
    || (siteId !== null && (!request.context.permittedSiteIds.includes(siteId)
      || !request.context.sitePermissions[siteId]?.includes("payroll.export")))) {
    throw new CommercialIdentityError("site_unavailable");
  }
  const stored = await dependencies.loadApprovedRevision({
    organisationId: request.context.organisationId,
    periodId: request.periodId,
    approvalId: request.approvalId,
    expectedRevision: request.expectedRevision,
    siteId,
  });
  assertApprovedExportMatchesRequest(stored, request, siteId);
  assertCommercialApprovedEvidence(stored);
  const workbook = await createCommercialPayrollWorkbook(stored, request.plannedDetail);
  const digest = createHash("sha256").update(workbook).digest("hex");
  const identity = getCommercialExportIdentity(stored);
  const fileName = `${identity.fileSlug}-payroll-${stored.periodStart}-to-${stored.periodEnd}-r${stored.revision}.xlsx`;
  const receipt = await dependencies.recordExport({
    periodId: stored.periodId,
    approvalId: stored.approvalId,
    expectedRevision: stored.revision,
    operationId: dependencies.createOperationId(),
    format: "xlsx",
    fileName,
    contentSha256: digest,
    rowCount: stored.rows.length,
    rowFingerprint: stored.rowFingerprint,
    payableMinutes: stored.payableMinutesTotal,
    adjustmentMinutes: stored.adjustmentMinutesTotal,
  });
  if (!receipt.ok) throw new Error(`Payroll export audit failed: ${receipt.code}`);
  return { workbook, fileName, digest, rowCount: stored.rows.length, receipt };
}

const decimalHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

function formatCorrectionAudit(
  records: PayrollExportDetail["dailyRows"][number]["correctionRecords"],
): string | null {
  if (!records.length) return null;
  return records.map((record) => [
    record.id,
    record.status,
    record.kind,
    record.eventType ?? "no event",
    record.eventTimestamp ? formatTimeUk(record.eventTimestamp) : "no time",
    record.reason,
    `batch=${record.batchId}`,
    `role=${record.correctionRole}`,
    `original=${record.originalEventId ?? ""}`,
    `supersedes=${record.supersedesCorrectionId ?? ""}`,
    `recorded_date=${record.recordedDate}`,
    `event_timestamp=${record.eventTimestamp ?? ""}`,
    `created_by=${record.createdBy}`,
    `created_at=${record.createdAt}`,
  ].join(" | ")).join("; ");
}

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
  const identity = getExportIdentity();
  workbook.creator = identity.productName;
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const includePlanned = payrollModeIncludesPlanned(options.hours);
  const includeClocked = payrollModeIncludesClocked(options.hours);
  const isUnreviewed =
    includeClocked && (reviewState.unresolved > 0 || reviewState.pendingRequests > 0);
  const workbookLabel =
    options.hours === "planned"
      ? `${identity.siteDisplayName} planned hours export`
      : isUnreviewed
        ? "UNREVIEWED PAYROLL PREPARATION"
        : `${identity.siteDisplayName} payroll preparation`;
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
    { header: "Total planned hours", key: "planned", width: 20 },
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
  const plannedMinutesByStaffId = new Map(
    detail.plannedRows.map((plannedRow) => [
      plannedRow.staffId,
      detail.dates.reduce(
        (total, date) => total + (plannedRow.plannedMinutesByDate[date] ?? 0),
        0,
      ),
    ]),
  );
  for (const row of rows) {
    sheet.addRow({
      staff: row.fullName,
      role: row.employmentRole,
      start: periodStart,
      end: periodEnd,
      payType: row.payType ?? "",
      hoursBasis: row.hoursBasis?.replaceAll("_", " ") ?? "",
      contracted: row.contractedWeeklyHours,
      planned: decimalHours(plannedMinutesByStaffId.get(row.staffId) ?? 0),
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
  sheet.autoFilter = { from: "A1", to: "R1" };
  for (const key of ["M", "N", "O"]) sheet.getColumn(key).numFmt = '£#,##0.00';
  for (const key of ["G", "H", "I", "J", "K", "L"]) sheet.getColumn(key).numFmt = "0.00";
    sheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: "top", wrapText: rowNumber > 1 };
    });
  }

  const clockedMinutesByStaffDate = new Map(
    detail.dailyRows.map((row) => [`${row.staffId}:${row.date}`, row.workedMinutes]),
  );
  const hourlyRateByStaffId = new Map(
    rows.map((row) => [
      row.staffId,
      row.payType === "hourly" ? row.hourlyRate : null,
    ]),
  );
  for (const [weekIndex, weekDates] of splitPayrollDatesIntoWeeks(detail.dates).entries()) {
    const isCombined = options.hours === "both";
    const firstDateColumnNumber = isCombined ? 4 : 3;
    const totalColumnNumber = firstDateColumnNumber + weekDates.length;
    const hourlyPayColumnNumber = totalColumnNumber + 1;
    const estimatedPayColumnNumber = totalColumnNumber + 2;
    const weekly = workbook.addWorksheet(`Week ${weekIndex + 1}`, {
      views: [{ state: "frozen", xSplit: isCombined ? 3 : 2, ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    weekly.mergeCells(1, 1, 1, estimatedPayColumnNumber);
    weekly.getCell(1, 1).value = isCombined
      ? "Planned hours deduct rota breaks. Clocked hours use effective attendance after manager corrections, so clocked-out breaks are unpaid. Hourly pay is editable and estimated pay is not completed payroll."
      : includePlanned
        ? "Planned hours deduct planned rota breaks. Hourly pay is editable and estimated pay is not completed payroll."
        : "Clocked hours use effective attendance after manager corrections, so clocked-out breaks are unpaid. Hourly pay is editable and estimated pay is not completed payroll.";
    weekly.getCell(1, 1).font = { bold: true, color: { argb: "FF4C1D95" } };
    weekly.getCell(1, 1).alignment = { wrapText: true, vertical: "middle" };
    weekly.getRow(1).height = 32;
    weekly.addRow([
      "Staff name",
      "Role",
      ...(isCombined ? ["Hours type"] : []),
      ...weekDates.map((date) => format(parseISO(date), "EEE dd/MM")),
      "Weekly total",
      "Hourly pay",
      "Estimated pay",
    ]);

    for (const staffRow of detail.plannedRows) {
      const plannedMinutes = weekDates.map(
        (date) => staffRow.plannedMinutesByDate[date] ?? 0,
      );
      const clockedMinutes = weekDates.map(
        (date) => clockedMinutesByStaffDate.get(`${staffRow.staffId}:${date}`) ?? 0,
      );
      const firstDateColumn = weekly.getColumn(firstDateColumnNumber).letter;
      const lastDateColumn = weekly.getColumn(totalColumnNumber - 1).letter;
      const hourlyRate = hourlyRateByStaffId.get(staffRow.staffId) ?? null;
      const addHoursRow = (
        label: "Planned hours" | "Clocked hours",
        minutes: number[],
        includeIdentity: boolean,
        hourlyRateRowNumber?: number,
      ) => {
        const totalHours = decimalHours(minutes.reduce((sum, value) => sum + value, 0));
        const row = weekly.addRow([
          includeIdentity ? staffRow.fullName : null,
          includeIdentity ? staffRow.employmentRole : null,
          ...(isCombined ? [label] : []),
          ...minutes.map(decimalHours),
          null,
          hourlyRateRowNumber === undefined ? hourlyRate : null,
          null,
        ]);
        row.getCell(totalColumnNumber).value = {
          formula: `SUM(${firstDateColumn}${row.number}:${lastDateColumn}${row.number})`,
          result: totalHours,
        };
        const rateCell = weekly.getCell(
          hourlyRateRowNumber ?? row.number,
          hourlyPayColumnNumber,
        );
        const totalCell = row.getCell(totalColumnNumber);
        row.getCell(estimatedPayColumnNumber).value = {
          formula: `IF(${rateCell.address}="","",${totalCell.address}*${rateCell.address})`,
          result:
            hourlyRate === null
              ? ""
              : Math.round(totalHours * hourlyRate * 100) / 100,
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
        const clockedRow = addHoursRow(
          "Clocked hours",
          clockedMinutes,
          false,
          plannedRow.number,
        );
        weekly.mergeCells(plannedRow.number, 1, clockedRow.number, 1);
        weekly.mergeCells(plannedRow.number, 2, clockedRow.number, 2);
        weekly.mergeCells(
          plannedRow.number,
          hourlyPayColumnNumber,
          clockedRow.number,
          hourlyPayColumnNumber,
        );
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
    weekly.getColumn(hourlyPayColumnNumber).width = 15;
    weekly.getColumn(hourlyPayColumnNumber).numFmt = '"£"#,##0.00';
    weekly.getColumn(estimatedPayColumnNumber).width = 17;
    weekly.getColumn(estimatedPayColumnNumber).numFmt = '"£"#,##0.00';
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
    { header: "Correction audit", key: "correctionAudit", width: 56 },
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
      correctionAudit: formatCorrectionAudit(row.correctionRecords),
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
  daily.autoFilter = { from: "A1", to: "Q1" };
  daily.getColumn("C").numFmt = "dd/mm/yyyy";
  for (const column of ["G", "M", "N"]) daily.getColumn(column).numFmt = "0.00";
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
      ? [["Clocked hours use effective attendance after manager corrections. Clocked-out breaks are unpaid."]]
      : []),
    ["Hourly pay on each weekly sheet is editable. Blank or salaried rates are left blank."],
    ["Estimated pay is weekly hours multiplied by hourly pay. It is a simple estimate, not completed payroll."],
  ]);
  notes.getColumn(1).width = 100;
  notes.getRow(1).font = { bold: true, size: 14 };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
