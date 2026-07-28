"use server";

import { revalidatePath } from "next/cache";
import { planAlternatingEventTypes } from "@/lib/attendance/sequence";
import type { AttendanceEventType, EffectiveClockEvent } from "@/lib/attendance/effective-events";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { londonLocalDateTimeToUtc } from "@/lib/dates/format";

export type CorrectionActionInput = {
  staffId: string;
  originalEventId?: string;
  eventType: "clock_in" | "clock_out";
  localDateTime: string;
  reason: string;
  returnTo: string;
};

export type PlannedHoursActionInput = {
  staffId: string;
  attendanceDate: string;
  reason: string;
  returnTo?: string;
};

export type CorrectionActionResult = {
  ok: boolean;
  code: string;
  message: string;
};

type OriginalEventRow = {
  id: string;
  staff_id: string;
  event_type: AttendanceEventType;
  event_timestamp: string;
  recorded_date: string;
};

type EffectiveEventRow = {
  event_id: string;
  original_event_id: string | null;
  correction_id: string | null;
  staff_id: string;
  event_type: AttendanceEventType;
  event_timestamp: string;
  recorded_date: string;
  source: EffectiveClockEvent["source"];
};

const invalidCorrection: CorrectionActionResult = {
  ok: false,
  code: "invalid_correction",
  message: "Choose an event, time and a clear correction reason.",
};

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCorrectionActionInput(value: unknown): value is CorrectionActionInput {
  return isRecord(value)
    && typeof value.staffId === "string"
    && typeof value.eventType === "string"
    && typeof value.localDateTime === "string"
    && typeof value.reason === "string"
    && typeof value.returnTo === "string"
    && (value.originalEventId === undefined || typeof value.originalEventId === "string");
}

function isPlannedHoursActionInput(value: unknown): value is PlannedHoursActionInput {
  return isRecord(value)
    && typeof value.staffId === "string"
    && typeof value.attendanceDate === "string"
    && typeof value.reason === "string"
    && (value.returnTo === undefined || typeof value.returnTo === "string");
}

function revalidateAttendancePaths(returnTo?: string) {
  revalidatePath("/attendance");
  revalidatePath("/clock");
  revalidatePath("/payroll");
  if (returnTo && !["/attendance", "/clock", "/payroll"].includes(returnTo) && /^\/[a-z0-9/_-]*$/i.test(returnTo)) {
    revalidatePath(returnTo);
  }
}

function effectiveEvent(row: EffectiveEventRow): EffectiveClockEvent {
  return {
    id: row.event_id,
    originalEventId: row.original_event_id,
    correctionId: row.correction_id,
    staffId: row.staff_id,
    eventType: row.event_type,
    eventTimestamp: row.event_timestamp,
    recordedDate: row.recorded_date,
    source: row.source,
  };
}

export async function saveClockEventCorrectionAction(input: CorrectionActionInput): Promise<CorrectionActionResult> {
  await requireAccount(["manager"]);
  if (!isCorrectionActionInput(input)) return invalidCorrection;
  const reason = input.reason.trim();
  if (!input.staffId || !["clock_in", "clock_out"].includes(input.eventType) || reason.length < 5) {
    return invalidCorrection;
  }

  let localDateTime: ReturnType<typeof londonLocalDateTimeToUtc>;
  try {
    localDateTime = londonLocalDateTimeToUtc(input.localDateTime);
  } catch {
    return invalidCorrection;
  }

  const supabase = await createSupabaseServerClient();
  let originalEvent: OriginalEventRow | null = null;
  if (input.originalEventId) {
    const { data, error } = await supabase
      .from("clock_events")
      .select("id,staff_id,event_type,event_timestamp,recorded_date")
      .eq("id", input.originalEventId)
      .maybeSingle();
    originalEvent = data as OriginalEventRow | null;
    if (error) {
      return { ok: false, code: "load_failed", message: "The original clock event could not be loaded." };
    }
    if (!originalEvent || originalEvent.staff_id !== input.staffId || originalEvent.recorded_date !== localDateTime.recordedDate) {
      return invalidCorrection;
    }
  }

  const attendanceDate = originalEvent?.recorded_date ?? localDateTime.recordedDate;
  const { data, error: effectiveEventsError } = await supabase.rpc("get_effective_clock_events", {
    range_start: attendanceDate,
    range_end: attendanceDate,
    target_staff_id: input.staffId,
  });
  if (effectiveEventsError) return { ok: false, code: "load_failed", message: "The attendance events could not be loaded." };

  const effectiveEvents = ((data ?? []) as EffectiveEventRow[]).map(effectiveEvent);
  let selectedEventId: string;
  let eventsForPlan: EffectiveClockEvent[];
  if (originalEvent) {
    const selectedEvent = effectiveEvents.find(
      (event) => event.id === originalEvent.id || event.originalEventId === originalEvent.id,
    );
    selectedEventId = selectedEvent?.id ?? originalEvent.id;
    eventsForPlan = effectiveEvents;
  } else {
    const addedEvent: EffectiveClockEvent = {
        id: "new-event-preview",
        staffId: input.staffId,
        eventType: input.eventType,
        eventTimestamp: localDateTime.timestamp.toISOString(),
        recordedDate: attendanceDate,
        source: "manager_correction" as const,
        originalEventId: null,
        correctionId: null,
      };
    selectedEventId = addedEvent.id;
    eventsForPlan = [...effectiveEvents, addedEvent];
  }
  const consequential = planAlternatingEventTypes({
    events: eventsForPlan,
    selectedEventId,
    selectedEventType: input.eventType,
  }).map((planned) => ({
    staff_id: input.staffId,
    recorded_date: attendanceDate,
    correction_kind: "replace",
    original_event_id: planned.originalEventId,
    supersedes_correction_id: planned.supersedesCorrectionId,
    event_type: planned.eventType,
    event_timestamp: planned.eventTimestamp,
  }));

  const { error } = await supabase.rpc("save_clock_event_correction_chain", {
    plan: {
      reason,
      primary: {
        staff_id: input.staffId,
        recorded_date: localDateTime.recordedDate,
        correction_kind: originalEvent ? "replace" : "add",
        original_event_id: originalEvent?.id ?? null,
        supersedes_correction_id: null,
        event_type: input.eventType,
        event_timestamp: localDateTime.timestamp.toISOString(),
      },
      consequential,
    },
  });
  if (error) return { ok: false, code: "save_failed", message: "The correction could not be recorded." };

  revalidateAttendancePaths(input.returnTo);
  return {
    ok: true,
    code: "saved",
    message: originalEvent
      ? "The correction was saved without changing the original clock events."
      : "The correction was added without changing the original clock events.",
  };
}

export async function usePlannedHoursAction(input: PlannedHoursActionInput): Promise<CorrectionActionResult> {
  await requireAccount(["manager"]);
  if (!isPlannedHoursActionInput(input)) return invalidCorrection;
  const reason = input.reason.trim();
  if (!input.staffId || !validDate(input.attendanceDate) || reason.length < 5) return invalidCorrection;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("use_planned_hours", {
    target_staff_id: input.staffId,
    target_date: input.attendanceDate,
    reason,
  });
  if (error) return { ok: false, code: "save_failed", message: "Planned hours could not be applied." };
  if (!data) return { ok: true, code: "no_changes", message: "Attendance already matches the published planned hours." };

  revalidateAttendancePaths(input.returnTo);
  return { ok: true, code: "saved", message: "Published planned hours were applied as manager corrections." };
}
