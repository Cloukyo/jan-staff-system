import ExcelJS from "exceljs";
import { addDays, format, parseISO } from "date-fns";
import { formatDateUk, isoDate } from "@/lib/dates/format";
import type { ProductionRotaDataset, ProductionRotaShift } from "@/lib/rota/types";
import type { RotaTemplate, RotaTemplateShift } from "@/lib/rota/template-types";
import { leaveWarningsForShift, overlapWarningsForShift, shiftDurationMinutes } from "@/lib/rota/validation";

export type RotaExportOptions = {
  format: "compact" | "detailed";
  includeWeekends: boolean;
  includeBreaks: boolean;
  includeRooms: boolean;
  includeRoles: boolean;
  includeWarnings: boolean;
  includeArchivedOrCancelled: boolean;
};

type ExportShift = ProductionRotaShift & { staffName: string; warnings: string[] };

const purple = "6D28D9";
const lightPurple = "F3E8FF";
const palePurple = "FAF5FF";
const amber = "FEF3C7";
const red = "FEE2E2";
const border: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "DDD6FE" } },
  left: { style: "thin", color: { argb: "DDD6FE" } },
  bottom: { style: "thin", color: { argb: "DDD6FE" } },
  right: { style: "thin", color: { argb: "DDD6FE" } },
};

export function rotaExportFilename(weekStart: string): string {
  return `Jan-Preschool-Rota-${weekStart}.xlsx`;
}

export function templateExportFilename(templateName: string): string {
  const safe = templateName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `Jan-Preschool-Rota-Template-${safe || "Export"}.xlsx`;
}

export function parseRotaExportOptions(searchParams: URLSearchParams): RotaExportOptions {
  return {
    format: searchParams.get("format") === "detailed" ? "detailed" : "compact",
    includeWeekends: searchParams.get("weekends") === "1",
    includeBreaks: searchParams.get("breaks") === "1",
    includeRooms: searchParams.get("rooms") === "1",
    includeRoles: searchParams.get("roles") === "1",
    includeWarnings: searchParams.get("warnings") === "1",
    includeArchivedOrCancelled: searchParams.get("archived") === "1",
  };
}

function timeRange(shifts: ProductionRotaShift[]): string {
  return shifts
    .toSorted((a, b) => a.startTime.localeCompare(b.startTime))
    .map((shift) => `${shift.startTime}-${shift.endTime}`)
    .join(" / ");
}

function grossMinutes(shifts: ProductionRotaShift[]): number {
  return shifts.reduce((total, shift) => total + shiftDurationMinutes(shift.startTime, shift.endTime), 0);
}

function confirmedBreakMinutes(shifts: ProductionRotaShift[]): number | null {
  if (shifts.some((shift) => shift.breakUnspecified)) return null;
  return shifts.reduce((total, shift) => total + shift.breakMinutes, 0);
}

function minutesAsExcelDays(minutes: number): number {
  return minutes / 1440;
}

function decorateSheet(sheet: ExcelJS.Worksheet, headerRow: number, lastColumn: number) {
  sheet.views = [{ state: "frozen", ySplit: headerRow, xSplit: 1 }];
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printTitlesRow: `${headerRow}:${headerRow}`,
  };
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: lastColumn } };
  sheet.getRow(headerRow).height = 32;
  sheet.getRow(headerRow).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: purple } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = border;
  });
}

function addTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  lastColumn: number,
  warning?: string,
) {
  sheet.mergeCells(1, 1, 1, lastColumn);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 18, color: { argb: "FFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: purple } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(2, 1).value = subtitle;
  sheet.getCell(2, 1).font = { bold: true, color: { argb: "4C1D95" } };
  sheet.getCell(2, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightPurple } };
  if (warning) {
    sheet.mergeCells(3, 1, 3, lastColumn);
    sheet.getCell(3, 1).value = warning;
    sheet.getCell(3, 1).font = { bold: true, color: { argb: "991B1B" } };
    sheet.getCell(3, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: red } };
  }
}

