import type { AttendanceStateResult } from "@/lib/attendance/types";
import { kioskResultMessage } from "@/lib/kiosk/security";
import type { KioskActionResult } from "@/lib/kiosk/types";

export type KioskActionRpcResponse = {
  ok?: boolean;
  code?: string;
  state?: string;
  eventId?: string;
  recordedAt?: string;
  attendanceState?: AttendanceStateResult;
  event_id?: string;
  recorded_at?: string;
  attendance_state?: AttendanceStateResult;
  weeklyHours?: KioskActionResult["weeklyHours"];
  current_status?: string | null;
  work_week_start_date?: string | null;
  work_week_end_date?: string | null;
  completed_minutes?: number | null;
  open_shift_in_progress?: boolean | null;
};

export type KioskVerificationRpcValue =
  | KioskActionRpcResponse
  | KioskActionRpcResponse[]
  | null
  | undefined;

export function mapKioskActionResponse(
  row: KioskActionRpcResponse | null | undefined,
): KioskActionResult {
  const code = row?.code ?? "request_failed";
  return {
    ok: Boolean(row?.ok),
    code,
    message: kioskResultMessage(code),
    currentStatus:
      row?.state === "clocked_in" || row?.state === "clocked_out"
        ? row.state
        : undefined,
    eventId: row?.eventId ?? row?.event_id,
    recordedAt: row?.recordedAt ?? row?.recorded_at,
    attendanceState: row?.attendanceState ?? row?.attendance_state,
    weeklyHours: row?.weeklyHours,
  };
}

export function mapKioskVerificationResponse(
  value: KioskVerificationRpcValue,
): KioskActionResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return mapKioskActionResponse(null);
  const weeklyHours = row.weeklyHours ?? (
    row.work_week_start_date && row.work_week_end_date
      ? {
          weekStartDate: row.work_week_start_date,
          weekEndDate: row.work_week_end_date,
          completedMinutes: row.completed_minutes ?? 0,
          openShiftInProgress: Boolean(row.open_shift_in_progress),
        }
      : undefined
  );
  return mapKioskActionResponse({
    ...row,
    state: row.state ?? row.current_status ?? undefined,
    attendanceState: row.attendanceState ?? row.attendance_state,
    weeklyHours,
  });
}
