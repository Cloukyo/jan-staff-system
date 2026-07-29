"use server";

import { revalidatePath } from "next/cache";
import type { AttendanceEventType } from "@/lib/attendance/effective-events";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { londonLocalDateTimeToUtc } from "@/lib/dates/format";

export type CorrectionActionInput = {
  staffId: string;
  attendanceDate: string;
  targetEventId?: string;
  correctionId: string;
  eventType: "clock_in" | "clock_out";
  localDateTime: string;
  reason: string;
  returnTo: string;
  expectedRevision: string;
};

export type PlannedHoursActionInput = {
  staffId: string;
  attendanceDate: string;
  reason: string;
  returnTo?: string;
  expectedRevision: string;
};

type RemoveClockEventActionInput = {
  staffId: string;
  attendanceDate: string;
  targetEventId: string;
  correctionId: string;
  reason: string;
  returnTo: string;
  expectedRevision: string;
  confirmed: boolean;
};

type ResetAttendanceToPlannedHoursActionInput = {
  staffId: string;
  attendanceDate: string;
  correctionId: string;
  reason: string;
  returnTo: string;
  expectedRevision: string;
  confirmed: boolean;
  plannedStart: string;
  plannedFinish: string;
};

export type CorrectionActionResult = {
  ok: boolean;
  code: string;
  message: string;
};

export type BoundAttendanceCorrectionContext = {
  staffId: string;
  attendanceDate: string;
  correctionId: string;
  returnTo: string;
  eventRevision: string;
  plannedStart?: string;
  plannedFinish?: string;
};

const invalidCorrection: CorrectionActionResult = {
  ok: false,
  code: "invalid_correction",
  message: "Choose an event, time and a clear correction reason.",
};

const invalidRemovalConfirmation: CorrectionActionResult = {
  ok: false,
  code: "invalid_correction",
  message: "Confirm the removal and enter a clear reason.",
};

const invalidResetConfirmation: CorrectionActionResult = {
  ok: false,
  code: "invalid_correction",
  message: "Confirm the reset and enter a clear reason.",
};

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCorrectionActionInput(value: unknown): value is CorrectionActionInput {
  return isRecord(value)
    && typeof value.staffId === "string"
    && typeof value.attendanceDate === "string"
    && typeof value.correctionId === "string"
    && typeof value.eventType === "string"
    && typeof value.localDateTime === "string"
    && typeof value.reason === "string"
    && typeof value.returnTo === "string"
    && typeof value.expectedRevision === "string"
    && (value.targetEventId === undefined || typeof value.targetEventId === "string");
}

function isPlannedHoursActionInput(value: unknown): value is PlannedHoursActionInput {
  return isRecord(value)
    && typeof value.staffId === "string"
    && typeof value.attendanceDate === "string"
    && typeof value.reason === "string"
    && typeof value.expectedRevision === "string"
    && (value.returnTo === undefined || typeof value.returnTo === "string");
}

function isRemoveClockEventActionInput(value: unknown): value is RemoveClockEventActionInput {
  return isRecord(value)
    && typeof value.staffId === "string"
    && typeof value.attendanceDate === "string"
    && typeof value.targetEventId === "string"
    && typeof value.correctionId === "string"
    && typeof value.reason === "string"
    && typeof value.returnTo === "string"
    && typeof value.expectedRevision === "string"
    && typeof value.confirmed === "boolean";
}

function isResetAttendanceToPlannedHoursActionInput(value: unknown): value is ResetAttendanceToPlannedHoursActionInput {
  return isRecord(value)
    && typeof value.staffId === "string"
    && typeof value.attendanceDate === "string"
    && typeof value.correctionId === "string"
    && typeof value.reason === "string"
    && typeof value.returnTo === "string"
    && typeof value.expectedRevision === "string"
    && typeof value.confirmed === "boolean"
    && typeof value.plannedStart === "string"
    && typeof value.plannedFinish === "string";
}

