import { londonLocalDateTimeHasUniqueInstant } from "@/lib/dates/format";

type PlannedPeriod = {
  startTime: string;
  endTime: string;
};

export type PlannedHoursBoundaries = {
  plannedStart: string;
  plannedFinish: string;
};

export type UnusableResetBoundary = {
  kind: "start" | "finish";
  time: string;
};

export function getPlannedHoursBoundaries(
  plannedPeriods: readonly PlannedPeriod[],
): PlannedHoursBoundaries | null {
  if (!plannedPeriods.length) return null;

  return {
    plannedStart: plannedPeriods.reduce((earliest, period) => (
      period.startTime < earliest ? period.startTime : earliest
    ), plannedPeriods[0].startTime),
    plannedFinish: plannedPeriods.reduce((latest, period) => (
      period.endTime > latest ? period.endTime : latest
    ), plannedPeriods[0].endTime),
  };
}

export function getUnusableResetBoundary(
  date: string,
  boundaries: PlannedHoursBoundaries,
): UnusableResetBoundary | null {
  if (!londonLocalDateTimeHasUniqueInstant(`${date}T${boundaries.plannedStart}`)) {
    return { kind: "start", time: boundaries.plannedStart };
  }
  if (!londonLocalDateTimeHasUniqueInstant(`${date}T${boundaries.plannedFinish}`)) {
    return { kind: "finish", time: boundaries.plannedFinish };
  }
  return null;
}
