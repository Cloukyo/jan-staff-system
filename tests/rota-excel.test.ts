import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildRotaWorkbook,
  buildTemplateWorkbook,
  parseRotaExportOptions,
  rotaExcelInternals,
  rotaExportFilename,
  templateExportFilename,
} from "@/lib/exports/rota-excel";
import type { ProductionRotaDataset, ProductionRotaShift } from "@/lib/rota/types";
import type { RotaTemplate, RotaTemplateShift } from "@/lib/rota/template-types";

async function openWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  return workbook;
}

function excelDurationMinutes(value: ExcelJS.CellValue): number {
  if (value instanceof Date) return value.getUTCHours() * 60 + value.getUTCMinutes();
  return Math.round(Number(value) * 1440);
}

const baseShift: ProductionRotaShift = {
  id: "shift-1",
  rotaWeekId: "week-1",
  staffId: "staff-1",
  shiftDate: "2026-06-15",
  startTime: "08:00",
  endTime: "12:00",
  breakMinutes: 0,
  breakUnspecified: true,
  roomOrArea: "Preschool",
  roleOnShift: "Practitioner",
  notes: "Morning cover",
  status: "scheduled",
  inactiveStaffOverrideReason: null,
  leaveOverrideReason: null,
  overlapOverrideReason: null,
  archivedAt: null,
};

const rota: ProductionRotaDataset = {
  weekStart: "2026-06-15",
  week: { id: "week-1", weekStartDate: "2026-06-15", status: "draft", title: null, notes: null, publishedAt: null, archivedAt: null },
  shifts: [
    baseShift,
    { ...baseShift, id: "shift-2", startTime: "14:00", endTime: "18:00", roomOrArea: "Garden", notes: null },
    { ...baseShift, id: "cancelled", staffId: "staff-2", status: "cancelled", breakUnspecified: false },
  ],
  staff: [
    { id: "staff-1", fullName: "Example Staff", displayName: "Example", employmentRole: "Practitioner", active: true },
    { id: "staff-2", fullName: "Hidden Cancelled", displayName: "Hidden", employmentRole: "Practitioner", active: true },
  ],
  leave: [{ id: "leave-1", staffId: "staff-1", startDate: "2026-06-15", endDate: "2026-06-15", dayPart: "full_day", startTime: null, endTime: null, status: "pending" }],
  settings: {
    openingTime: "07:30", closingTime: "18:30", defaultBreakMinutes: 30, shiftIntervalMinutes: 15,
    availableRooms: [], allowOverlapOverride: true, allowInactiveStaffOverride: false,
  },
};

const detailedOptions = {
  format: "detailed" as const,
  includeWeekends: false,
  includeBreaks: true,
  includeRooms: true,
  includeRoles: true,
  includeWarnings: true,
  includeArchivedOrCancelled: false,
};

