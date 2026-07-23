import { addDays, differenceInMinutes, eachDayOfInterval, format, parseISO } from "date-fns";
import { calculateClockTotals } from "@/lib/payroll/calculations";
import type {
  PayrollAttendanceReview,
  PayrollExportDetail,
  PayrollRotaShift,
  ProductionClockEvent,
  ProductionStaffRow,
} from "@/lib/payroll/types";

export type PayrollExportDetailInput = {
  staff: ProductionStaffRow[];
  shifts: PayrollRotaShift[];
  events: ProductionClockEvent[];
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

export function createPayrollExportDetail(input: PayrollExportDetailInput): PayrollExportDetail {
  const dates = eachDayOfInterval({
    start: parseISO(input.periodStart),
    end: parseISO(input.periodEnd),
  }).map((date) => format(date, "yyyy-MM-dd"));
  const shiftsByDay = new Map<string, PayrollRotaShift[]>();
  const eventsByDay = new Map<string, ProductionClockEvent[]>();
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
  for (const event of input.events) {
    const key = detailKey(event.staffId, event.recordedDate);
    const group = eventsByDay.get(key) ?? [];
    group.push(event);
    eventsByDay.set(key, group);
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

  const dailyRows = input.staff.flatMap((person) =>
    dates.flatMap((date) => {
      const key = detailKey(person.id, date);
      const shifts = (shiftsByDay.get(key) ?? [])
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      const events = (eventsByDay.get(key) ?? [])
        .sort((a, b) => a.eventTimestamp.localeCompare(b.eventTimestamp));
      const review = reviewsByDay.get(key);
      if (shifts.length === 0 && events.length === 0 && !review) return [];

      const originals = events.filter((event) => !event.managerCorrection);
      const corrections = events.filter((event) => event.managerCorrection);
      const raw = calculateClockTotals(originals);
      const adjusted = calculateClockTotals(events);
      const warnings = [...adjusted.warnings];
      if (events.length > 0 && !review) warnings.push("Attendance review incomplete");

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
          .filter((event) => event.eventType === "clock_in")
          .map((event) => event.eventTimestamp),
        managerClockOuts: corrections
          .filter((event) => event.eventType === "clock_out")
          .map((event) => event.eventTimestamp),
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