function getExportShifts(data: ProductionRotaDataset, options: RotaExportOptions): ExportShift[] {
  const staff = new Map(data.staff.map((person) => [person.id, person]));
  return data.shifts
    .filter((shift) => options.includeArchivedOrCancelled || (!shift.archivedAt && shift.status !== "cancelled"))
    .map((shift) => {
      const person = staff.get(shift.staffId);
      const warnings: string[] = [];
      if (options.includeWarnings) {
        const leave = leaveWarningsForShift(shift, data.leave);
        if (leave.some((item) => item.status === "approved")) warnings.push("Approved leave conflict");
        if (leave.some((item) => item.status === "pending")) warnings.push("Pending leave");
        if (overlapWarningsForShift(shift, data.shifts).length) warnings.push("Overlapping shift");
        if (!person?.active) warnings.push("Inactive staff");
        if (shift.breakUnspecified) warnings.push("Break unspecified");
        if (options.includeRooms && !shift.roomOrArea) warnings.push("Room not recorded");
        if (options.includeRoles && !shift.roleOnShift) warnings.push("Role not recorded");
        if (shift.status === "cancelled" || shift.archivedAt) warnings.push("Archived or cancelled shift included");
      }
      return { ...shift, staffName: person?.displayName || person?.fullName || "Unknown staff", warnings };
    });
}

