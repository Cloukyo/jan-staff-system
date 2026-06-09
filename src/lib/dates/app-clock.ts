import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import type { NurserySettings } from "@/types";
import { isoDate, weekStart } from "@/lib/dates/format";

export interface AppClock {
  now(): Date;
  today(): string;
  currentWeekStart(): string;
  currentMonthRange(): { start: string; end: string };
}

export function createSystemClock(): AppClock {
  return createDemoClock(isoDate(new Date()));
}

export function createDemoClock(demoToday: string): AppClock {
  return {
    now: () => parseISO(`${demoToday}T12:00:00`),
    today: () => demoToday,
    currentWeekStart: () => isoDate(weekStart(demoToday)),
    currentMonthRange: () => ({
      start: format(startOfMonth(parseISO(demoToday)), "yyyy-MM-dd"),
      end: format(endOfMonth(parseISO(demoToday)), "yyyy-MM-dd"),
    }),
  };
}

export function createAppClock(settings: Pick<NurserySettings, "demoToday">): AppClock {
  return settings.demoToday ? createDemoClock(settings.demoToday) : createSystemClock();
}
