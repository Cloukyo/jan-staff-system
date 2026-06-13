import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductionRotaDataset } from "@/lib/rota/types";
import type { RotaTemplate, RotaTemplateShift } from "@/lib/rota/template-types";
import { buildTemplateApplicationPreview, templateShiftDate } from "@/lib/rota/template-validation";
import { importedRowIsReady, isIncompleteWorkbookWeek, isWorkbookStaffRow, normaliseWorkbookTime, parseWorkbookShiftPair } from "@/lib/rota/workbook-import";

const template: RotaTemplate = {
  id: "template-1",
  name: "Standard week",
  description: null,
  status: "active",
  sourceType: "manual",
  createdAt: "2026-06-13T00:00:00Z",
  updatedAt: "2026-06-13T00:00:00Z",
};

const templateShift: RotaTemplateShift = {
  id: "template-shift-1",
  templateId: template.id,
  staffId: "staff-1",
  dayOfWeek: 1,
  startTime: "08:30",
  endTime: "16:30",
  breakMinutes: 30,
  roomOrArea: null,
  roleOnShift: null,
  notes: null,
  sortOrder: 0,
  archivedAt: null,
};

const rota: ProductionRotaDataset = {
  weekStart: "2026-06-15",
  week: { id: "week-1", weekStartDate: "2026-06-15", status: "draft", title: null, notes: null, publishedAt: null, archivedAt: null },
  shifts: [],
  staff: [{ id: "staff-1", fullName: "Example Staff", displayName: "Example", employmentRole: "Practitioner", active: true }],
  leave: [],
  settings: {
    openingTime: "07:30", closingTime: "18:30", defaultBreakMinutes: 30, shiftIntervalMinutes: 15,
    availableRooms: [], allowOverlapOverride: true, allowInactiveStaffOverride: false,
  },
};

describe("rota template application preview", () => {
  it("converts weekday positions into dates in the target Monday-based week", () => {
    expect(templateShiftDate("2026-06-15", 1)).toBe("2026-06-15");
    expect(templateShiftDate("2026-06-15", 5)).toBe("2026-06-19");
  });

  it("creates shifts for an empty target week", () => {
    const preview = buildTemplateApplicationPreview({ template, templateShifts: [templateShift], rota, mode: "empty_days" });
    expect(preview.shiftsToCreate).toBe(1);
    expect(preview.canApply).toBe(true);
  });

  it("preserves occupied days in the safest mode", () => {
    const preview = buildTemplateApplicationPreview({
      template,
      templateShifts: [templateShift],
      rota: { ...rota, shifts: [{ id: "existing", rotaWeekId: "week-1", staffId: "other", shiftDate: "2026-06-15", startTime: "09:00", endTime: "15:00", breakMinutes: 0, breakUnspecified: false, roomOrArea: null, roleOnShift: null, notes: null, status: "scheduled", inactiveStaffOverrideReason: null, leaveOverrideReason: null, overlapOverrideReason: null, archivedAt: null }] },
      mode: "empty_days",
    });
    expect(preview.rows[0].outcome).toBe("skip_empty_day");
    expect(preview.shiftsToCreate).toBe(0);
  });

  it("detects duplicates, overlaps, approved leave and inactive staff", () => {
    const existing = { id: "existing", rotaWeekId: "week-1", staffId: "staff-1", shiftDate: "2026-06-15", startTime: "09:00", endTime: "15:00", breakMinutes: 0, breakUnspecified: false, roomOrArea: null, roleOnShift: null, notes: null, status: "scheduled" as const, inactiveStaffOverrideReason: null, leaveOverrideReason: null, overlapOverrideReason: null, archivedAt: null };
    const overlap = buildTemplateApplicationPreview({ template, templateShifts: [templateShift], rota: { ...rota, shifts: [existing] }, mode: "alongside" });
    expect(overlap.overlappingShifts).toBe(1);
    const approved = buildTemplateApplicationPreview({
      template, templateShifts: [templateShift],
      rota: { ...rota, leave: [{ id: "leave", staffId: "staff-1", startDate: "2026-06-15", endDate: "2026-06-15", dayPart: "full_day", startTime: null, endTime: null, status: "approved" }] },
      mode: "alongside",
    });
    expect(approved.approvedLeaveConflicts).toBe(1);
    const inactive = buildTemplateApplicationPreview({ template, templateShifts: [templateShift], rota: { ...rota, staff: [{ ...rota.staff[0], active: false }] }, mode: "alongside" });
    expect(inactive.canApply).toBe(false);
  });
});

