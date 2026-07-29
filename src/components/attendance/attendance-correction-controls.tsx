"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { CircleMinus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClassName } from "@/components/ui/primitives";
import type { CorrectionActionResult } from "@/lib/attendance/correction-actions";
import {
  compareEffectiveEvents,
  type AttendanceEventType,
  type EffectiveClockEvent,
} from "@/lib/attendance/effective-events";
import { planManualCorrectionConsequences } from "@/lib/attendance/manual-correction-plan";
import { buildAttendanceDayReturnTo } from "@/lib/attendance/day-route";
import { formatTimeUk, londonLocalDateTimeToUtc } from "@/lib/dates/format";
import type { StaffHoursDay } from "@/lib/attendance/staff-hours";

const initialState: CorrectionActionResult = { ok: false, code: "idle", message: "" };
const eventTypes: AttendanceEventType[] = ["clock_in", "clock_out"];

type TypeChangePreview = {
  targetEventId: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
};

type PlannedHoursChangePreview = TypeChangePreview & {
  originalEventType: AttendanceEventType;
  originalEventTimestamp: string;
};

type PlannedHoursPreview = {
  plannedStart: string;
  plannedFinish: string;
  changes: PlannedHoursChangePreview[];
  additions: Array<{ eventType: AttendanceEventType; eventTimestamp: string }>;
  canApply: boolean;
};

type ResetPlannedHoursPreview = {
  plannedStart: string;
  plannedFinish: string;
  effectiveEvents: EffectiveClockEvent[];
};

function eventLabel(eventType: AttendanceEventType): string {
  return eventType === "clock_in" ? "Clock in" : "Clock out";
}

function localDateTimeValue(timestamp: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/London",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function plannedTimestamp(date: string, time: string): string {
  return londonLocalDateTimeToUtc(`${date}T${time}`).timestamp.toISOString();
}

function orderedEvents(events: EffectiveClockEvent[]): EffectiveClockEvent[] {
  return [...events].sort(compareEffectiveEvents);
}

export { buildAttendanceDayReturnTo };

export function previewManualCorrectionChanges({
  events,
  selectedEventId,
  selectedEventType,
  localDateTime,
  staffId,
  proposedCorrectionId,
}: {
  events: EffectiveClockEvent[];
  selectedEventId: string | null;
  selectedEventType: AttendanceEventType;
  localDateTime?: string;
  staffId?: string;
  proposedCorrectionId?: string;
}): TypeChangePreview[] {
  if (!selectedEventId && (!localDateTime || !staffId)) return [];
  let eventTimestamp: string;
  try {
    eventTimestamp = localDateTime
      ? londonLocalDateTimeToUtc(localDateTime).timestamp.toISOString()
      : events.find((event) => event.id === selectedEventId || event.originalEventId === selectedEventId)?.eventTimestamp ?? "";
  } catch {
    return [];
  }
  if (!eventTimestamp) return [];
  return planManualCorrectionConsequences({
    events,
    selectedEventId,
    staffId: staffId ?? events.find((event) => event.id === selectedEventId || event.originalEventId === selectedEventId)?.staffId ?? "",
    recordedDate: localDateTime?.slice(0, 10) ?? events.find((event) => event.id === selectedEventId || event.originalEventId === selectedEventId)?.recordedDate ?? "",
    eventType: selectedEventType,
    eventTimestamp,
    proposedCorrectionId,
  }).map((change) => ({
    targetEventId: change.targetEventId,
    eventType: change.eventType,
    eventTimestamp: change.eventTimestamp,
  }));
}

