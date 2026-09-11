import { differenceInCalendarDays, parseISO } from "date-fns";
import type { StaffRotaShift, StaffRotaWeek } from "@/lib/staff-self-service/server";

export function personalRotaSummary(week: StaffRotaWeek, today: string) {
  const scheduled = [...week.shifts].sort((left, right) => left.shiftDate.localeCompare(right.shiftDate) || left.startTime.localeCompare(right.startTime));
  const upcoming = scheduled.filter((shift) => shift.shiftDate >= today);
  return { today: scheduled.filter((shift) => shift.shiftDate === today), next: upcoming.find((shift) => shift.shiftDate > today) ?? null, upcoming };
}

export function staffAttendanceStatus(day: { missingClockOut: boolean; hasManagerCorrection: boolean }): { label: string; tone: "amber" | "purple" | "green"; explanation: string } {
  if (day.missingClockOut) return { label: "Needs attention", tone: "amber", explanation: "A clock-out is missing. Tell your manager if this needs correcting." };
  if (day.hasManagerCorrection) return { label: "Corrected", tone: "purple", explanation: "This record includes a correction made by your manager." };
  return { label: "Recorded", tone: "green", explanation: "Your completed clock times are recorded." };
}

export function certificateTimingStatus(expiryDate: string | null, today: string): { key: "current" | "due_soon" | "expired" | "no_expiry"; label: string; tone: "green" | "amber" | "red" | "grey" } {
  if (!expiryDate) return { key: "no_expiry", label: "No expiry date", tone: "grey" };
  const days = differenceInCalendarDays(parseISO(expiryDate), parseISO(today));
  if (days < 0) return { key: "expired", label: "Expired", tone: "red" };
  if (days <= 60) return { key: "due_soon", label: "Due soon", tone: "amber" };
  return { key: "current", label: "Current", tone: "green" };
}

export function shiftTimeLabel(shift: Pick<StaffRotaShift, "startTime" | "endTime">) { return `${shift.startTime} to ${shift.endTime}`; }
