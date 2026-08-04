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
};

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