describe("production rota Excel export", () => {
  it("parses safe defaults and generates the expected filename", () => {
    expect(parseRotaExportOptions(new URLSearchParams())).toEqual({
      format: "compact",
      includeWeekends: false,
      includeBreaks: false,
      includeRooms: false,
      includeRoles: false,
      includeWarnings: false,
      includeArchivedOrCancelled: false,
    });
    expect(rotaExportFilename("2026-06-15")).toBe("Jan-Preschool-Rota-2026-06-15.xlsx");
  });

  it("opens successfully with compact, detail, warnings and information sheets", async () => {
    const buffer = await buildRotaWorkbook(rota, detailedOptions, "Manager Example");
    const workbook = await openWorkbook(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Weekly rota", "Shift details", "Warnings", "Export information", "_metadata"]);
    expect(workbook.getWorksheet("_metadata")?.state).toBe("veryHidden");
  });

  it("preserves multiple shifts, uses Monday-to-Friday columns and does not deduct unspecified breaks", async () => {
    const buffer = await buildRotaWorkbook(rota, detailedOptions, "Manager Example");
    const workbook = await openWorkbook(buffer);
    const weekly = workbook.getWorksheet("Weekly rota");
    expect(weekly?.getCell("B5").value).toBe("Start");
    expect(weekly?.getCell("C5").value).toBe("Finish");
    expect(weekly?.getCell("D5").value).toBe("Hours");
    expect(weekly?.getCell("E5").value).toBe("Break");
    expect(weekly?.getCell("B6").value).toBe("08:00 / 14:00");
    expect(weekly?.getCell("C6").value).toBe("12:00 / 18:00");
    expect(excelDurationMinutes(weekly?.getCell("D6").value ?? null)).toBe(480);
    expect(weekly?.getCell("E6").value).toBe("Not specified");
    expect(excelDurationMinutes(weekly?.getCell("V6").value ?? null)).toBe(480);
    expect(JSON.stringify(weekly?.getCell("B6").note)).toContain("Room: Preschool");
    expect(weekly?.rowCount).toBe(6);
    expect(rotaExcelInternals.confirmedBreakMinutes(rota.shifts.slice(0, 2))).toBeNull();
  });

  it("shows draft status and excludes cancelled shifts by default", async () => {
    const buffer = await buildRotaWorkbook(rota, detailedOptions, "Manager Example");
    const workbook = await openWorkbook(buffer);
    expect(String(workbook.getWorksheet("Weekly rota")?.getCell("A3").value)).toContain("DRAFT ROTA");
    const details = workbook.getWorksheet("Shift details");
    expect(details?.rowCount).toBe(6);
    const values = workbook.worksheets.flatMap((sheet) => sheet.getSheetValues()).join(" ");
    expect(values).not.toContain("Hidden Cancelled");
    expect(values.toLowerCase()).not.toContain("salary");
    expect(values.toLowerCase()).not.toContain("dbs");
  });
});

describe("rota template Excel export", () => {
  const template: RotaTemplate = {
    id: "template-1", name: "Standard Weekly Rota", description: "Reusable pattern", status: "active",
    sourceType: "private_import", createdAt: "2026-06-13T00:00:00Z", updatedAt: "2026-06-13T00:00:00Z",
  };
  const shifts: RotaTemplateShift[] = [{
    id: "template-shift-1", templateId: template.id, staffId: "staff-1", dayOfWeek: 1,
    startTime: "08:30", endTime: "16:30", breakMinutes: null, roomOrArea: null, roleOnShift: null,
    notes: null, sortOrder: 1, archivedAt: null,
  }];

  it("exports weekday positions and labels the workbook as a template", async () => {
    const buffer = await buildTemplateWorkbook(template, shifts, rota.staff, { includeWeekends: false, includeBreaks: true }, "Manager Example");
    const workbook = await openWorkbook(buffer);
    expect(workbook.getWorksheet("Weekly rota")?.getCell("A3").value).toContain("TEMPLATE ONLY");
    expect(workbook.getWorksheet("Weekly rota")?.getCell("B4").value).toBe("Monday");
    expect(workbook.getWorksheet("Weekly rota")?.getCell("E6").value).toBe("Not specified");
    expect(templateExportFilename(template.name)).toBe("Jan-Preschool-Rota-Template-Standard-Weekly-Rota.xlsx");
  });
});

describe("Excel export permissions and data source", () => {
  it("requires manager access and production repositories in both routes", () => {
    const rotaRoute = readFileSync(resolve("src/app/rota/export/route.ts"), "utf8");
    const templateRoute = readFileSync(resolve("src/app/rota/templates/export/route.ts"), "utf8");
    for (const route of [rotaRoute, templateRoute]) {
      expect(route).toContain('getAppMode() !== "production"');
      expect(route).toContain('requireAccount(["manager"])');
      expect(route).not.toContain("localStorage");
      expect(route).not.toContain("demo-data");
    }
    expect(rotaRoute).toContain("loadProductionRotaForExport");
    expect(templateRoute).toContain("loadRotaTemplateManager");
  });
});