function revalidateAttendancePaths(returnTo?: string) {
  revalidatePath("/attendance");
  revalidatePath("/clock");
  revalidatePath("/payroll");
  if (returnTo && !["/attendance", "/clock", "/payroll"].includes(returnTo) && /^\/[a-z0-9/_-]*$/i.test(returnTo)) {
    revalidatePath(returnTo);
  }
}

function attendanceChanged(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "40001"
    || Boolean(error?.message?.includes("Attendance changed after this preview"));
}

function attendanceChangedResult(): CorrectionActionResult {
  return {
    ok: false,
    code: "attendance_changed",
    message: "Attendance changed after this preview. Reload the day and review it again before saving.",
  };
}

async function saveClockEventCorrection(input: CorrectionActionInput): Promise<CorrectionActionResult> {
  await requireAccount(["manager"]);
  if (!isCorrectionActionInput(input)) return invalidCorrection;
  const reason = input.reason.trim();
  if (
    !input.staffId
    || !validDate(input.attendanceDate)
    || !validUuid(input.correctionId)
    || !["clock_in", "clock_out"].includes(input.eventType)
    || !input.expectedRevision
    || reason.length < 5
  ) {
    return invalidCorrection;
  }

  let localDateTime: ReturnType<typeof londonLocalDateTimeToUtc>;
  try {
    localDateTime = londonLocalDateTimeToUtc(input.localDateTime);
  } catch {
    return invalidCorrection;
  }
  if (localDateTime.recordedDate !== input.attendanceDate) {
    return invalidCorrection;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_manual_clock_event_correction", {
    target_staff_id: input.staffId,
    target_date: input.attendanceDate,
    target_event_id: input.targetEventId?.trim() || null,
    primary_correction_id: input.correctionId,
    requested_event_type: input.eventType,
    requested_event_timestamp: localDateTime.timestamp.toISOString(),
    reason,
    expected_revision: input.expectedRevision,
  });
  if (attendanceChanged(error)) return attendanceChangedResult();
  if (error) return { ok: false, code: "save_failed", message: "The correction could not be recorded." };

  revalidateAttendancePaths(input.returnTo);
  return {
    ok: true,
    code: "saved",
    message: input.targetEventId
      ? "The correction was saved without changing the original clock events."
      : "The correction was added without changing the original clock events.",
  };
}

export async function saveBoundClockEventCorrectionAction(
  context: BoundAttendanceCorrectionContext,
  _state: CorrectionActionResult,
  formData: FormData,
): Promise<CorrectionActionResult> {
  return saveClockEventCorrection({
    staffId: context.staffId,
    attendanceDate: context.attendanceDate,
    targetEventId: String(formData.get("targetEventId") ?? "") || undefined,
    correctionId: context.correctionId,
    eventType: String(formData.get("eventType") ?? "") as AttendanceEventType,
    localDateTime: String(formData.get("localDateTime") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    returnTo: context.returnTo,
    expectedRevision: context.eventRevision,
  });
}

async function applyPlannedHours(input: PlannedHoursActionInput): Promise<CorrectionActionResult> {
  await requireAccount(["manager"]);
  if (!isPlannedHoursActionInput(input)) return invalidCorrection;
  const reason = input.reason.trim();
  if (!input.staffId || !validDate(input.attendanceDate) || reason.length < 5) return invalidCorrection;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("use_planned_hours", {
    target_staff_id: input.staffId,
    target_date: input.attendanceDate,
    reason,
    expected_revision: input.expectedRevision,
  });
  if (attendanceChanged(error)) return attendanceChangedResult();
  if (error) return { ok: false, code: "save_failed", message: "Planned hours could not be applied." };
  if (!data) return { ok: true, code: "no_changes", message: "Attendance already matches the published planned hours." };

  revalidateAttendancePaths(input.returnTo);
  return { ok: true, code: "saved", message: "Published planned hours were applied as manager corrections." };
}

export async function useBoundPlannedHoursAction(
  context: BoundAttendanceCorrectionContext,
  _state: CorrectionActionResult,
  formData: FormData,
): Promise<CorrectionActionResult> {
  return applyPlannedHours({
    staffId: context.staffId,
    attendanceDate: context.attendanceDate,
    reason: String(formData.get("reason") ?? ""),
    returnTo: context.returnTo,
    expectedRevision: context.eventRevision,
  });
}

async function removeClockEventFromHours(input: RemoveClockEventActionInput): Promise<CorrectionActionResult> {
  await requireAccount(["manager"]);
  if (!isRemoveClockEventActionInput(input) || !input.confirmed) return invalidRemovalConfirmation;
  const reason = input.reason.trim();
  if (
    !input.staffId
    || !validDate(input.attendanceDate)
    || !validUuid(input.targetEventId)
    || !validUuid(input.correctionId)
    || !input.expectedRevision
    || reason.length < 5
  ) {
    return invalidCorrection;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_clock_event_from_hours", {
    target_staff_id: input.staffId,
    target_date: input.attendanceDate,
    target_event_id: input.targetEventId,
    reason,
    expected_revision: input.expectedRevision,
    operation_id: input.correctionId,
  });
  if (attendanceChanged(error)) return attendanceChangedResult();
  if (error) {
    return {
      ok: false,
      code: "remove_failed",
      message: "The clock event could not be removed from attendance hours.",
    };
  }

  revalidateAttendancePaths(input.returnTo);
  return {
    ok: true,
    code: "removed",
    message: "The clock event was removed from attendance hours.",
  };
}