export function previewPlannedHoursChanges({
  date,
  plannedPeriods,
  effectiveEvents: events,
}: Pick<StaffHoursDay, "date" | "plannedPeriods" | "effectiveEvents">): PlannedHoursPreview | null {
  if (!plannedPeriods.length) return null;
  const plannedStart = plannedPeriods.reduce((earliest, period) => (
    period.startTime < earliest ? period.startTime : earliest
  ), plannedPeriods[0].startTime);
  const plannedFinish = plannedPeriods.reduce((latest, period) => (
    period.endTime > latest ? period.endTime : latest
  ), plannedPeriods[0].endTime);
  const startAt = plannedTimestamp(date, plannedStart);
  const finishAt = plannedTimestamp(date, plannedFinish);
  const startEpoch = Date.parse(startAt);
  const finishEpoch = Date.parse(finishAt);
  const ordered = orderedEvents(events);
  const left = ordered.filter((event) => Date.parse(event.eventTimestamp) <= startEpoch);
  const intermediate = ordered.filter((event) => {
    const eventEpoch = Date.parse(event.eventTimestamp);
    return eventEpoch > startEpoch && eventEpoch < finishEpoch;
  });
  const right = ordered.filter((event) => Date.parse(event.eventTimestamp) >= finishEpoch);
  const canApply = left.length <= 1 && right.length <= 1 && intermediate.length % 2 === 0;
  const changes: PlannedHoursChangePreview[] = [];
  const additions: PlannedHoursPreview["additions"] = [];

  if (!canApply) return { plannedStart, plannedFinish, changes, additions, canApply };
  if (!left.length) additions.push({ eventType: "clock_in", eventTimestamp: startAt });
  else if (left[0].eventType !== "clock_in" || Date.parse(left[0].eventTimestamp) !== startEpoch) {
    changes.push({
      targetEventId: left[0].id,
      originalEventType: left[0].eventType,
      eventType: "clock_in",
      originalEventTimestamp: left[0].eventTimestamp,
      eventTimestamp: startAt,
    });
  }

  intermediate.forEach((event, index) => {
    const eventType: AttendanceEventType = index % 2 === 0 ? "clock_out" : "clock_in";
    if (event.eventType !== eventType) changes.push({
      targetEventId: event.id,
      originalEventType: event.eventType,
      eventType,
      originalEventTimestamp: event.eventTimestamp,
      eventTimestamp: event.eventTimestamp,
    });
  });

  if (!right.length) additions.push({ eventType: "clock_out", eventTimestamp: finishAt });
  else if (right[0].eventType !== "clock_out" || Date.parse(right[0].eventTimestamp) !== finishEpoch) {
    changes.push({
      targetEventId: right[0].id,
      originalEventType: right[0].eventType,
      eventType: "clock_out",
      originalEventTimestamp: right[0].eventTimestamp,
      eventTimestamp: finishAt,
    });
  }

  return { plannedStart, plannedFinish, changes, additions, canApply };
}

export function previewResetToPlannedHours({
  plannedPeriods,
  effectiveEvents,
}: Pick<StaffHoursDay, "date" | "plannedPeriods" | "effectiveEvents">): ResetPlannedHoursPreview | null {
  if (!plannedPeriods.length) return null;
  const plannedStart = plannedPeriods.reduce((earliest, period) => (
    period.startTime < earliest ? period.startTime : earliest
  ), plannedPeriods[0].startTime);
  const plannedFinish = plannedPeriods.reduce((latest, period) => (
    period.endTime > latest ? period.endTime : latest
  ), plannedPeriods[0].endTime);

  return {
    plannedStart,
    plannedFinish,
    effectiveEvents: orderedEvents(effectiveEvents),
  };
}

export type CorrectionFormAction = (
  state: CorrectionActionResult,
  formData: FormData,
) => Promise<CorrectionActionResult>;

function ActionFeedback({ state }: { state: CorrectionActionResult }) {
  if (!state.message) return null;
  return <p className={`mt-3 text-sm font-bold ${state.ok ? "text-green-800" : "text-red-800"}`} role="status">{state.message}</p>;
}

function CorrectionTypeSelect({ value, onChange }: { value: AttendanceEventType; onChange: (value: AttendanceEventType) => void }) {
  return (
    <Field label="Clock event">
      <select className={inputClassName()} name="eventType" value={value} onChange={(event) => onChange(event.target.value as AttendanceEventType)}>
        {eventTypes.map((eventType) => <option key={eventType} value={eventType}>{eventLabel(eventType)}</option>)}
      </select>
    </Field>
  );
}

function ConsequentialPreview({ changes }: { changes: TypeChangePreview[] }) {
  if (!changes.length) return <p className="mt-3 text-sm text-slate-700">No other same-day event types need to change.</p>;
  return (
    <div className="mt-3 border-l-2 border-amber-400 pl-3 text-sm text-slate-800">
      <p className="font-bold text-purple-950">Also changes these same-day event types</p>
      <ul className="mt-1 grid gap-1">
        {changes.map((change) => <li key={change.targetEventId}>{formatTimeUk(change.eventTimestamp)} becomes {eventLabel(change.eventType)}. The recorded time stays the same.</li>)}
      </ul>
    </div>
  );
}