describe("rota template migration and permissions", () => {
  const migration = readFileSync(resolve("supabase/migrations/202606130001_rota_templates.sql"), "utf8");
  const applyFix = readFileSync(resolve("supabase/migrations/202606130002_rota_template_apply_lint.sql"), "utf8");
  const actions = readFileSync(resolve("src/lib/rota/template-actions.ts"), "utf8");
  const page = readFileSync(resolve("src/app/rota/templates/page.tsx"), "utf8");

  it("stores weekdays rather than fixed dates and protects manager writes", () => {
    expect(migration).toContain("day_of_week smallint");
    expect(migration).not.toContain("template_shift_date");
    expect(migration).toContain("Managers can manage rota templates");
    expect(migration).toContain("current_staff_role() = 'manager'");
    expect(migration).toContain("revoke all on public.rota_templates");
  });

  it("preserves unspecified imported breaks without treating zero as confirmation", () => {
    const breakMigration = readFileSync(resolve("supabase/migrations/202606130003_unspecified_template_breaks.sql"), "utf8");
    expect(breakMigration).toContain("alter column break_minutes drop not null");
    expect(breakMigration).toContain("break_unspecified boolean not null default false");
    expect(breakMigration).toContain("new.break_unspecified := true");
  });

  it("supports independent save, duplication, archive and transactional idempotent apply", () => {
    expect(migration).toContain("save_rota_week_as_template");
    expect(migration).toContain("duplicate_rota_template");
    expect(migration).toContain("request_key uuid not null unique");
    expect(migration).toContain("source_template_shift_id");
    expect(migration).toContain("Replace mode requires explicit confirmation");
    expect(applyFix).toContain("requested_mode = 'replace'");
    expect(applyFix).not.toContain("create temporary table");
    expect(actions).toContain('formData.get("confirmReplace")');
  });

  it("keeps demo and production templates isolated and requires manager access", () => {
    expect(page).toContain('getAppMode() === "demo"');
    expect(page).toContain('requireAccount(["manager"])');
    expect(page).toContain("loadRotaTemplateManager");
  });
});

describe("private workbook parser safeguards", () => {
  it("ignores sign-in rows and converts Excel serial and text times", () => {
    expect(isWorkbookStaffRow("sign in/out")).toBe(false);
    expect(isWorkbookStaffRow("Areeg")).toBe(true);
    expect(normaliseWorkbookTime(0.5)).toBe("12:00");
    expect(normaliseWorkbookTime("8:30 AM")).toBe("08:30");
  });

  it("flags incomplete pairs and formula errors without inventing shifts", () => {
    expect(parseWorkbookShiftPair("08:30", null).warning).toBe("incomplete_shift");
    expect(parseWorkbookShiftPair("08:30", "16:30", true).warning).toBe("formula_error");
    expect(parseWorkbookShiftPair("08:30", "16:30").shift).toEqual({ startTime: "08:30", endTime: "16:30" });
  });

  it("flags an incomplete fifth week and blocks unresolved name mappings", () => {
    expect(isIncompleteWorkbookWeek([12, 12, 0, 0, 0])).toBe(true);
    expect(importedRowIsReady("unmatched")).toBe(false);
    expect(importedRowIsReady("suggested")).toBe(false);
    expect(importedRowIsReady("confirmed")).toBe(true);
  });
});
