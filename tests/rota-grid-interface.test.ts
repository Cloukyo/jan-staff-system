import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dayCoverage, groupTemplatePreview, laterWeekDates, previousDayShifts, scheduledMinutes, templateConfirmationLabel } from "@/lib/rota/grid";
import type { ProductionRotaDataset, ProductionRotaShift } from "@/lib/rota/types";
import type { RotaTemplate, TemplateApplicationPreview } from "@/lib/rota/template-types";

const rotaGrid = readFileSync(resolve("src/components/rota/production-rota-grid.tsx"), "utf8");
const rotaActions = readFileSync(resolve("src/lib/rota/actions.ts"), "utf8");
const templateGrid = readFileSync(resolve("src/components/rota/template-week-grid.tsx"), "utf8");
const templatePreview = readFileSync(resolve("src/components/rota/template-rota-controls.tsx"), "utf8");

const shift: ProductionRotaShift = {
  id: "shift-1",
  rotaWeekId: "week-1",
  staffId: "staff-1",
  shiftDate: "2026-06-15",
  startTime: "08:30",
  endTime: "16:30",
  breakMinutes: 30,
  breakUnspecified: false,
  roomOrArea: "Preschool",
  roleOnShift: "Room lead",
  notes: null,
  status: "scheduled",
  inactiveStaffOverrideReason: null,
  leaveOverrideReason: null,
  overlapOverrideReason: null,
  archivedAt: null,
};

const template: RotaTemplate = {
  id: "template-1",
  name: "Standard week",
  description: null,
  status: "active",
  sourceType: "manual",
  createdAt: "2026-06-13T00:00:00Z",
  updatedAt: "2026-06-13T00:00:00Z",
};

function preview(overrides: Partial<TemplateApplicationPreview> = {}): TemplateApplicationPreview {
  return {
    template,
    mode: "empty_days",
    rows: [],
    shiftsToCreate: 0,
    existingShiftsToArchive: 0,
    approvedLeaveConflicts: 0,
    pendingLeaveWarnings: 0,
    inactiveStaff: 0,
    overlappingShifts: 0,
    duplicateShifts: 0,
    missingStaffProfiles: 0,
    expiredCertificateWarnings: 0,
    canApply: true,
    ...overrides,
  };
}

describe("weekly rota grid interface", () => {
  it("provides manager actions for previous-day and multi-day hour copying", () => {
    expect(rotaActions).toContain("export async function copyPreviousDayPatternAction");
    expect(rotaActions).toContain('.rpc("copy_staff_previous_day_pattern"');
    expect(rotaActions).toContain("changed to not working");
    expect(rotaActions).toContain("export async function copyShiftHoursToDaysAction");
    expect(rotaActions).toContain('.rpc("copy_shift_hours_to_days"');
  });

  it("offers accessible previous-day and later-day copy controls in the shift editor", () => {
    expect(rotaGrid).toContain("Copy hours");
    expect(rotaGrid).toContain("Copy previous day");
    expect(rotaGrid).toContain("Copy to other days");
    expect(rotaGrid).toContain('name="targetDates"');
    expect(rotaGrid).toContain("This will replace existing shifts");
    expect(rotaGrid).toContain("min-h-11");
  });

  it("renders staff rows, weekday cells, sticky headers and accessible cell actions", () => {
    expect(rotaGrid).toContain('scope="row"');
    expect(rotaGrid).toContain('scope="col"');
    expect(rotaGrid).toContain("sticky left-0");
    expect(rotaGrid).toContain("sticky top-0");
    expect(rotaGrid).toContain("Add shift for");
    expect(rotaGrid).toContain("Edit shift");
  });

  it("uses a one-day mobile view and hides weekends by default", () => {
    expect(rotaGrid).toContain("const [showWeekend, setShowWeekend] = useState(false)");
    expect(rotaGrid).toContain("const [selectedDay, setSelectedDay] = useState(0)");
    expect(rotaGrid).toContain('aria-label="Previous day"');
    expect(rotaGrid).toContain('aria-label="Next day"');
    expect(rotaGrid).toContain("No shift scheduled");
  });

  it("keeps leave, overlap and unknown-break warnings visible", () => {
    expect(rotaGrid).toContain('aria-label="Approved leave conflict"');
    expect(rotaGrid).toContain('aria-label="Overlapping shift"');
    expect(rotaGrid).toContain('aria-label="Break duration not specified"');
  });

  it("does not silently deduct an unspecified break", () => {
    expect(scheduledMinutes({ ...shift, breakUnspecified: true, breakMinutes: 0 })).toEqual({
      minutes: 480,
      hasUnknownBreak: true,
    });
    expect(scheduledMinutes(shift)).toEqual({ minutes: 450, hasUnknownBreak: false });
  });

  it("calculates daily staffing and hours without legal ratio assumptions", () => {
    const data = {
      weekStart: "2026-06-15",
      week: null,
      shifts: [shift],
      staff: [],
      leave: [],
      settings: {},
    } as unknown as ProductionRotaDataset;
    expect(dayCoverage("2026-06-15", data.shifts, data.leave)).toMatchObject({
      staffCount: 1,
      shiftCount: 1,
      earliestStart: "08:30",
      latestFinish: "16:30",
      minutes: 450,
    });
  });

  it("finds later target days and the previous active working pattern", () => {
    expect(laterWeekDates("2026-06-15", "2026-06-17")).toEqual([
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
    ]);
    expect(previousDayShifts("staff-1", "2026-06-16", [shift])).toEqual([shift]);
    expect(previousDayShifts("staff-1", "2026-06-15", [shift])).toEqual([]);
    expect(previousDayShifts("staff-1", "2026-06-16", [{ ...shift, status: "cancelled" }])).toEqual([]);
  });
});

describe("template weekly grid and grouped preview", () => {
  it("uses the same weekly grid with add, edit, copy pattern and clear-day controls", () => {
    expect(templateGrid).toContain('aria-label="Template weekly grid"');
    expect(templateGrid).toContain("Add template shift");
    expect(templateGrid).toContain("Copy employee pattern");
    expect(templateGrid).toContain("Clear employee day");
    expect(templateGrid).toContain("Inactive staff");
  });

  it("groups repeated identical rows instead of expanding them by default", () => {
    const duplicateRow = {
      templateShiftId: "row-1",
      staffId: "staff-1",
      staffName: "Example Staff",
      shiftDate: "2026-06-15",
      dayOfWeek: 1,
      startTime: "08:30",
      endTime: "16:30",
      outcome: "skip_duplicate" as const,
      warnings: ["Identical shift already exists"],
    };
    const groups = groupTemplatePreview(preview({ rows: [duplicateRow], duplicateShifts: 1 }));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "unchanged", rows: [duplicateRow] });
    expect(templatePreview).toContain('group.key !== "unchanged"');
  });

  it("disables confirmation when a preview creates zero changes", () => {
    const noChanges = preview();
    expect(templateConfirmationLabel(noChanges)).toBe("No changes to apply");
    expect(templatePreview).toContain("submitDisabled={noChanges}");
  });

  it("states replacement and creation totals in the confirmation label", () => {
    expect(templateConfirmationLabel(preview({ shiftsToCreate: 30, existingShiftsToArchive: 12 })))
      .toBe("Replace 12 and create 30 shifts");
  });
});