export async function removeBoundClockEventAction(
  context: BoundAttendanceCorrectionContext,
  _state: CorrectionActionResult,
  formData: FormData,
): Promise<CorrectionActionResult> {
  return removeClockEventFromHours({
    staffId: context.staffId,
    attendanceDate: context.attendanceDate,
    targetEventId: String(formData.get("targetEventId") ?? ""),
    correctionId: context.correctionId,
    reason: String(formData.get("reason") ?? ""),
    returnTo: context.returnTo,
    expectedRevision: context.eventRevision,
    confirmed: formData.get("confirmed") === "yes",
  });
}

async function resetAttendanceToPlannedHours(
  input: ResetAttendanceToPlannedHoursActionInput,
): Promise<CorrectionActionResult> {
  await requireAccount(["manager"]);
  if (!isResetAttendanceToPlannedHoursActionInput(input) || !input.confirmed) return invalidResetConfirmation;
  const reason = input.reason.trim();
  if (
    !input.staffId
    || !validDate(input.attendanceDate)
    || !validUuid(input.correctionId)
    || !input.expectedRevision
    || !validTime(input.plannedStart)
    || !validTime(input.plannedFinish)
    || reason.length < 5
  ) {
    return invalidCorrection;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reset_attendance_to_planned_hours", {
    target_staff_id: input.staffId,
    target_date: input.attendanceDate,
    reason,
    expected_revision: input.expectedRevision,
    operation_id: input.correctionId,
    expected_planned_start: input.plannedStart,
    expected_planned_finish: input.plannedFinish,
  });
  if (attendanceChanged(error)) return attendanceChangedResult();
  if (error) {
    return {
      ok: false,
      code: "reset_failed",
      message: "Attendance could not be reset to published planned hours.",
    };
  }

  revalidateAttendancePaths(input.returnTo);
  return {
    ok: true,
    code: "reset",
    message: "Attendance was reset to published planned hours.",
  };
}

export async function resetBoundAttendanceToPlannedHoursAction(
  context: BoundAttendanceCorrectionContext,
  _state: CorrectionActionResult,
  formData: FormData,
): Promise<CorrectionActionResult> {
  return resetAttendanceToPlannedHours({
    staffId: context.staffId,
    attendanceDate: context.attendanceDate,
    correctionId: context.correctionId,
    reason: String(formData.get("reason") ?? ""),
    returnTo: context.returnTo,
    expectedRevision: context.eventRevision,
    confirmed: formData.get("confirmed") === "yes",
    plannedStart: context.plannedStart ?? "",
    plannedFinish: context.plannedFinish ?? "",
  });
}
