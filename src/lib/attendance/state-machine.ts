import type {
  AttendanceAction,
  AttendanceExceptionSummary,
  AttendanceExceptionType,
  AttendanceState,
  AttendanceStateResult,
  AttendanceWarning,
  EffectiveAttendanceEvent,
} from "@/lib/attendance/types";

const DEFAULT_MAXIMUM_SHIFT_MINUTES = 12 * 60;
const unresolvedStatuses = new Set(["open", "under_review"]);

const londonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type DayAnalysis = {
  openEvent: EffectiveAttendanceEvent | null;
  warnings: AttendanceWarning[];
};

export function attendanceOperationalDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Attendance timestamp must be a valid date");
  }

  const parts = londonDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new RangeError("Attendance timestamp could not be mapped to London");
  }

  return `${year}-${month}-${day}`;
}

function compareEvents(
  left: EffectiveAttendanceEvent,
  right: EffectiveAttendanceEvent,
): number {
  return (
    new Date(left.eventTimestamp).getTime() -
      new Date(right.eventTimestamp).getTime() ||
    left.eventOrderKey.localeCompare(right.eventOrderKey) ||
    left.eventId.localeCompare(right.eventId)
  );
}

function warning(
  type: AttendanceExceptionType,
  operationalDate: string,
  eventIds: string[],
): AttendanceWarning {
  return { type, operationalDate, eventIds: [...eventIds].sort() };
}

function analyseDay(
  operationalDate: string,
  events: EffectiveAttendanceEvent[],
): DayAnalysis {
  let openEvent: EffectiveAttendanceEvent | null = null;
  const warnings: AttendanceWarning[] = [];

  for (const current of events) {
    if (current.eventType === "clock_in") {
      if (openEvent) {
        warnings.push(
          warning("consecutive_clock_in", operationalDate, [
            openEvent.eventId,
            current.eventId,
          ]),
        );
      }
      openEvent = current;
      continue;
    }

    if (!openEvent) {
      warnings.push(
        warning("unmatched_clock_out", operationalDate, [current.eventId]),
      );
      continue;
    }

    openEvent = null;
  }

  return { openEvent, warnings };
}

function exceptionWarning(
  issue: AttendanceExceptionSummary,
): AttendanceWarning {
  return {
    type: issue.type,
    operationalDate: issue.operationalDate,
    exceptionId: issue.id,
  };
}

function warningKey(value: AttendanceWarning): string {
  return JSON.stringify([
    value.type,
    value.operationalDate,
    value.exceptionId ?? null,
    value.eventIds ?? [],
  ]);
}

function uniqueWarnings(values: AttendanceWarning[]): AttendanceWarning[] {
  return [...new Map(values.map((value) => [warningKey(value), value])).values()]
    .sort((left, right) => warningKey(left).localeCompare(warningKey(right)));
}

function stateFromCurrentExceptions(
  exceptions: AttendanceExceptionSummary[],
): { state: AttendanceState; allowedActions: AttendanceAction[] } | null {
  if (exceptions.length === 0) {
    return null;
  }

  const types = new Set(exceptions.map((issue) => issue.type));
  if (types.size === 1 && types.has("missing_clock_out")) {
    return { state: "missing_clock_out", allowedActions: ["start_new_shift"] };
  }
  if (
    types.size === 1 &&
    (types.has("missing_clock_in") || types.has("unmatched_clock_out"))
  ) {
    return { state: "missing_clock_in", allowedActions: [] };
  }

  return { state: "awaiting_manager_review", allowedActions: [] };
}

