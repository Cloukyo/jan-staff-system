import {
  effectiveEventOrderKey,
  type AttendanceEventType,
  type EffectiveClockEvent,
} from "@/lib/attendance/effective-events";
import {
  planAlternatingEventTypes,
  type PlannedEventTypeCorrection,
} from "@/lib/attendance/sequence";

export type ManualCorrectionPlanInput = {
  events: EffectiveClockEvent[];
  selectedEventId: string | null;
  staffId: string;
  recordedDate: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  proposedCorrectionId?: string;
};

export function planManualCorrectionConsequences(
  input: ManualCorrectionPlanInput,
): PlannedEventTypeCorrection[] {
  const selected = input.selectedEventId
    ? input.events.find((event) => (
      event.id === input.selectedEventId
      || event.originalEventId === input.selectedEventId
    ))
    : null;
  const primary: EffectiveClockEvent | null = selected
    ? {
        ...selected,
        id: input.proposedCorrectionId ?? selected.id,
        orderKey: effectiveEventOrderKey(selected),
        eventType: input.eventType,
        eventTimestamp: input.eventTimestamp,
        recordedDate: input.recordedDate,
      }
    : input.proposedCorrectionId ? {
        id: input.proposedCorrectionId,
        orderKey: `${input.proposedCorrectionId}:correction`,
        staffId: input.staffId,
        eventType: input.eventType,
        eventTimestamp: input.eventTimestamp,
        recordedDate: input.recordedDate,
        source: "manager_correction",
        originalEventId: null,
        correctionId: null,
      } : null;
  if (!primary) return [];
  const events = selected
    ? input.events.map((event) => event.id === selected.id ? primary : event)
    : [...input.events, primary];

  return planAlternatingEventTypes({
    events,
    selectedEventId: primary.id,
    selectedEventType: input.eventType,
  });
}
