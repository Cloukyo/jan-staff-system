import type { OfflineCapability } from "@/lib/kiosk/offline/types";
import type {
  AttendanceAction,
  AttendanceStateResult,
} from "@/lib/attendance/types";

export type KioskStatus = "clocked_in" | "clocked_out";
export type KioskAttendanceState = AttendanceStateResult;

export type KioskRosterEntry = {
  staffId: string;
  displayName: string;
  fullName: string;
  employmentRole: string;
  currentStatus: KioskStatus;
  pinReady: boolean;
};

export type KioskActionResult = {
  ok: boolean;
  code: string;
  message: string;
  currentStatus?: KioskStatus;
  recordedAt?: string;
  eventId?: string;
  attendanceState?: KioskAttendanceState;
  offlineCapability?: OfflineCapability;
  weeklyHours?: {
    weekStartDate: string;
    weekEndDate: string;
    completedMinutes: number;
    openShiftInProgress: boolean;
  };
};

export type PerformKioskAttendanceActionInput = {
  staffId: string;
  pin: string;
  action: AttendanceAction;
  expectedRevision: string;
  idempotencyKey: string;
};
