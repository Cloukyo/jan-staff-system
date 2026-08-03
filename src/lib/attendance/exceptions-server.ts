import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { attendanceOperationalDate } from "@/lib/attendance/state-machine";
import type {
  AttendanceExceptionStatus,
  AttendanceExceptionType,
  EffectiveAttendanceEvent,
} from "@/lib/attendance/types";
import { isoDateInLondon } from "@/lib/dates/format";

const exceptionStatuses = new Set<AttendanceExceptionStatus>([
  "open", "under_review", "resolved", "dismissed",
]);
const exceptionTypes = new Set<AttendanceExceptionType>([
  "missing_clock_out", "missing_clock_in", "consecutive_clock_in",
  "unmatched_clock_out", "overlapping_attendance", "unusually_long_shift",
  "offline_sync_conflict", "device_clock_drift", "offline_time_uncertain",
]);

export type AttendanceExceptionFilters = {
  status?: AttendanceExceptionStatus;
  type?: AttendanceExceptionType;
  staffId?: string;
  from: string;
  to: string;
};

export type AttendanceEvidenceEvent = {
  id: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  kioskDeviceId: string | null;
  source: string;
};

export type AttendanceExceptionRow = {
  id: string;
  staffId: string;
  staffName: string;
  operationalDate: string;
  type: AttendanceExceptionType;
  status: AttendanceExceptionStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  stateRevision: string;
  suggestedResolutionAt: string | null;
  payrollMayBeAffected: boolean;
  originalEvents: AttendanceEvidenceEvent[];
  effectiveEvents: EffectiveAttendanceEvent[];
  corrections: Array<Record<string, unknown>>;
  scheduledShifts: Array<Record<string, unknown>>;
  leaveContext: Array<Record<string, unknown>>;
  operationHistory: Array<Record<string, unknown>>;
  resolutionReason: string | null;
  dismissalReason: string | null;
  resolvedAt: string | null;
  dismissedAt: string | null;
  reviewingManagerName: string | null;
};

type DatabaseExceptionRow = Record<string, unknown> & {
  original_events?: Array<Record<string, unknown>>;
  effective_events?: Array<Record<string, unknown>>;
};

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normaliseAttendanceExceptionFilters(
  input: Record<string, string | undefined>,
): AttendanceExceptionFilters {
  const today = isoDateInLondon();
  const defaultFromDate = new Date(`${today}T12:00:00Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 14);
  const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
  const from = validDate(input.from) ? input.from : defaultFrom;
  const to = validDate(input.to) && input.to >= from ? input.to : today;
  const status = exceptionStatuses.has(input.status as AttendanceExceptionStatus)
    ? input.status as AttendanceExceptionStatus
    : "open";
  const type = exceptionTypes.has(input.type as AttendanceExceptionType)
    ? input.type as AttendanceExceptionType
    : undefined;
  return {
    status,
    type,
    staffId: input.staffId?.trim() || undefined,
    from,
    to,
  };
}

export function mapAttendanceExceptionRows(
  rows: DatabaseExceptionRow[],
): AttendanceExceptionRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    staffId: String(row.staff_id),
    staffName: String(row.full_name),
    operationalDate: String(row.operational_date),
    type: String(row.exception_type) as AttendanceExceptionType,
    status: String(row.status) as AttendanceExceptionStatus,
    source: String(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    stateRevision: String(row.state_revision),
    suggestedResolutionAt: row.suggested_resolution_at
      ? String(row.suggested_resolution_at)
      : null,
    payrollMayBeAffected: Boolean(row.payroll_may_be_affected),
    originalEvents: (row.original_events ?? []).map((event) => ({
      id: String(event.id),
      eventType: String(event.event_type) as "clock_in" | "clock_out",
      eventTimestamp: String(event.event_timestamp),
      kioskDeviceId: event.kiosk_device_id ? String(event.kiosk_device_id) : null,
      source: String(event.event_source),
    })),
    effectiveEvents: (row.effective_events ?? []).map((event) => ({
      eventId: String(event.event_id),
      eventOrderKey: String(event.event_order_key),
      originalEventId: event.original_event_id ? String(event.original_event_id) : null,
      correctionId: event.correction_id ? String(event.correction_id) : null,
      staffId: String(row.staff_id),
      eventType: String(event.event_type) as "clock_in" | "clock_out",
      eventTimestamp: String(event.event_timestamp),
      source: String(event.source) as EffectiveAttendanceEvent["source"],
    })),
    corrections: (row.corrections ?? []) as Array<Record<string, unknown>>,
    scheduledShifts: (row.scheduled_shifts ?? []) as Array<Record<string, unknown>>,
    leaveContext: (row.leave_context ?? []) as Array<Record<string, unknown>>,
    operationHistory: (row.operation_history ?? []) as Array<Record<string, unknown>>,
    resolutionReason: row.resolution_reason ? String(row.resolution_reason) : null,
    dismissalReason: row.dismissal_reason ? String(row.dismissal_reason) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    dismissedAt: row.dismissed_at ? String(row.dismissed_at) : null,
    reviewingManagerName: row.reviewing_manager_name
      ? String(row.reviewing_manager_name)
      : null,
  }));
}

export type AttendanceExceptionResolutionKind =
  | "add_missing_clock_in"
  | "add_missing_clock_out"
  | "correct_clock_in"
  | "correct_clock_out";

export function buildAttendanceExceptionResolutionPlan(input: {
  operationId: string;
  staffId: string;
  operationalDate: string;
  resolutionKind: AttendanceExceptionResolutionKind;
  eventTimestamp: string;
  effectiveEventId?: string;
  originalEventId?: string | null;
  correctionId?: string | null;
}) {
  if (attendanceOperationalDate(input.eventTimestamp) !== input.operationalDate) {
    throw new Error("The correction time must be on the same attendance date.");
  }
  const add = input.resolutionKind === "add_missing_clock_out"
    || input.resolutionKind === "add_missing_clock_in";
  if (!add && !input.effectiveEventId) {
    throw new Error("Choose the effective clock event to correct.");
  }
  return {
    primary: {
      id: input.operationId,
      staff_id: input.staffId,
      recorded_date: input.operationalDate,
      correction_kind: add ? "add" : "replace",
      original_event_id: add || input.correctionId
        ? null
        : input.originalEventId ?? input.effectiveEventId ?? null,
      supersedes_correction_id: add ? null : input.correctionId ?? null,
      event_type: ["add_missing_clock_in", "correct_clock_in"].includes(
        input.resolutionKind,
      ) ? "clock_in" : "clock_out",
      event_timestamp: input.eventTimestamp,
    },
    consequential: [],
  };
}

export async function loadAttendanceExceptions(
  filters: AttendanceExceptionFilters,
): Promise<AttendanceExceptionRow[]> {
  await requireAccount(["manager"]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_manager_attendance_exceptions", {
    range_start: filters.from,
    range_end: filters.to,
    requested_status: filters.status ?? null,
    requested_type: filters.type ?? null,
    requested_staff_id: filters.staffId ?? null,
  });
  if (error) throw new Error("Attendance exceptions could not be loaded.");
  return mapAttendanceExceptionRows((data ?? []) as DatabaseExceptionRow[]);
}
