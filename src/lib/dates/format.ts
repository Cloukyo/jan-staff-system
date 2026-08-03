import { addDays, format, parseISO, startOfWeek } from "date-fns";

export const TIME_ZONE = "Europe/London";

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
  const formatter = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: TIME_ZONE,
  });
  const offsetAt = (instant: number) => {
    const values = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)) - instant;
  };
  let result = intended - offsetAt(intended);
  result = intended - offsetAt(result);
  return new Date(result);
}

export function londonLocalDateTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Choose a valid London date and time.");
  const [, year, month, day, hour, minute] = match;
  const intended = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
  );
  const formatter = new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", timeZone: TIME_ZONE,
  });
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    return Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    ) - instant;
  };
  let instant = intended - offsetAt(intended);
  instant = intended - offsetAt(instant);
  const localParts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  const roundTrip = `${localParts.year}-${localParts.month}-${localParts.day}T${localParts.hour}:${localParts.minute}`;
  if (roundTrip !== value) {
    throw new RangeError("That London date and time does not exist.");
  }
  return new Date(instant).toISOString();
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
