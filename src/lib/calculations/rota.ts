import { differenceInMinutes } from "date-fns";
import type { RotaShift, StaffMember } from "@/types";
import { toDateTime } from "@/lib/dates/format";

export function shiftScheduledMinutes(shift: RotaShift): number {
  if (shift.status !== "working") return shift.creditedMinutes ?? 0;
  if (!shift.scheduledStart || !shift.scheduledEnd) return 0;
  const start = toDateTime(shift.date, shift.scheduledStart);
  let end = toDateTime(shift.date, shift.scheduledEnd);
  if (end < start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return Math.max(0, differenceInMinutes(end, start) - shift.plannedBreakMinutes);
}

export function shiftPayableStatusMinutes(shift?: RotaShift): number {
  if (!shift || shift.status === "working") return 0;
  if (shift.payTreatment !== "paid") return 0;
  return shift.payableMinutes ?? shift.creditedMinutes ?? 0;
}

export function weeklyRotaTotal(staffId: string, shifts: RotaShift[]): number {
  return shifts.filter((shift) => shift.staffId === staffId).reduce((sum, shift) => sum + shiftScheduledMinutes(shift), 0);
}

export function weeklyPaidStatusTotal(staffId: string, shifts: RotaShift[]): number {
  return shifts.filter((shift) => shift.staffId === staffId).reduce((sum, shift) => sum + shiftPayableStatusMinutes(shift), 0);
}

export function rotaWarnings(shift: RotaShift, staff?: StaffMember): string[] {
  const warnings: string[] = [];
  if (shift.status === "working") {
    if (!shift.scheduledStart || !shift.scheduledEnd) warnings.push("Missing shift time");
    if (shift.scheduledStart && shift.scheduledEnd && shift.scheduledEnd <= shift.scheduledStart) warnings.push("Finish is before start");
    if (shiftScheduledMinutes(shift) > 10 * 60) warnings.push("Very long shift");
    if (staff && !staff.active) warnings.push("Inactive staff member");
  }
  if (shift.status !== "working" && shift.payTreatment === "paid" && !shiftPayableStatusMinutes(shift)) warnings.push("Paid status missing duration");
  return warnings;
}
