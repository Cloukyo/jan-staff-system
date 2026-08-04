import { attendanceOperationalDate } from "@/lib/attendance/state-machine";
import type {
  AttendanceExceptionType,
  EffectiveAttendanceEvent,
} from "@/lib/attendance/types";

const DEFAULT_MAXIMUM_SHIFT_MINUTES = 12 * 60;

export type AttendanceDayPairing = {
  staffId: string;
  operationalDate: string;
  completedMinutes: number;
  pairs: Array<{
    clockInId: string;
    clockOutId: string;
    minutes: number;
  }>;
  anomalies: AttendanceExceptionType[];
};

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

function addAnomaly(
  anomalies: AttendanceExceptionType[],
  type: AttendanceExceptionType,
): void {
  if (!anomalies.includes(type)) {
    anomalies.push(type);
  }
}

function pairDay(
  staffId: string,
  operationalDate: string,
  events: EffectiveAttendanceEvent[],
  maximumShiftMinutes: number,
): AttendanceDayPairing {
  const pairs: AttendanceDayPairing["pairs"] = [];
  const anomalies: AttendanceExceptionType[] = [];
  let openEvent: EffectiveAttendanceEvent | null = null;
  let ambiguousOpenSequence = false;

  for (const current of events.sort(compareEvents)) {
    if (current.eventType === "clock_in") {
      if (openEvent || ambiguousOpenSequence) {
        addAnomaly(anomalies, "consecutive_clock_in");
        openEvent = null;
        ambiguousOpenSequence = true;
      } else {
        openEvent = current;
      }
      continue;
    }

    if (ambiguousOpenSequence) {
      ambiguousOpenSequence = false;
      continue;
    }

    if (!openEvent) {
      addAnomaly(anomalies, "unmatched_clock_out");
      continue;
    }

    const elapsedMilliseconds =
      new Date(current.eventTimestamp).getTime() -
      new Date(openEvent.eventTimestamp).getTime();
    const minutes = Math.floor(elapsedMilliseconds / 60_000);
    if (minutes < 0) {
      addAnomaly(anomalies, "overlapping_attendance");
      openEvent = null;
      continue;
    }

    pairs.push({
      clockInId: openEvent.eventId,
      clockOutId: current.eventId,
      minutes,
    });
    if (minutes > maximumShiftMinutes) {
      addAnomaly(anomalies, "unusually_long_shift");
    }
    openEvent = null;
  }

  if (openEvent || ambiguousOpenSequence) {
    addAnomaly(anomalies, "missing_clock_out");
  }

  return {
    staffId,
    operationalDate,
    completedMinutes: pairs.reduce((total, pair) => total + pair.minutes, 0),
    pairs,
    anomalies,
  };
}

export function pairAttendanceByOperationalDay(
  events: EffectiveAttendanceEvent[],
  maximumShiftMinutes = DEFAULT_MAXIMUM_SHIFT_MINUTES,
): AttendanceDayPairing[] {
  const partitions = new Map<string, EffectiveAttendanceEvent[]>();

  for (const event of events) {
    const operationalDate = attendanceOperationalDate(event.eventTimestamp);
    const key = `${event.staffId}\u0000${operationalDate}`;
    const partition = partitions.get(key) ?? [];
    partition.push(event);
    partitions.set(key, partition);
  }

  return [...partitions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, partition]) => {
      const [staffId, operationalDate] = key.split("\u0000");
      return pairDay(
        staffId,
        operationalDate,
        partition,
        maximumShiftMinutes,
      );
    });
}
