import {
  addDays,
  differenceInMinutes,
  eachDayOfInterval,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";
import { calculateClockTotals } from "@/lib/payroll/calculations";
import type {
  PayrollAttendanceReview,
  PayrollDailyRow,
  PayrollExportDetail,
  PayrollRotaShift,
  ProductionAttendanceData,
  ProductionClockCorrectionRecord,
  ProductionClockEvent,
  ProductionStaffRow,
} from "@/lib/payroll/types";

export type PayrollExportDetailInput = {
  staff: ProductionStaffRow[];
  shifts: PayrollRotaShift[];
  attendance: ProductionAttendanceData;
  reviews: PayrollAttendanceReview[];
  periodStart: string;
  periodEnd: string;
};

export function plannedShiftMinutes(shift: PayrollRotaShift): number {
  const start = parseISO(`${shift.shiftDate}T${shift.startTime}:00`);
  let end = parseISO(`${shift.shiftDate}T${shift.endTime}:00`);
  if (end <= start) end = addDays(end, 1);
  return Math.max(0, differenceInMinutes(end, start) - shift.breakMinutes);
}

const detailKey = (staffId: string, date: string) => `${staffId}:${date}`;

export function splitPayrollDatesIntoWeeks(dates: string[]): string[][] {
  const weeks: string[][] = [];
  let currentWeekKey: string | null = null;
  for (const date of dates) {
    const weekKey = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
    if (weekKey !== currentWeekKey) {
      weeks.push([date]);
      currentWeekKey = weekKey;
    } else {
      weeks.at(-1)?.push(date);
    }
  }
  return weeks;
}

export function createPayrollExportDetail(input: PayrollExportDetailInput): PayrollExportDetail {
  const dates = eachDayOfInterval({
    start: parseISO(input.periodStart),
    end: parseISO(input.periodEnd),
  }).map((date) => format(date, "yyyy-MM-dd"));
  const shiftsByDay = new Map<string, PayrollRotaShift[]>();
  const effectiveEventsByDay = new Map<string, ProductionClockEvent[]>();
  const originalEventsByDay = new Map<string, ProductionClockEvent[]>();
  const correctionsByDay = new Map<string, ProductionClockCorrectionRecord[]>();
  const reviewsByDay = new Map(
    input.reviews.map((review) => [detailKey(review.staffId, review.reviewDate), review]),
  );

  for (const shift of input.shifts.filter(
    (item) => item.status !== "cancelled" && !item.archivedAt,
  )) {
    const key = detailKey(shift.staffId, shift.shiftDate);
    const group = shiftsByDay.get(key) ?? [];
    group.push(shift);
    shiftsByDay.set(key, group);
  }
  for (const event of input.attendance.effectiveEvents) {
    const key = detailKey(event.staffId, event.recordedDate);
    const group = effectiveEventsByDay.get(key) ?? [];
    group.push(event);
    effectiveEventsByDay.set(key, group);
  }
  for (const event of input.attendance.audit.originalEvents.filter(
    (record) => !record.managerCorrection,
  )) {
    const key = detailKey(event.staffId, event.recordedDate);
    const group = originalEventsByDay.get(key) ?? [];
    group.push(event);
    originalEventsByDay.set(key, group);
  }
  for (const correction of input.attendance.audit.correctionRecords) {
    const key = detailKey(correction.staffId, correction.recordedDate);
    const group = correctionsByDay.get(key) ?? [];
    group.push(correction);
    correctionsByDay.set(key, group);
  }

  const plannedRows = input.staff.map((person) => ({
    staffId: person.id,
    fullName: person.fullName,
    employmentRole: person.employmentRole,
    plannedMinutesByDate: Object.fromEntries(
      dates.map((date) => [
        date,
        (shiftsByDay.get(detailKey(person.id, date)) ?? [])
          .reduce((sum, shift) => sum + plannedShiftMinutes(shift), 0),
      ]),
    ),
  }));

  const dailyRows = input.staff.flatMap<PayrollDailyRow>((person) =>
    dates.flatMap((date) => {
      const key = detailKey(person.id, date);
      const shifts = (shiftsByDay.get(key) ?? [])
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      const effectiveEvents = (effectiveEventsByDay.get(key) ?? [])
        .sort((a, b) => a.eventTimestamp.localeCompare(b.eventTimestamp));
      const originals = (originalEventsByDay.get(key) ?? [])
        .sort((a, b) => a.eventTimestamp.localeCompare(b.eventTimestamp));
      const corrections = (correctionsByDay.get(key) ?? [])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const review = reviewsByDay.get(key);
      if (
        shifts.length === 0
        && effectiveEvents.length === 0
        && originals.length === 0
        && corrections.length === 0
        && !review
      ) return [];

      const raw = calculateClockTotals(originals);
      const adjusted = calculateClockTotals(effectiveEvents);
      const warnings = [...adjusted.warnings];
      if (corrections.length > 0) warnings.push("Manager correction");
      if (effectiveEvents.length > 0 && !review) warnings.push("Attendance review incomplete");

      return [{
        staffId: person.id,
        fullName: person.fullName,
        employmentRole: person.employmentRole,
        date,
        plannedStart: shifts.length ? shifts.map((shift) => shift.startTime).join(", ") : null,
        plannedEnd: shifts.length ? shifts.map((shift) => shift.endTime).join(", ") : null,
        plannedBreakMinutes: shifts.reduce((sum, shift) => sum + shift.breakMinutes, 0),
        plannedMinutes: shifts.reduce((sum, shift) => sum + plannedShiftMinutes(shift), 0),
        originalClockIns: originals
          .filter((event) => event.eventType === "clock_in")
          .map((event) => event.eventTimestamp),
        originalClockOuts: originals
          .filter((event) => event.eventType === "clock_out")
          .map((event) => event.eventTimestamp),
        managerClockIns: corrections
          .filter((correction) => correction.eventType === "clock_in" && correction.eventTimestamp)
          .map((correction) => correction.eventTimestamp!),
        managerClockOuts: corrections
          .filter((correction) => correction.eventType === "clock_out" && correction.eventTimestamp)
          .map((correction) => correction.eventTimestamp!),
        correctionRecords: corrections,
        rawWorkedMinutes: raw.recordedMinutes,
        workedMinutes: adjusted.recordedMinutes,
        reviewStatus: review?.status ?? "not_reviewed",
        reviewReason: review?.reason ?? null,
        warnings: Array.from(new Set(warnings)),
      }];
    }),
  );

  return { dates, plannedRows, dailyRows };
}
