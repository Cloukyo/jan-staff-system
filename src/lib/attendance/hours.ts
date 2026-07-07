import { addDays, differenceInMinutes, format, parseISO } from "date-fns";
import { isoDateInLondon } from "@/lib/dates/format";

export type WeekStartDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type AttendanceHoursEvent = {
  staffId: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
};

export type AttendanceHoursSummary = {
  completedMinutes: number;
  hasOpenShift: boolean;
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
  const ordered = events
    .filter((event) => event.staffId === staffId)
    .filter((event) => {
      const eventDate = isoDateInLondon(new Date(event.eventTimestamp));
      return eventDate >= rangeStart && eventDate <= rangeEnd;
    })
    .sort((a, b) => a.eventTimestamp.localeCompare(b.eventTimestamp));

  let completedMinutes = 0;
  let open: Date | null = null;
  for (const event of ordered) {
    if (event.eventType === "clock_in") {
      open = new Date(event.eventTimestamp);
    } else if (open) {
      completedMinutes += Math.max(0, differenceInMinutes(new Date(event.eventTimestamp), open));
      open = null;
    }
  }

  return { completedMinutes, hasOpenShift: open !== null };
}
