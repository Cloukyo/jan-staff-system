import type { ProductionRotaShift, RotaLeaveWarning } from "@/lib/rota/types";
import type { TemplateApplicationPreview, TemplatePreviewRow } from "@/lib/rota/template-types";
import { leaveWarningsForShift, overlapWarningsForShift, shiftDurationMinutes } from "@/lib/rota/validation";

export type ScheduledMinutes = {
  minutes: number;
  hasUnknownBreak: boolean;
};

export function scheduledMinutes(
  shift: Pick<ProductionRotaShift, "startTime" | "endTime" | "breakMinutes" | "breakUnspecified" | "status">,
): ScheduledMinutes {
  if (shift.status === "cancelled") return { minutes: 0, hasUnknownBreak: false };
  const duration = shiftDurationMinutes(shift.startTime, shift.endTime);
  return {
    minutes: Math.max(0, duration - (shift.breakUnspecified ? 0 : shift.breakMinutes)),
    hasUnknownBreak: shift.breakUnspecified,
  };
}

export function formatScheduledHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function shiftWarningSummary(
  shift: ProductionRotaShift,
  shifts: ProductionRotaShift[],
  leave: RotaLeaveWarning[],
) {
  const leaveWarnings = leaveWarningsForShift(shift, leave);
  const overlapWarnings = overlapWarningsForShift(shift, shifts);
  return {
    approvedLeave: leaveWarnings.some((warning) => warning.status === "approved"),
    pendingLeave: leaveWarnings.some((warning) => warning.status === "pending"),
    overlap: overlapWarnings.length > 0,
  };
}

export function dayCoverage(date: string, shifts: ProductionRotaShift[], leave: RotaLeaveWarning[]) {
  const active = shifts.filter((shift) => shift.shiftDate === date && shift.status !== "cancelled");
  const starts = active.map((shift) => shift.startTime).sort();
  const finishes = active.map((shift) => shift.endTime).sort();
  const staffIds = new Set(active.map((shift) => shift.staffId));
  const leaveStaff = new Set(
    leave
      .filter((item) => item.status === "approved" && date >= item.startDate && date <= item.endDate)
      .map((item) => item.staffId),
  );
  let minutes = 0;
  let unknownBreaks = 0;
  let conflicts = 0;
  for (const shift of active) {
    const total = scheduledMinutes(shift);
    minutes += total.minutes;
    if (total.hasUnknownBreak) unknownBreaks += 1;
    const warnings = shiftWarningSummary(shift, shifts, leave);
    if (warnings.approvedLeave || warnings.overlap) conflicts += 1;
  }
  return {
    shiftCount: active.length,
    staffCount: staffIds.size,
    earliestStart: starts[0] ?? null,
    latestFinish: finishes.at(-1) ?? null,
    approvedLeaveCount: leaveStaff.size,
    conflicts,
    minutes,
    unknownBreaks,
  };
}

export type PreviewGroup = {
  key: string;
  label: string;
  tone: "green" | "grey" | "amber" | "red";
  rows: TemplatePreviewRow[];
};

export function groupTemplatePreview(preview: TemplateApplicationPreview): PreviewGroup[] {
  const groups: PreviewGroup[] = [
    {
      key: "create",
      label: "Shifts that will be created",
      tone: "green",
      rows: preview.rows.filter((row) => row.outcome === "create"),
    },
    {
      key: "replace",
      label: "Shifts that would replace existing rota entries",
      tone: "red",
      rows: preview.rows.filter((row) => row.outcome === "replace"),
    },
    {
      key: "unchanged",
      label: "Identical or occupied shifts, no action required",
      tone: "grey",
      rows: preview.rows.filter((row) => row.outcome === "skip_duplicate" || row.outcome === "skip_empty_day"),
    },
    {
      key: "warnings",
      label: "Shifts with warnings",
      tone: "amber",
      rows: preview.rows.filter((row) => row.warnings.some((warning) => !warning.includes("Identical shift"))),
    },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

export function templateConfirmationLabel(preview: TemplateApplicationPreview): string {
  if (preview.shiftsToCreate === 0) return "No changes to apply";
  if (preview.existingShiftsToArchive > 0) {
    return `Replace ${preview.existingShiftsToArchive} and create ${preview.shiftsToCreate} shifts`;
  }
  return `Create ${preview.shiftsToCreate} shifts`;
}