function revisionInput(
  operationalDate: string,
  events: EffectiveAttendanceEvent[],
  exceptions: AttendanceExceptionSummary[],
): string {
  return JSON.stringify({
    version: 1,
    operationalDate,
    events: events
      .map((event) => ({
        eventId: event.eventId,
        eventOrderKey: event.eventOrderKey,
        originalEventId: event.originalEventId,
        correctionId: event.correctionId,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
      }))
      .sort((left, right) => {
        return (
          left.eventOrderKey.localeCompare(right.eventOrderKey) ||
          left.eventId.localeCompare(right.eventId)
        );
      }),
    exceptions: exceptions
      .map((issue) => ({
        id: issue.id,
        operationalDate: issue.operationalDate,
        type: issue.type,
        status: issue.status,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function deriveAttendanceState(input: {
  staffId: string;
  evaluatedAt: string;
  events: EffectiveAttendanceEvent[];
  unresolvedExceptions?: AttendanceExceptionSummary[];
  maximumShiftMinutes?: number;
}): AttendanceStateResult {
  const evaluatedAt = new Date(input.evaluatedAt);
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new RangeError("Attendance evaluation time must be valid");
  }

  const operationalDate = attendanceOperationalDate(evaluatedAt);
  const events = input.events
    .filter((event) => event.staffId === input.staffId)
    .sort(compareEvents);
  const exceptions = (input.unresolvedExceptions ?? [])
    .filter((issue) => issue.staffId === input.staffId)
    .filter((issue) => unresolvedStatuses.has(issue.status))
    .sort((left, right) => left.id.localeCompare(right.id));
  const eventsByDate = new Map<string, EffectiveAttendanceEvent[]>();

  for (const current of events) {
    const date = attendanceOperationalDate(current.eventTimestamp);
    const dayEvents = eventsByDate.get(date) ?? [];
    dayEvents.push(current);
    eventsByDate.set(date, dayEvents);
  }

  const analyses = new Map<string, DayAnalysis>();
  for (const [date, dayEvents] of eventsByDate) {
    analyses.set(date, analyseDay(date, dayEvents));
  }

  const current = analyses.get(operationalDate) ?? {
    openEvent: null,
    warnings: [],
  };
  const currentExceptions = exceptions.filter(
    (issue) => issue.operationalDate === operationalDate,
  );
  const warnings = [
    ...[...analyses.values()].flatMap((analysis) => analysis.warnings),
    ...exceptions.map(exceptionWarning),
  ];
  const maximumShiftMinutes =
    input.maximumShiftMinutes ?? DEFAULT_MAXIMUM_SHIFT_MINUTES;

  if (
    current.openEvent &&
    (evaluatedAt.getTime() -
      new Date(current.openEvent.eventTimestamp).getTime()) /
      60_000 >
      maximumShiftMinutes
  ) {
    warnings.push(
      warning("unusually_long_shift", operationalDate, [
        current.openEvent.eventId,
      ]),
    );
  }

  let state: AttendanceState;
  let allowedActions: AttendanceAction[];

  if (current.warnings.length > 0) {
    const onlyUnmatchedClockOuts = current.warnings.every(
      (item) => item.type === "unmatched_clock_out",
    );
    state =
      onlyUnmatchedClockOuts && !current.openEvent
        ? "missing_clock_in"
        : "awaiting_manager_review";
    allowedActions = [];
  } else if (current.openEvent) {
    state = "clocked_in";
    allowedActions = ["clock_out"];
  } else {
    const exceptionState = stateFromCurrentExceptions(currentExceptions);
    const staleOpenEvent = [...analyses.entries()]
      .filter(([date]) => date < operationalDate)
      .map(([, analysis]) => analysis.openEvent)
      .find((event): event is EffectiveAttendanceEvent => event !== null);

    if (exceptionState) {
      ({ state, allowedActions } = exceptionState);
    } else if (staleOpenEvent) {
      state = "missing_clock_out";
      allowedActions = ["start_new_shift"];
    } else {
      state = "clocked_out";
      allowedActions = ["clock_in"];
    }
  }

  return {
    state,
    operationalDate,
    currentEvent: current.openEvent,
    unresolvedExceptions: exceptions,
    allowedActions,
    warnings: uniqueWarnings(warnings),
    revision: revisionInput(operationalDate, events, exceptions),
    evaluatedAt: input.evaluatedAt,
  };
}
