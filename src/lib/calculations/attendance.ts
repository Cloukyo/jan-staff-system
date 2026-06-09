import { differenceInMinutes, parseISO } from "date-fns";
import type { AttendanceAdjustment, AttendanceApproval, AttendanceDay, ClockEvent, NurserySettings, RotaShift } from "@/types";
import { shiftPayableStatusMinutes, shiftScheduledMinutes } from "@/lib/calculations/rota";
import { toDateTime } from "@/lib/dates/format";

const priority = { clock_in: 1, break_start: 2, break_end: 3, clock_out: 4 };

export function calculateAttendanceDay(
  staffId: string,
  date: string,
  events: ClockEvent[],
  shift: RotaShift | undefined,
  adjustment: AttendanceAdjustment | undefined,
  approval: AttendanceApproval | undefined,
  settings: NurserySettings,
): AttendanceDay {
  const ordered = events
    .filter((event) => event.staffId === staffId && event.timestamp.slice(0, 10) === date)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || priority[a.type] - priority[b.type]);

  const flags: string[] = [];
  let firstClockIn: string | null = null;
  let finalClockOut: string | null = null;
  let lastType: string | null = null;
  let breakStart: string | null = null;
  let breakMinutes = 0;

  for (const event of ordered) {
    if (event.type === lastType) flags.push(`Duplicate ${event.type.replace("_", " ")}`);
    if (event.type === "clock_in") {
      if (firstClockIn) flags.push("Multiple clock-ins");
      firstClockIn ??= event.timestamp;
    }
    if (event.type === "break_start") {
      if (!firstClockIn) flags.push("Break before clock-in");
      if (breakStart) flags.push("Duplicate break start");
      breakStart = event.timestamp;
    }
    if (event.type === "break_end") {
      if (!breakStart) flags.push("Break end without break start");
      if (breakStart) {
        breakMinutes += Math.max(0, differenceInMinutes(parseISO(event.timestamp), parseISO(breakStart)));
        breakStart = null;
      }
    }
    if (event.type === "clock_out") {
      if (!firstClockIn) flags.push("Clock-out without clock-in");
      finalClockOut = event.timestamp;
    }
    lastType = event.type;
  }

  if (breakStart) flags.push("Missing break end");

  const scheduledMinutes = shift ? shiftScheduledMinutes(shift) : 0;
  const payableStatusMinutes = shiftPayableStatusMinutes(shift);
  const creditedPaidMinutes = payableStatusMinutes;
  let recordedMinutes = 0;
  if (firstClockIn && finalClockOut) {
    let raw = differenceInMinutes(parseISO(finalClockOut), parseISO(firstClockIn));
    if (raw < 0) raw += 24 * 60;
    recordedMinutes = Math.max(0, raw - breakMinutes);
  }

  if (shift?.status === "working" && !firstClockIn) flags.push("No clock-in for scheduled working day");
  if (firstClockIn && !finalClockOut) flags.push("Missing clock-out");
  if (!shift || shift.status !== "working") {
    if (firstClockIn) flags.push("Unscheduled attendance");
  }
  if (firstClockIn && shift?.scheduledStart) {
    const lateBy = differenceInMinutes(parseISO(firstClockIn), toDateTime(date, shift.scheduledStart));
    if (lateBy > settings.lateArrivalThresholdMinutes) flags.push("Late arrival");
  }
  if (finalClockOut && shift?.scheduledEnd) {
    const earlyBy = differenceInMinutes(toDateTime(date, shift.scheduledEnd), parseISO(finalClockOut));
    if (earlyBy > 0) flags.push("Early departure");
  }
  if (scheduledMinutes > 0 && recordedMinutes - scheduledMinutes > settings.overtimeWarningThresholdMinutes) flags.push("Overtime");
  if (recordedMinutes > settings.maximumShiftMinutes) flags.push("Shift exceeds safety threshold");
  if (adjustment && adjustment.approvedMinutes !== adjustment.originalRecordedMinutes) flags.push("Approved differs from recorded");

  if (shift?.status !== "working" && shift?.payTreatment === "paid" && !payableStatusMinutes) flags.push("Paid status missing duration");

  const clean = flags.length === 0 && (recordedMinutes > 0 || payableStatusMinutes > 0);
  const approvedPayableMinutes = adjustment?.approvedMinutes ?? approval?.approvedMinutes ?? 0;
  const provisionalPayableMinutes = clean && !adjustment && !approval ? recordedMinutes + payableStatusMinutes : 0;

  return {
    staffId,
    date,
    scheduledMinutes,
    creditedPaidMinutes,
    payableStatusMinutes,
    recordedMinutes,
    approvedPayableMinutes,
    provisionalPayableMinutes,
    firstClockIn,
    finalClockOut,
    breakMinutes,
    exceptionFlags: Array.from(new Set(flags)),
    approvalStatus: adjustment || approval ? "approved" : flags.length ? "needs_review" : "draft",
    managerNote: adjustment?.managerNote ?? "",
    adjustmentReason: adjustment?.reason,
    events: ordered,
    shift,
  };
}

export const seriousExceptionLabels = [
  "No clock-in for scheduled working day",
  "Missing clock-out",
  "Break before clock-in",
  "Break end without break start",
  "Missing break end",
  "Clock-out without clock-in",
  "Unscheduled attendance",
  "Shift exceeds safety threshold",
  "Paid status missing duration",
];

export function hasSeriousException(day: Pick<AttendanceDay, "exceptionFlags">): boolean {
  return day.exceptionFlags.some((flag) => seriousExceptionLabels.some((serious) => flag.includes(serious)));
}

export function isCleanApprovalCandidate(day: AttendanceDay): boolean {
  return (
    day.approvalStatus !== "approved" &&
    !hasSeriousException(day) &&
    day.recordedMinutes > 0 &&
    Boolean(day.firstClockIn) &&
    Boolean(day.finalClockOut) &&
    !day.adjustmentReason
  );
}
