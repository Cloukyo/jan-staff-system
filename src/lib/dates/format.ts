import { addDays, format, parseISO, startOfWeek } from "date-fns";

export const TIME_ZONE = "Europe/London";

const londonDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

function londonDateTimeParts(instant: number) {
  return Object.fromEntries(
    londonDateTimeFormatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
}

function londonOffsetAt(instant: number) {
  const values = londonDateTimeParts(instant);
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  ) - instant;
}

function matchesLondonDateTime(
  instant: number,
  expected: {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    second: string;
  },
): boolean {
  const actual = londonDateTimeParts(instant);
  return actual.year === expected.year
    && actual.month === expected.month
    && actual.day === expected.day
    && actual.hour === expected.hour
    && actual.minute === expected.minute
    && actual.second === expected.second;
}

export function isoDateInLondon(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: TIME_ZONE,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function londonDateStartUtc(date: string): Date {
  const intended = Date.parse(`${date}T00:00:00.000Z`);
  let result = intended - londonOffsetAt(intended);
  result = intended - londonOffsetAt(result);
  return new Date(result);
}

function londonLocalDateTimeCandidates(value: string): {
  recordedDate: string;
  candidates: number[];
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new RangeError("Invalid local date and time.");

  const [, year, month, day, hour, minute, second = "00"] = match;
  const numeric = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
  const intended = Date.UTC(
    numeric.year,
    numeric.month - 1,
    numeric.day,
    numeric.hour,
    numeric.minute,
    numeric.second,
  );
  const intendedDate = new Date(intended);
  if (
    intendedDate.getUTCFullYear() !== numeric.year
    || intendedDate.getUTCMonth() !== numeric.month - 1
    || intendedDate.getUTCDate() !== numeric.day
    || intendedDate.getUTCHours() !== numeric.hour
    || intendedDate.getUTCMinutes() !== numeric.minute
    || intendedDate.getUTCSeconds() !== numeric.second
  ) {
    throw new RangeError("Invalid local date and time.");
  }

  const expected = { year, month, day, hour, minute, second };
  const sampleWindow = 36 * 60 * 60 * 1000;
  const offsets = new Set([
    londonOffsetAt(intended - sampleWindow),
    londonOffsetAt(intended),
    londonOffsetAt(intended + sampleWindow),
  ]);
  const candidates = [...offsets]
    .map((offset) => intended - offset)
    .filter((candidate) => matchesLondonDateTime(candidate, expected))
    .sort((left, right) => left - right);
  if (!candidates.length) {
    throw new RangeError("Invalid local date and time.");
  }

  return {
    recordedDate: `${year}-${month}-${day}`,
    candidates,
  };
}

export function londonLocalDateTimeHasUniqueInstant(value: string): boolean {
  try {
    return londonLocalDateTimeCandidates(value).candidates.length === 1;
  } catch {
    return false;
  }
}

export function londonLocalDateTimeToUtc(value: string): { recordedDate: string; timestamp: Date } {
  const { recordedDate, candidates } = londonLocalDateTimeCandidates(value);
  const selected = candidates.at(-1)!;
  const timestamp = new Date(selected);
  if (isoDateInLondon(timestamp) !== recordedDate) {
    throw new RangeError("Invalid local date and time.");
  }
  return {
    recordedDate,
    timestamp,
  };
}

export function formatDateUk(date: string | Date): string {
  const value = typeof date === "string" ? parseISO(date) : date;
  return format(value, "dd/MM/yyyy");
}

export function formatTimeUk(value: string | Date | null): string {
  if (!value) return "-";
  const date = typeof value === "string" ? parseISO(value) : value;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(date);
}

export function formatMoney(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return "-";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

export function formatHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const h = Math.floor(absolute / 60);
  const m = absolute % 60;
  return `${sign}${h}h ${m.toString().padStart(2, "0")}m`;
}

export function formatDurationCompact(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  const h = Math.floor(absolute / 60);
  const m = absolute % 60;
  if (m === 0) return `${sign}${h} hrs`;
  return `${sign}${h}h ${m.toString().padStart(2, "0")}m`;
}

export function formatDecimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function weekStart(date: Date | string): Date {
  return startOfWeek(typeof date === "string" ? parseISO(date) : date, { weekStartsOn: 1 });
}

export function weekDates(date: Date | string, includeWeekend = false): string[] {
  const start = weekStart(date);
  const count = includeWeekend ? 7 : 5;
  return Array.from({ length: count }, (_, index) => isoDate(addDays(start, index)));
}

export function toDateTime(date: string, time: string): Date {
  return parseISO(`${date}T${time}:00`);
}
