import { differenceInMinutes, parseISO } from "date-fns";
import type { PayArrangement, PayrollAttendanceReview, PayrollPreparationRow, ProductionClockEvent, ProductionStaffRow } from "@/lib/payroll/types";

export function arrangementsForPeriod(arrangements: PayArrangement[], start: string, end: string): PayArrangement[] {
  return arrangements
    .filter((item) => item.isActive && item.effectiveFrom <= end && (!item.effectiveTo || item.effectiveTo >= start))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}
export function arrangementAt(arrangements: PayArrangement[], date: string): PayArrangement | null {
  return arrangements
    .filter((item) => item.isActive && item.effectiveFrom <= date && (!item.effectiveTo || item.effectiveTo >= date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

export function calculateClockTotals(events: ProductionClockEvent[], maximumShiftMinutes = 12 * 60) {
  const ordered = [...events].sort((a, b) => a.eventTimestamp.localeCompare(b.eventTimestamp));
  const warnings: string[] = [];
  let open: ProductionClockEvent | null = null;
  let recordedMinutes = 0;
  for (const event of ordered) {
    if (event.managerCorrection) warnings.push("Manager correction");
    if (event.eventType === "clock_in") {
      if (open) warnings.push("Overlapping sessions");
      open = event;
      continue;
    }
    if (!open) {
      warnings.push("Clock-out without clock-in");
      continue;
    }
    const minutes = Math.max(0, differenceInMinutes(parseISO(event.eventTimestamp), parseISO(open.eventTimestamp)));
    recordedMinutes += minutes;
    if (minutes > maximumShiftMinutes) warnings.push("Unusually long shift");
    open = null;
  }
  if (open) warnings.push("Missing clock-out");
  return { recordedMinutes, adjustedMinutes: recordedMinutes, warnings: Array.from(new Set(warnings)) };
}

function salaryForPeriod(arrangement: PayArrangement, periodStart: string, periodEnd: string): number | null {
  const days = Math.max(1, differenceInMinutes(parseISO(`${periodEnd}T12:00:00`), parseISO(`${periodStart}T12:00:00`)) / 1440 + 1);
  if (arrangement.annualSalary !== null) return Math.round((arrangement.annualSalary / 365) * days * 100) / 100;
  if (arrangement.monthlySalary !== null) return Math.round(((arrangement.monthlySalary * 12) / 365) * days * 100) / 100;
  return null;
}

export function createPayrollPreparationRow(
  staff: ProductionStaffRow,
  events: ProductionClockEvent[],
  periodStart: string,
  periodEnd: string,
  reviews: PayrollAttendanceReview[] = [],
): PayrollPreparationRow {
  const periodArrangements = arrangementsForPeriod(staff.payArrangements, periodStart, periodEnd);
  const arrangement = arrangementAt(staff.payArrangements, periodEnd);
  const staffEvents = events.filter((event) => event.staffId === staff.id);
  const rawTotals = calculateClockTotals(staffEvents.filter((event) => !event.managerCorrection));
  const adjustedTotals = calculateClockTotals(staffEvents);
  const warnings = [...adjustedTotals.warnings];
  if (!arrangement) warnings.push("Missing active pay arrangement");
  if (periodArrangements.length > 1) warnings.push("Pay arrangement changes within period");
  if (adjustedTotals.recordedMinutes === 0) warnings.push("Zero recorded hours");
  if (arrangement && arrangement.hoursBasis !== "contracted") warnings.push("Contracted hours not tracked");
  const periodDays = Math.max(1, differenceInMinutes(parseISO(`${periodEnd}T12:00:00`), parseISO(`${periodStart}T12:00:00`)) / 1440 + 1);
  const ordinaryLimit = arrangement?.contractedWeeklyHours === null || arrangement?.contractedWeeklyHours === undefined
    ? null
    : Math.round(arrangement.contractedWeeklyHours * 60 * periodDays / 7);
  const ordinaryMinutes = arrangement?.payType === "hourly" && ordinaryLimit !== null
    ? Math.min(adjustedTotals.recordedMinutes, ordinaryLimit)
    : adjustedTotals.recordedMinutes;
  const overtimeMinutes = arrangement?.payType === "hourly" && ordinaryLimit !== null
    ? Math.max(0, adjustedTotals.recordedMinutes - ordinaryLimit)
    : 0;
  const estimatedGross = arrangement?.payType === "hourly" && arrangement.hourlyRate !== null
    ? Math.round(((ordinaryMinutes / 60) * arrangement.hourlyRate + (overtimeMinutes / 60) * arrangement.hourlyRate * arrangement.overtimeMultiplier) * 100) / 100
    : null;
  const workedDates = new Set(staffEvents.map((event) => event.recordedDate));
  const staffReviews = reviews.filter((review) => review.staffId === staff.id && workedDates.has(review.reviewDate));
  const reviewedDates = new Set(staffReviews.map((review) => review.reviewDate));
  const unresolvedDays = [...workedDates].filter((date) => !reviewedDates.has(date)).length;
  if (unresolvedDays > 0) warnings.push("Attendance review incomplete");
  const adjustmentNotes = Array.from(new Set([
    ...staffReviews.map((review) => review.reason).filter((reason): reason is string => Boolean(reason)),
    ...(staffEvents.some((event) => event.managerCorrection) ? ["Manager correction events included"] : []),
  ]));
  return {
    staffId: staff.id,
    fullName: staff.fullName,
    employmentRole: staff.employmentRole,
    payType: arrangement?.payType ?? null,
    contractedWeeklyHours: arrangement?.contractedWeeklyHours ?? null,
    hoursBasis: arrangement?.hoursBasis ?? null,
    recordedMinutes: rawTotals.recordedMinutes,
    adjustedMinutes: adjustedTotals.recordedMinutes,
    ordinaryMinutes,
    overtimeMinutes,
    hourlyRate: arrangement?.hourlyRate ?? null,
    estimatedGross,
    salaryBasis: arrangement?.payType === "salaried" ? salaryForPeriod(arrangement, periodStart, periodEnd) : null,
    workedDays: workedDates.size,
    reviewedDays: reviewedDates.size,
    unresolvedDays,
    reviewStatus: workedDates.size === 0 ? "no_attendance" : unresolvedDays === 0 ? "ready" : "unresolved",
    adjustmentNotes,
    warnings: Array.from(new Set(warnings)),
  };
}
