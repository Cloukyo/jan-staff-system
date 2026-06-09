import { addDays, format, parseISO, startOfWeek } from "date-fns";

export const TIME_ZONE = "Europe/London";

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
