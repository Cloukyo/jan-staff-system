export type AttendanceTimelineWindow = {
  startMinutes: number;
  endMinutes: number;
  ticks: number[];
};

export type AttendanceTimelineEventPlacement = {
  positionPercent: number;
  row: number;
};

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours * 60) + minutes;
}

export function timestampToLondonMinutes(timestamp: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Europe/London",
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return (Number(parts.hour) * 60) + Number(parts.minute);
}

export function buildAttendanceTimelineWindow({
  plannedPeriods,
  eventTimestamps,
}: {
  plannedPeriods: Array<{ startTime: string; endTime: string }>;
  eventTimestamps: string[];
}): AttendanceTimelineWindow {
  const minutes = [
    ...plannedPeriods.flatMap((period) => [
      timeToMinutes(period.startTime),
      timeToMinutes(period.endTime),
    ]),
    ...eventTimestamps.map(timestampToLondonMinutes),
  ];
  const earliest = minutes.length ? Math.min(...minutes) : 8 * 60;
  const latest = minutes.length ? Math.max(...minutes) : 17 * 60;
  const startMinutes = Math.max(0, Math.floor(earliest / 60) * 60 - 60);
  const roundedLatest = Math.ceil(latest / 60) * 60;
  const endMinutes = Math.min(
    24 * 60,
    Math.max(startMinutes + (4 * 60), roundedLatest + (latest === roundedLatest ? 60 : 0)),
  );
  const ticks: number[] = [];

  for (let minute = startMinutes; minute <= endMinutes; minute += 120) {
    ticks.push(minute);
  }
  const finalTick = ticks.at(-1);
  if (
    finalTick !== endMinutes
    && (finalTick === undefined || endMinutes - finalTick >= 90)
  ) ticks.push(endMinutes);

  return { startMinutes, endMinutes, ticks };
}

export function timelinePositionPercent(
  minutes: number,
  window: AttendanceTimelineWindow,
): number {
  const clamped = Math.min(window.endMinutes, Math.max(window.startMinutes, minutes));
  return ((clamped - window.startMinutes) / (window.endMinutes - window.startMinutes)) * 100;
}

export function layoutAttendanceTimelineEvents(
  timestamps: string[],
  window: AttendanceTimelineWindow,
  estimatedLabelWidthPercent = 32,
): AttendanceTimelineEventPlacement[] {
  const ordered = timestamps
    .map((timestamp, index) => ({
      index,
      timestamp,
      instant: Date.parse(timestamp),
      localMinutes: timestampToLondonMinutes(timestamp),
    }))
    .sort((left, right) => left.instant - right.instant || left.index - right.index);
  const placements: AttendanceTimelineEventPlacement[] = Array.from(
    { length: timestamps.length },
  );
  const finalLabelEndByRow: number[] = [];
  let previousVisualMinutes = Number.NEGATIVE_INFINITY;

  for (const event of ordered) {
    const visualMinutes = event.localMinutes <= previousVisualMinutes
      ? previousVisualMinutes + 1
      : event.localMinutes;
    previousVisualMinutes = visualMinutes;
    const positionPercent = timelinePositionPercent(visualMinutes, window);
    const labelStart = positionPercent < 8
      ? positionPercent
      : positionPercent > 92
        ? positionPercent - estimatedLabelWidthPercent
        : positionPercent - (estimatedLabelWidthPercent / 2);
    const labelEnd = positionPercent < 8
      ? positionPercent + estimatedLabelWidthPercent
      : positionPercent > 92
        ? positionPercent
        : positionPercent + (estimatedLabelWidthPercent / 2);
    let row = finalLabelEndByRow.findIndex(
      (previousLabelEnd) => labelStart - previousLabelEnd >= 2,
    );
    if (row === -1) row = finalLabelEndByRow.length;
    finalLabelEndByRow[row] = labelEnd;
    placements[event.index] = { positionPercent, row };
  }

  return placements;
}