function FixEventForm({ day, targetEventId, eventType: currentEventType, eventTimestamp, source, correctionId, returnTo, action }: {
  day: StaffHoursDay;
  targetEventId: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  source: EffectiveClockEvent["source"];
  correctionId: string;
  returnTo: string;
  action: CorrectionFormAction;
}) {
  const router = useRouter();
  const [eventType, setEventType] = useState(currentEventType);
  const [localDateTime, setLocalDateTime] = useState(() => localDateTimeValue(eventTimestamp));
  const [state, formAction, pending] = useActionState(action, initialState);
  const changes = useMemo(() => previewManualCorrectionChanges({
    events: day.effectiveEvents,
    selectedEventId: targetEventId,
    selectedEventType: eventType,
    localDateTime,
    staffId: day.staffId,
    proposedCorrectionId: correctionId,
  }), [correctionId, day.effectiveEvents, day.staffId, eventType, localDateTime, targetEventId]);
  useEffect(() => {
    if (state.ok) {
      router.replace(returnTo);
      router.refresh();
    }
  }, [returnTo, router, state.ok]);

  return (
    <form action={formAction} className="mt-3 border-l-2 border-purple-200 pl-3">
      <input name="targetEventId" type="hidden" value={targetEventId} />
      <p className="text-sm text-slate-700">
        Current effective event: <strong>{formatTimeUk(eventTimestamp)} {eventLabel(currentEventType)}</strong>
        {" "}({source === "manager_correction" ? "Manager correction" : source === "legacy_manager" ? "Legacy manager event" : "Kiosk"})
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <CorrectionTypeSelect value={eventType} onChange={setEventType} />
        <Field label="Corrected date and time"><input className={inputClassName()} name="localDateTime" type="datetime-local" value={localDateTime} onChange={(event) => setLocalDateTime(event.target.value)} required /></Field>
        <Field label="Reason for correction"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
      </div>
      <ConsequentialPreview changes={changes} />
      <Button className="mt-3" type="submit" disabled={pending || !correctionId}>{pending ? "Saving..." : "Save event fix"}</Button>
      <ActionFeedback state={state} />
    </form>
  );
}

export function MissingEventCorrectionForm({ day, correctionId, returnTo, action }: { day: StaffHoursDay; correctionId: string; returnTo: string; action: CorrectionFormAction }) {
  const router = useRouter();
  const [eventType, setEventType] = useState(day.suggestedMissingType);
  const [localDateTime, setLocalDateTime] = useState(`${day.date}T${day.plannedPeriods[0]?.startTime ?? "09:00"}`);
  const [state, formAction, pending] = useActionState(action, initialState);
  const changes = useMemo(() => previewManualCorrectionChanges({
    events: day.effectiveEvents,
    selectedEventId: null,
    selectedEventType: eventType,
    localDateTime,
    staffId: day.staffId,
    proposedCorrectionId: correctionId,
  }), [correctionId, day.effectiveEvents, day.staffId, eventType, localDateTime]);
  useEffect(() => {
    if (state.ok) {
      router.replace(returnTo);
      router.refresh();
    }
  }, [returnTo, router, state.ok]);

  return (
    <form action={formAction} className="mt-3 border-l-2 border-purple-200 pl-3">
      <div className="grid gap-3 md:grid-cols-2">
        <CorrectionTypeSelect value={eventType} onChange={setEventType} />
        <Field label="Date and time"><input className={inputClassName()} name="localDateTime" type="datetime-local" value={localDateTime} onChange={(event) => setLocalDateTime(event.target.value)} required /></Field>
        <Field label="Reason for correction"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
      </div>
      <ConsequentialPreview changes={changes} />
      <Button className="mt-3" type="submit" disabled={pending || !correctionId}>{pending ? "Saving..." : "Add missing event"}</Button>
      <ActionFeedback state={state} />
    </form>
  );
}

