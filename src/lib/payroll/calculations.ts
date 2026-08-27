import { differenceInMinutes, parseISO } from "date-fns";
import { pairAttendanceByOperationalDay } from "@/lib/attendance/pairing";
import type { PayArrangement, PayrollAttendanceReview, PayrollPreparationArithmetic, PayrollPreparationRow, ProductionClockEvent, ProductionStaffRow } from "@/lib/payroll/types";

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

export function isPayDetailsReady(
  arrangements: PayArrangement[],
  date: string,
): boolean {
  return Boolean(arrangementAt(arrangements, date));
}

export function calculateClockTotals(events: ProductionClockEvent[], maximumShiftMinutes = 12 * 60) {
  const warningLabels = {
    consecutive_clock_in: "Overlapping sessions",
    unmatched_clock_out: "Clock-out without clock-in",
    overlapping_attendance: "Overlapping or malformed attendance",
    unusually_long_shift: "Unusually long shift",
    missing_clock_out: "Missing clock-out",
    missing_clock_in: "Missing clock-in",
    offline_sync_conflict: "Offline synchronisation conflict",
    device_clock_drift: "Device clock difference",
    offline_time_uncertain: "Offline time needs review",
  } as const;
  const pairings = pairAttendanceByOperationalDay(events.map((event) => ({
    eventId: event.id,
    eventOrderKey: event.orderKey ?? `${event.eventTimestamp}:${event.id}`,
    originalEventId: event.managerCorrection ? null : event.id,
    correctionId: event.managerCorrection ? event.id : null,
    staffId: event.staffId,
    eventType: event.eventType,
    eventTimestamp: event.eventTimestamp,
    source: event.managerCorrection ? "manager_correction" : "kiosk",
  })), maximumShiftMinutes);
  const warnings: string[] = pairings.flatMap((day) => (
    day.anomalies.map((type) => warningLabels[type])
  ));
  if (events.some((event) => event.managerCorrection)) warnings.push("Manager correction");
  const recordedMinutes = pairings.reduce((total, day) => total + day.completedMinutes, 0);
  return { recordedMinutes, adjustedMinutes: recordedMinutes, warnings: Array.from(new Set(warnings)) };
}

function salaryForPeriod(arrangement: PayArrangement, periodStart: string, periodEnd: string): number | null {
  const days = Math.max(1, differenceInMinutes(parseISO(`${periodEnd}T12:00:00`), parseISO(`${periodStart}T12:00:00`)) / 1440 + 1);
  if (arrangement.annualSalary !== null) return Math.round((arrangement.annualSalary / 365) * days * 100) / 100;
  if (arrangement.monthlySalary !== null) return Math.round(((arrangement.monthlySalary * 12) / 365) * days * 100) / 100;
  return null;
}

export function calculatePayrollPreparationArithmetic(
  arrangement: PayArrangement | null,
  recordedMinutes: number,
  periodStart: string,
  periodEnd: string,
): PayrollPreparationArithmetic {
  const periodDays = Math.max(1, differenceInMinutes(parseISO(`${periodEnd}T12:00:00`), parseISO(`${periodStart}T12:00:00`)) / 1440 + 1);
  const ordinaryLimit = arrangement?.contractedWeeklyHours === null || arrangement?.contractedWeeklyHours === undefined
    ? null
    : Math.round(arrangement.contractedWeeklyHours * 60 * periodDays / 7);
  const ordinaryMinutes = arrangement?.payType === "hourly" && ordinaryLimit !== null
    ? Math.min(recordedMinutes, ordinaryLimit)
    : recordedMinutes;
  const overtimeMinutes = arrangement?.payType === "hourly" && ordinaryLimit !== null
    ? Math.max(0, recordedMinutes - ordinaryLimit)
    : 0;
  const estimatedGross = arrangement?.payType === "hourly" && arrangement.hourlyRate !== null
    ? Math.round(((ordinaryMinutes / 60) * arrangement.hourlyRate + (overtimeMinutes / 60) * arrangement.hourlyRate * arrangement.overtimeMultiplier) * 100) / 100
    : null;
  return {
    ordinaryMinutes,
    overtimeMinutes,
    estimatedGross,
    salaryBasis: arrangement?.payType === "salaried" ? salaryForPeriod(arrangement, periodStart, periodEnd) : null,
  };
}

export function createPayrollPreparationRow(
  staff: ProductionStaffRow,
  originalEvents: ProductionClockEvent[],
  effectiveEvents: ProductionClockEvent[],
  periodStart: string,
  periodEnd: string,
  reviews: PayrollAttendanceReview[] = [],
): PayrollPreparationRow {
  const periodArrangements = arrangementsForPeriod(staff.payArrangements, periodStart, periodEnd);
  const arrangement = arrangementAt(staff.payArrangements, periodEnd);
  const rawStaffEvents = originalEvents.filter(
    (event) => event.staffId === staff.id && !event.managerCorrection,
  );
  const staffEvents = effectiveEvents.filter((event) => event.staffId === staff.id);
  const rawTotals = calculateClockTotals(rawStaffEvents);
  const effectiveTotals = calculateClockTotals(staffEvents);
  const warnings = [...effectiveTotals.warnings];
  if (!arrangement) warnings.push("Missing active pay arrangement");
  if (periodArrangements.length > 1) warnings.push("Pay arrangement changes within period");
  if (effectiveTotals.recordedMinutes === 0) warnings.push("Zero recorded hours");
  if (arrangement && arrangement.hoursBasis !== "contracted") warnings.push("Contracted hours not tracked");
  const arithmetic = calculatePayrollPreparationArithmetic(
    arrangement,
    effectiveTotals.recordedMinutes,
    periodStart,
    periodEnd,
  );
  const workedDates = new Set([
    ...rawStaffEvents.map((event) => event.recordedDate),
    ...staffEvents.map((event) => event.recordedDate),
  ]);
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
    adjustedMinutes: effectiveTotals.recordedMinutes,
    ordinaryMinutes: arithmetic.ordinaryMinutes,
    overtimeMinutes: arithmetic.overtimeMinutes,
    hourlyRate: arrangement?.hourlyRate ?? null,
    estimatedGross: arithmetic.estimatedGross,
    salaryBasis: arithmetic.salaryBasis,
    workedDays: workedDates.size,
    reviewedDays: reviewedDates.size,
    unresolvedDays,
    reviewStatus: workedDates.size === 0 ? "no_attendance" : unresolvedDays === 0 ? "ready" : "unresolved",
    adjustmentNotes,
    warnings: Array.from(new Set(warnings)),
  };
}
