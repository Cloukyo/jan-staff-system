export type AttendanceEventType = "clock_in" | "clock_out";

export type OriginalClockEvent = {
  id: string;
  staffId: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  recordedDate: string;
  source: "kiosk" | "legacy_manager";
};

export type AttendanceCorrectionKind = "add" | "replace" | "exclude";

export type AttendanceCorrection = {
  id: string;
  staffId: string;
  kind: AttendanceCorrectionKind;
  originalEventId: string | null;
  eventType: AttendanceEventType | null;
  eventTimestamp: string | null;
  recordedDate: string;
  supersedesCorrectionId: string | null;
  createdAt: string;
};

export type EffectiveClockEvent = {
  id: string;
  staffId: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  recordedDate: string;
  source: "kiosk" | "legacy_manager" | "manager_correction";
  originalEventId: string | null;
  correctionId: string | null;
};

export type OriginalAttendanceAudit = {
  event: OriginalClockEvent;
  status: "active" | "replaced" | "excluded";
  correctionId: string | null;
};

export type CorrectionAttendanceAudit = {
  correctionId: string;
  correction: AttendanceCorrection;
  status: "active" | "superseded";
};

export type ResolvedAttendanceEvents = {
  effective: EffectiveClockEvent[];
  audit: {
    originals: OriginalAttendanceAudit[];
    corrections: CorrectionAttendanceAudit[];
  };
};

function orderEvents(left: EffectiveClockEvent, right: EffectiveClockEvent): number {
  return Date.parse(left.eventTimestamp) - Date.parse(right.eventTimestamp) || left.id.localeCompare(right.id);
}

function compareCorrectionCreationOrder(left: AttendanceCorrection, right: AttendanceCorrection): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id);
}

function correctionEvent(correction: AttendanceCorrection, originalEventId: string | null): EffectiveClockEvent | null {
  if (correction.kind === "exclude" || !correction.eventType || !correction.eventTimestamp) return null;
  return {
    id: correction.id,
    staffId: correction.staffId,
    eventType: correction.eventType,
    eventTimestamp: correction.eventTimestamp,
    recordedDate: correction.recordedDate,
    source: "manager_correction",
    originalEventId,
    correctionId: correction.id,
  };
}

export function resolveEffectiveEvents(
  events: OriginalClockEvent[],
  corrections: AttendanceCorrection[],
): ResolvedAttendanceEvents {
  const correctionById = new Map(corrections.map((correction) => [correction.id, correction]));
  const supersededIds = new Set(
    corrections.flatMap((correction) => correction.supersedesCorrectionId ? [correction.supersedesCorrectionId] : []),
  );
  const originalForCorrection = (correction: AttendanceCorrection): string | null => {
    const visited = new Set<string>();
    let current: AttendanceCorrection | undefined = correction;
    while (current && !visited.has(current.id)) {
      if (current.originalEventId) return current.originalEventId;
      visited.add(current.id);
      current = current.supersedesCorrectionId
        ? correctionById.get(current.supersedesCorrectionId)
        : undefined;
    }
    return null;
  };
  const rootForCorrection = (correction: AttendanceCorrection): AttendanceCorrection => {
    const visited = new Set<string>();
    let current = correction;
    while (current.supersedesCorrectionId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = correctionById.get(current.supersedesCorrectionId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const chosenLeafByLineage = new Map<string, AttendanceCorrection>();
  for (const correction of corrections.filter((item) => !supersededIds.has(item.id))) {
    const originalEventId = originalForCorrection(correction);
    const lineageKey = originalEventId
      ? `original:${originalEventId}`
      : `correction:${rootForCorrection(correction).id}`;
    const chosen = chosenLeafByLineage.get(lineageKey);
    if (!chosen || compareCorrectionCreationOrder(chosen, correction) < 0) {
      chosenLeafByLineage.set(lineageKey, correction);
    }
  }
  const active = [...chosenLeafByLineage.values()];
  const activeIds = new Set(active.map((correction) => correction.id));
  const activeByOriginalId = new Map<string, AttendanceCorrection[]>();
  for (const correction of active) {
    const originalEventId = originalForCorrection(correction);
    if (!originalEventId) continue;
    const related = activeByOriginalId.get(originalEventId) ?? [];
    related.push(correction);
    activeByOriginalId.set(originalEventId, related);
  }

  const originalAudit = events.map((event) => {
    const related = activeByOriginalId.get(event.id) ?? [];
    const exclusion = related.find((correction) => correction.kind === "exclude");
    const replacement = related.find((correction) => correction.kind === "replace");
    return {
      event,
      status: exclusion ? "excluded" as const : replacement ? "replaced" as const : "active" as const,
      correctionId: exclusion?.id ?? replacement?.id ?? null,
    };
  });

  const effectiveOriginals: EffectiveClockEvent[] = originalAudit
    .filter((item) => item.status === "active")
    .map(({ event }) => ({
      ...event,
      originalEventId: null,
      correctionId: null,
    }));
  const effectiveCorrections = active.flatMap((correction) => {
    const event = correctionEvent(correction, originalForCorrection(correction));
    return event ? [event] : [];
  });

  return {
    effective: [...effectiveOriginals, ...effectiveCorrections].sort(orderEvents),
    audit: {
      originals: originalAudit,
      corrections: corrections.map((correction) => ({
        correctionId: correction.id,
        correction,
        status: activeIds.has(correction.id) ? "active" as const : "superseded" as const,
      })),
    },
  };
}
