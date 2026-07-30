import { addDays, format, parseISO } from "date-fns";
import { attendanceOperationalDate } from "@/lib/attendance/state-machine";
import { pairAttendanceByOperationalDay } from "@/lib/attendance/pairing";
import type { EffectiveAttendanceEvent } from "@/lib/attendance/types";

export type WeekStartDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AttendanceHoursEvent = {
  staffId: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
};

export type AttendanceHoursSummary = {
  completedMinutes: number;
  hasOpenShift: boolean;
  hasUnresolvedException: boolean;
};

function isoDayOfWeek(date: Date): WeekStartDay {
  const day = date.getDay();
  return (day === 0 ? 7 : day) as WeekStartDay;
}

function dateOnly(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

export function normaliseWeekStartDay(value: number | null | undefined): WeekStartDay {
  return value && value >= 1 && value <= 7 ? (value as WeekStartDay) : 1;
}

export function currentWorkWeekRange(referenceDate: string, weekStartsOn: number | null | undefined = 1): { start: string; end: string } {
  const startDay = normaliseWeekStartDay(weekStartsOn);
  const reference = parseISO(`${referenceDate}T12:00:00`);
  const offset = (isoDayOfWeek(reference) - startDay + 7) % 7;
  const start = addDays(reference, -offset);
  return {
    start: dateOnly(start),
    end: dateOnly(addDays(start, 6)),
  };
}

export function summariseCompletedClockMinutes(
  events: AttendanceHoursEvent[],
  staffId: string,
  rangeStart: string,
  rangeEnd: string,
): AttendanceHoursSummary {
  const effectiveEvents: EffectiveAttendanceEvent[] = events
    .filter((event) => event.staffId === staffId)
    .filter((event) => {
      const eventDate = attendanceOperationalDate(event.eventTimestamp);
      return eventDate >= rangeStart && eventDate <= rangeEnd;
    })
    .map((event, index) => {
      const eventId = `hours:${event.staffId}:${event.eventTimestamp}:${event.eventType}:${index}`;
      return {
        eventId,
        eventOrderKey: `${event.eventTimestamp}:${eventId}`,
        originalEventId: eventId,
        correctionId: null,
        staffId: event.staffId,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        source: "kiosk",
      };
    });
  const days = pairAttendanceByOperationalDay(effectiveEvents);
  const completedMinutes = days.reduce(
    (total, day) => total + day.completedMinutes,
    0,
  );
  const hasOpenShift = days.some((day) =>
    day.anomalies.includes("missing_clock_out"),
  );
  const hasUnresolvedException = days.some(
    (day) => day.anomalies.length > 0,
  );

  return { completedMinutes, hasOpenShift, hasUnresolvedException };
}