function RemoveEventForm({
  targetEventId,
  eventType,
  eventTimestamp,
  returnTo,
  action,
}: {
  targetEventId: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  returnTo: string;
  action: CorrectionFormAction;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  useEffect(() => {
    if (state.ok) {
      router.replace(returnTo);
      router.refresh();
    }
  }, [returnTo, router, state.ok]);

  return (
    <form action={formAction} className="mt-4 border-t border-red-200 pb-4 pt-4">
      <input name="targetEventId" type="hidden" value={targetEventId} />
      <p className="text-sm font-bold text-red-900">
        Remove {formatTimeUk(eventTimestamp)} {eventLabel(eventType)} from calculated hours
      </p>
      <p className="mt-1 text-sm text-slate-700">
        Original records remain in attendance history. This only removes the event from effective attendance hours.
      </p>
      <Field label="Reason for removal">
        <input className={`mt-3 ${inputClassName()}`} name="reason" minLength={5} required />
      </Field>
      <label className="mt-3 flex min-h-14 cursor-pointer items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-950">
        <input className="mt-0.5 h-6 w-6 shrink-0 accent-red-600" name="confirmed" type="checkbox" value="yes" required />
        <span>I confirm this event should be removed from calculated hours.</span>
      </label>
      <Button className="mt-3" type="submit" variant="danger" disabled={pending}>
        <CircleMinus className="h-5 w-5" aria-hidden />
        <span>{pending ? "Removing..." : "Remove from hours"}</span>
      </Button>
      <ActionFeedback state={state} />
    </form>
  );
}

function ResetPlannedHoursForm({ preview, returnTo, action }: { preview: ResetPlannedHoursPreview; returnTo: string; action: CorrectionFormAction }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  useEffect(() => {
    if (state.ok) {
      router.replace(returnTo);
      router.refresh();
    }
  }, [returnTo, router, state.ok]);

  return (
    <form action={formAction} className="mt-3 border-l-2 border-red-300 pb-4 pl-3">
      <p className="text-sm text-slate-700">
        Published planned hours: <strong>{preview.plannedStart} to {preview.plannedFinish}</strong>.
      </p>
      <div className="mt-3 text-sm text-slate-800">
        <p className="font-bold text-red-900">Remove from calculated hours</p>
        {preview.effectiveEvents.length ? (
          <ul className="mt-1 grid gap-1">
            {preview.effectiveEvents.map((event) => (
              <li key={event.id}>{formatTimeUk(event.eventTimestamp)} {eventLabel(event.eventType)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1">There are no active effective events to remove.</p>
        )}
      </div>
      <div className="mt-3 border-l-2 border-green-500 pl-3 text-sm text-slate-800">
        <p className="font-bold text-green-900">Add from the published rota</p>
        <ul className="mt-1 grid gap-1">
          <li>Add Clock in at {preview.plannedStart}.</li>
          <li>Add Clock out at {preview.plannedFinish}.</li>
        </ul>
      </div>
      <p className="mt-3 text-sm font-bold text-amber-900">
        All intermediate and lunch events will be removed. Add lunch events manually afterwards.
      </p>
      <p className="mt-2 text-sm text-slate-700">
        Original records remain in attendance history. The reset is stored as manager corrections.
      </p>
      <Field label="Reason for reset">
        <input className={`mt-3 ${inputClassName()}`} name="reason" minLength={5} required />
      </Field>
      <label className="mt-3 flex min-h-14 cursor-pointer items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-950">
        <input className="mt-0.5 h-6 w-6 shrink-0 accent-red-600" name="confirmed" type="checkbox" value="yes" required />
        <span>I confirm all effective events should be removed and replaced with the published start and finish.</span>
      </label>
      <Button className="mt-3" type="submit" variant="danger" disabled={pending}>
        <RotateCcw className="h-5 w-5" aria-hidden />
        <span>{pending ? "Resetting..." : "Reset to planned hours"}</span>
      </Button>
      <ActionFeedback state={state} />
    </form>
  );
}

export function AttendanceCorrectionControls({ day, correctionId, returnTo, manualAction, removeAction, resetAction }: {
  day: StaffHoursDay;
  correctionId: string;
  returnTo: string;
  manualAction: CorrectionFormAction;
  removeAction: CorrectionFormAction;
  resetAction: CorrectionFormAction;
}) {
  const resetPreview = previewResetToPlannedHours(day);
  return (
    <section className="mt-4 border-t border-purple-200 pt-4" aria-label="Attendance corrections">
      <h4 className="text-sm font-black text-purple-950">Correct this day</h4>
      <p className="mt-1 text-sm text-slate-700">Original clock events stay unchanged. Corrections are saved separately.</p>
      <div className="mt-3 grid gap-2">
        {resetPreview ? <details className="rounded-md border border-red-200 bg-white px-3"><summary className="flex min-h-11 cursor-pointer items-center font-bold text-red-900">Reset to planned hours</summary><ResetPlannedHoursForm preview={resetPreview} returnTo={returnTo} action={resetAction} /></details> : null}
        <details className="rounded-md border border-purple-200 bg-white px-3"><summary className="flex min-h-11 cursor-pointer items-center font-bold text-purple-900">Add missing event</summary><MissingEventCorrectionForm day={day} correctionId={correctionId} returnTo={returnTo} action={manualAction} /></details>
        {day.effectiveEvents.map((event) => <details key={event.id} className="rounded-md border border-slate-200 bg-white px-3"><summary className="flex min-h-11 cursor-pointer items-center font-bold text-purple-900">Fix {formatTimeUk(event.eventTimestamp)} {eventLabel(event.eventType)}</summary><FixEventForm day={day} targetEventId={event.id} eventType={event.eventType} eventTimestamp={event.eventTimestamp} source={event.source} correctionId={correctionId} returnTo={returnTo} action={manualAction} /><RemoveEventForm targetEventId={event.id} eventType={event.eventType} eventTimestamp={event.eventTimestamp} returnTo={returnTo} action={removeAction} /></details>)}
      </div>
    </section>
  );
}