function addWeeklyRotaSheet(workbook: ExcelJS.Workbook, data: ProductionRotaDataset, options: RotaExportOptions) {
  const sheet = workbook.addWorksheet("Weekly rota", { properties: { defaultRowHeight: 21 } });
  const dates = Array.from({ length: options.includeWeekends ? 7 : 5 }, (_, index) => isoDate(addDays(parseISO(data.weekStart), index)));
  const columnsPerDay = options.includeBreaks ? 4 : 3;
  const lastColumn = 1 + dates.length * columnsPerDay + 1;
  const headerRow = data.week?.status === "draft" ? 5 : 4;
  addTitle(
    sheet,
    "Jan Pre-School and Nursery",
    `Weekly rota | Week commencing ${formatDateUk(data.weekStart)} | ${data.week?.status ?? "No rota"}`,
    lastColumn,
    data.week?.status === "draft" ? "DRAFT ROTA: this schedule has not been published." : undefined,
  );

  const weekdayRow = headerRow - 1;
  sheet.getCell(weekdayRow, 1).value = "Staff member";
  sheet.mergeCells(weekdayRow, 1, headerRow, 1);
  let column = 2;
  dates.forEach((date) => {
    sheet.mergeCells(weekdayRow, column, weekdayRow, column + columnsPerDay - 1);
    const cell = sheet.getCell(weekdayRow, column);
    cell.value = `${format(parseISO(date), "EEEE")} ${formatDateUk(date)}`;
    cell.font = { bold: true, color: { argb: "4C1D95" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: lightPurple } };
    cell.alignment = { horizontal: "center" };
    sheet.getCell(headerRow, column).value = "Start";
    sheet.getCell(headerRow, column + 1).value = "Finish";
    sheet.getCell(headerRow, column + 2).value = "Hours";
    if (options.includeBreaks) sheet.getCell(headerRow, column + 3).value = "Break";
    column += columnsPerDay;
  });
  sheet.getCell(weekdayRow, lastColumn).value = "Weekly gross hours";
  sheet.mergeCells(weekdayRow, lastColumn, headerRow, lastColumn);
  decorateSheet(sheet, headerRow, lastColumn);
  sheet.getRow(weekdayRow).eachCell((cell) => { cell.border = border; });

  const shifts = getExportShifts(data, options);
  const staffIds = [...new Set(shifts.map((shift) => shift.staffId))];
  staffIds.sort((left, right) => (shifts.find((shift) => shift.staffId === left)?.staffName ?? "").localeCompare(shifts.find((shift) => shift.staffId === right)?.staffName ?? ""));
  staffIds.forEach((staffId, index) => {
    const row = sheet.addRow([]);
    const staffShifts = shifts.filter((shift) => shift.staffId === staffId);
    row.getCell(1).value = staffShifts[0]?.staffName ?? "Unknown staff";
    let cellColumn = 2;
    dates.forEach((date) => {
      const dayShifts = staffShifts.filter((shift) => shift.shiftDate === date);
      const sorted = dayShifts.toSorted((a, b) => a.startTime.localeCompare(b.startTime));
      row.getCell(cellColumn).value = sorted.map((shift) => shift.startTime).join(" / ");
      row.getCell(cellColumn + 1).value = sorted.map((shift) => shift.endTime).join(" / ");
      row.getCell(cellColumn + 2).value = dayShifts.length ? minutesAsExcelDays(grossMinutes(dayShifts)) : null;
      row.getCell(cellColumn + 2).numFmt = "[h]:mm";
      const comments = sorted.flatMap((shift) => [
        options.includeRooms && shift.roomOrArea ? `Room: ${shift.roomOrArea}` : "",
        options.includeRoles && shift.roleOnShift ? `Role: ${shift.roleOnShift}` : "",
        options.includeWarnings && shift.warnings.length ? `Warnings: ${shift.warnings.join(", ")}` : "",
        shift.notes ? `Notes: ${shift.notes}` : "",
      ].filter(Boolean));
      if (comments.length) row.getCell(cellColumn).note = comments.join("\n");
      if (options.includeBreaks) {
        const breaks = confirmedBreakMinutes(dayShifts);
        row.getCell(cellColumn + 3).value = dayShifts.length ? (breaks === null ? "Not specified" : `${breaks} min`) : "";
      }
      cellColumn += columnsPerDay;
    });
    row.getCell(lastColumn).value = minutesAsExcelDays(grossMinutes(staffShifts));
    row.getCell(lastColumn).numFmt = "[h]:mm";
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      if (index % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palePurple } };
    });
    row.getCell(1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  });

  sheet.getColumn(1).width = 24;
  for (let index = 2; index < lastColumn; index += 1) sheet.getColumn(index).width = 12;
  sheet.getColumn(lastColumn).width = 18;
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${Math.max(sheet.rowCount, headerRow)}`;
  return { shifts, dates };
}

function addShiftDetailsSheet(workbook: ExcelJS.Workbook, data: ProductionRotaDataset, options: RotaExportOptions, shifts: ExportShift[]) {
  const sheet = workbook.addWorksheet("Shift details", { properties: { defaultRowHeight: 20 } });
  const headers = ["Staff name", "Staff ID", "Date", "Day", "Start", "Finish", "Gross hours", "Confirmed break", "Net hours", "Room or area", "Role", "Status", "Warnings", "Notes"];
  addTitle(sheet, "Shift details", `Week commencing ${formatDateUk(data.weekStart)}`, headers.length);
  const headerRow = 4;
  headers.forEach((header, index) => { sheet.getCell(headerRow, index + 1).value = header; });
  decorateSheet(sheet, headerRow, headers.length);
  shifts.forEach((shift, index) => {
    const gross = shiftDurationMinutes(shift.startTime, shift.endTime);
    const confirmedBreak = shift.breakUnspecified ? null : shift.breakMinutes;
    const row = sheet.addRow([
      shift.staffName,
      shift.staffId,
      parseISO(shift.shiftDate),
      format(parseISO(shift.shiftDate), "EEEE"),
      shift.startTime,
      shift.endTime,
      minutesAsExcelDays(gross),
      confirmedBreak === null ? "Not specified" : confirmedBreak,
      confirmedBreak === null ? null : minutesAsExcelDays(gross - confirmedBreak),
      options.includeRooms ? shift.roomOrArea ?? "" : "",
      options.includeRoles ? shift.roleOnShift ?? "" : "",
      shift.status,
      shift.warnings.join("; "),
      shift.notes ?? "",
    ]);
    row.getCell(3).numFmt = "dd/mm/yyyy";
    row.getCell(7).numFmt = "[h]:mm";
    row.getCell(9).numFmt = "[h]:mm";
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border;
      cell.alignment = { vertical: "top", wrapText: true };
      if (index % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palePurple } };
    });
  });
  [24, 38, 13, 13, 10, 10, 13, 16, 12, 18, 18, 12, 32, 32].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.pageSetup.printArea = `A1:N${Math.max(sheet.rowCount, headerRow)}`;
}

function addWarningsSheet(workbook: ExcelJS.Workbook, data: ProductionRotaDataset, shifts: ExportShift[]) {
  const warnings = shifts.flatMap((shift) => shift.warnings.map((warning) => ({ shift, warning })));
  if (data.week?.status === "draft") warnings.unshift({ shift: shifts[0] ?? {} as ExportShift, warning: "Rota is still in draft" });
  const sheet = workbook.addWorksheet("Warnings");
  addTitle(sheet, "Rota warnings", `Week commencing ${formatDateUk(data.weekStart)}`, 5);
  ["Staff", "Date", "Time", "Warning", "Shift notes"].forEach((header, index) => { sheet.getCell(4, index + 1).value = header; });
  decorateSheet(sheet, 4, 5);
  warnings.forEach(({ shift, warning }) => {
    const row = sheet.addRow([
      shift.staffName ?? "",
      shift.shiftDate ? formatDateUk(shift.shiftDate) : "",
      shift.startTime ? `${shift.startTime}-${shift.endTime}` : "",
      warning,
      shift.notes ?? "",
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = border; cell.alignment = { wrapText: true, vertical: "top" }; });
    row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: warning.includes("Approved") || warning.includes("Overlap") ? red : amber } };
  });
  [24, 13, 16, 32, 36].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function addExportInformationSheet(
  workbook: ExcelJS.Workbook,
  values: { weekStart?: string; status: string; exportedBy: string; title: string; description?: string | null; assumptions: string[] },
) {
  const sheet = workbook.addWorksheet("Export information");
  addTitle(sheet, "Export information", values.title, 2);
  const rows: Array<[string, string]> = [
    ["Nursery", "Jan Pre-School and Nursery"],
    ["Week commencing", values.weekStart ? formatDateUk(values.weekStart) : "Reusable weekday template"],
    ["Status", values.status],
    ["Exported at", new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date())],
    ["Exported by", values.exportedBy],
    ["Source", "Production rota system"],
  ];
  if (values.description) rows.push(["Description", values.description]);
  rows.push(["Hours basis", "Gross scheduled hours are calculated from start and finish times."]);
  rows.push(["Break rule", "Breaks are deducted only when explicitly recorded. Unspecified breaks are not treated as zero unpaid break."]);
  values.assumptions.forEach((assumption, index) => rows.push([`Note ${index + 1}`, assumption]));
  rows.forEach(([label, value]) => {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: "4C1D95" } };
    row.eachCell((cell) => { cell.border = border; cell.alignment = { vertical: "top", wrapText: true }; });
  });
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 80;
}

export async function buildRotaWorkbook(data: ProductionRotaDataset, options: RotaExportOptions, exportedBy: string): Promise<Buffer> {
  if (!data.week) throw new Error("No production rota exists for the selected week.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jan Pre-School Staff Rota System";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const { shifts } = addWeeklyRotaSheet(workbook, data, options);
  if (options.format === "detailed") addShiftDetailsSheet(workbook, data, options, shifts);
  if (options.includeWarnings) addWarningsSheet(workbook, data, shifts);
  addExportInformationSheet(workbook, {
    weekStart: data.weekStart,
    status: data.week.status,
    exportedBy,
    title: `Weekly rota export for ${formatDateUk(data.weekStart)}`,
    assumptions: [
      options.includeArchivedOrCancelled ? "Archived or cancelled shifts were requested and may appear." : "Archived and cancelled shifts were excluded.",
      shifts.some((shift) => shift.breakUnspecified) ? "One or more shifts has an unspecified break, so net hours are not asserted for those shifts." : "All included breaks are explicitly recorded.",
    ],
  });
  const metadata = workbook.addWorksheet("_metadata", { state: "veryHidden" });
  metadata.addRow(["staff_id", "shift_id", "rota_week_id"]);
  shifts.forEach((shift) => metadata.addRow([shift.staffId, shift.id, shift.rotaWeekId]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildTemplateWorkbook(
  template: RotaTemplate,
  shifts: RotaTemplateShift[],
  staff: ProductionRotaDataset["staff"],
  options: Pick<RotaExportOptions, "includeWeekends" | "includeBreaks">,
  exportedBy: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jan Pre-School Staff Rota System";
  workbook.created = new Date();
  const days = Array.from({ length: options.includeWeekends ? 7 : 5 }, (_, index) => index + 1);
  const columnsPerDay = options.includeBreaks ? 4 : 3;
  const lastColumn = 1 + days.length * columnsPerDay + 1;
  const sheet = workbook.addWorksheet("Weekly rota");
  addTitle(sheet, "Jan Pre-School and Nursery", `ROTA TEMPLATE | ${template.name}`, lastColumn, "TEMPLATE ONLY: this is not a published rota.");
  const headerRow = 5;
  const weekdayRow = 4;
  sheet.getCell(weekdayRow, 1).value = "Staff member";
  sheet.mergeCells(weekdayRow, 1, headerRow, 1);
  let column = 2;
  days.forEach((day) => {
    sheet.mergeCells(weekdayRow, column, weekdayRow, column + columnsPerDay - 1);
    sheet.getCell(weekdayRow, column).value = format(addDays(new Date(2026, 0, 4), day), "EEEE");
    sheet.getCell(headerRow, column).value = "Start";
    sheet.getCell(headerRow, column + 1).value = "Finish";
    sheet.getCell(headerRow, column + 2).value = "Hours";
    if (options.includeBreaks) sheet.getCell(headerRow, column + 3).value = "Break";
    column += columnsPerDay;
  });
  sheet.getCell(weekdayRow, lastColumn).value = "Weekly gross hours";
  sheet.mergeCells(weekdayRow, lastColumn, headerRow, lastColumn);
  decorateSheet(sheet, headerRow, lastColumn);
  const staffMap = new Map(staff.map((person) => [person.id, person]));
  [...new Set(shifts.map((shift) => shift.staffId))].sort((a, b) => (staffMap.get(a)?.fullName ?? "").localeCompare(staffMap.get(b)?.fullName ?? "")).forEach((staffId, index) => {
    const staffShifts = shifts.filter((shift) => shift.staffId === staffId);
    const row = sheet.addRow([]);
    row.getCell(1).value = staffMap.get(staffId)?.displayName || staffMap.get(staffId)?.fullName || "Unknown staff";
    let cellColumn = 2;
    days.forEach((day) => {
      const dayShifts = staffShifts.filter((shift) => shift.dayOfWeek === day);
      row.getCell(cellColumn).value = dayShifts.toSorted((a, b) => a.startTime.localeCompare(b.startTime)).map((shift) => shift.startTime).join(" / ");
      row.getCell(cellColumn + 1).value = dayShifts.toSorted((a, b) => a.startTime.localeCompare(b.startTime)).map((shift) => shift.endTime).join(" / ");
      row.getCell(cellColumn + 2).value = dayShifts.length
        ? minutesAsExcelDays(dayShifts.reduce((sum, shift) => sum + shiftDurationMinutes(shift.startTime, shift.endTime), 0))
        : null;
      row.getCell(cellColumn + 2).numFmt = "[h]:mm";
      if (options.includeBreaks) {
        row.getCell(cellColumn + 3).value = dayShifts.length
          ? dayShifts.some((shift) => shift.breakMinutes === null) ? "Not specified" : `${dayShifts.reduce((sum, shift) => sum + (shift.breakMinutes ?? 0), 0)} min`
          : "";
      }
      cellColumn += columnsPerDay;
    });
    row.getCell(lastColumn).value = minutesAsExcelDays(staffShifts.reduce((sum, shift) => sum + shiftDurationMinutes(shift.startTime, shift.endTime), 0));
    row.getCell(lastColumn).numFmt = "[h]:mm";
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      if (index % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palePurple } };
    });
  });
  sheet.getColumn(1).width = 24;
  for (let index = 2; index < lastColumn; index += 1) sheet.getColumn(index).width = 12;
  sheet.getColumn(lastColumn).width = 18;
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:5" };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${sheet.rowCount}`;
  addExportInformationSheet(workbook, {
    status: "template",
    exportedBy,
    title: template.name,
    description: template.description,
    assumptions: ["Weekday positions are reusable and do not contain fixed calendar dates."],
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const rotaExcelInternals = {
  timeRange,
  grossMinutes,
  confirmedBreakMinutes,
  minutesAsExcelDays,
};
