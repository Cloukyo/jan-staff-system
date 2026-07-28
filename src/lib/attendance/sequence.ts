import type { AttendanceEventType, EffectiveClockEvent } from "@/lib/attendance/effective-events";

export type AttendanceWarning =
  | "missing_clock_in"
  | "missing_clock_out"
  | "clock_out_before_clock_in"
  | "duplicate_clock_in"
  | "duplicate_clock_out"
  | "events_wrong_order"
  | "no_planned_shift";

export type AttendanceSession = {
  clockIn: EffectiveClockEvent;
  clockOut: EffectiveClockEvent | null;
  minutes: number | null;
};

export type AttendanceDayAnalysis = {
  sessions: AttendanceSession[];
  completedMinutes: number;
  hasOpenShift: boolean;
  warnings: AttendanceWarning[];
  suggestedMissingType: AttendanceEventType;
};

export type AttendanceDayAnalysisInput = {
  events: EffectiveClockEvent[];
  plannedShift?: { start: string; end: string } | null;
};

export type PlannedEventTypeCorrection = {
  targetEventId: string;
  originalEventId: string | null;
  supersedesCorrectionId: string | null;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  recordedDate: string;
};

export type AlternatingEventPlanInput = {
  events: EffectiveClockEvent[];
  selectedEventId: string;
  selectedEventType: AttendanceEventType;
};

function orderEvents(left: EffectiveClockEvent, right: EffectiveClockEvent): number {
  return left.eventTimestamp.localeCompare(right.eventTimestamp) || left.id.localeCompare(right.id);
}

function opposite(type: AttendanceEventType): AttendanceEventType {
  return type === "clock_in" ? "clock_out" : "clock_in";
}

function minutesBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

export function analyseAttendanceDay(input: AttendanceDayAnalysisInput): AttendanceDayAnalysis {
  const events = [...input.events].sort(orderEvents);
  const warnings: AttendanceWarning[] = [];
  const addWarning = (warning: AttendanceWarning) => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  const sessions: AttendanceSession[] = [];
  let expected: AttendanceEventType = "clock_in";
  let openShift: EffectiveClockEvent | null = null;
  let sawClockIn = false;

  for (const event of events) {
    if (event.eventType !== expected) {
      if (event.eventType === "clock_out") {
        if (!sawClockIn) {
          addWarning("missing_clock_in");
          addWarning("clock_out_before_clock_in");
        } else {
          addWarning("duplicate_clock_out");
        }
      } else {
        addWarning("duplicate_clock_in");
      }
      addWarning("events_wrong_order");
      continue;
    }

    if (event.eventType === "clock_in") {
      openShift = event;
      sawClockIn = true;
      expected = "clock_out";
      continue;
    }

    if (openShift) {
      sessions.push({
        clockIn: openShift,
        clockOut: event,
        minutes: minutesBetween(openShift.eventTimestamp, event.eventTimestamp),
      });
    }
    openShift = null;
    expected = "clock_in";
  }

  if (openShift) {
    sessions.push({ clockIn: openShift, clockOut: null, minutes: null });
    addWarning("missing_clock_out");
  }
  if (events.length === 0 && input.plannedShift) addWarning("missing_clock_in");
  if (events.length > 0 && !input.plannedShift) addWarning("no_planned_shift");

  return {
    sessions,
    completedMinutes: sessions.reduce((total, session) => total + (session.minutes ?? 0), 0),
    hasOpenShift: openShift !== null,
    warnings,
    suggestedMissingType: expected,
  };
}

export function planAlternatingEventTypes(input: AlternatingEventPlanInput): PlannedEventTypeCorrection[] {
  const ordered = [...input.events].sort(orderEvents);
  const selectedIndex = ordered.findIndex((event) => event.id === input.selectedEventId);
  if (selectedIndex === -1) return [];

  const selected = ordered[selectedIndex];
  let expected = input.selectedEventType;
  const corrections: PlannedEventTypeCorrection[] = [];
  for (const event of ordered.slice(selectedIndex + 1)) {
    if (event.recordedDate !== selected.recordedDate) continue;
    expected = opposite(expected);
    if (event.eventType === expected) continue;
    corrections.push({
      targetEventId: event.id,
      originalEventId: event.correctionId ? null : event.id,
      supersedesCorrectionId: event.correctionId,
      eventType: expected,
      eventTimestamp: event.eventTimestamp,
      recordedDate: event.recordedDate,
    });
  }
  return corrections;
}
