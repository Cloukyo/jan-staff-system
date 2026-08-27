export type AttendanceState =
  | "clocked_out"
  | "clocked_in"
  | "missing_clock_out"
  | "missing_clock_in"
  | "awaiting_manager_review";

export type AttendanceAction = "clock_in" | "clock_out" | "start_new_shift";

export type AttendanceEventType = "clock_in" | "clock_out";

export type AttendanceExceptionType =
  | "missing_clock_out"
  | "missing_clock_in"
  | "consecutive_clock_in"
  | "unmatched_clock_out"
  | "overlapping_attendance"
  | "unusually_long_shift"
  | "offline_sync_conflict"
  | "device_clock_drift"
  | "offline_time_uncertain";

export type AttendanceExceptionStatus =
  | "open"
  | "under_review"
  | "resolved"
  | "dismissed";

export type EffectiveAttendanceEvent = {
  organisationId?: string;
  siteId?: string;
  eventId: string;
  eventOrderKey: string;
  originalEventId: string | null;
  correctionId: string | null;
  staffId: string;
  eventType: AttendanceEventType;
  eventTimestamp: string;
  source: "kiosk" | "legacy_manager" | "manager_correction";
};

export type AttendanceExceptionSummary = {
  organisationId?: string;
  siteId?: string;
  id: string;
  staffId: string;
  operationalDate: string;
  type: AttendanceExceptionType;
  status: AttendanceExceptionStatus;
};

export type AttendanceWarning = {
  type: AttendanceExceptionType;
  operationalDate: string;
  exceptionId?: string;
  eventIds?: string[];
};

export type AttendanceStateResult = {
  organisationId?: string;
  siteId?: string;
  staffId?: string;
  state: AttendanceState;
  operationalDate: string;
  currentEvent: EffectiveAttendanceEvent | null;
  unresolvedExceptions: AttendanceExceptionSummary[];
  allowedActions: AttendanceAction[];
  warnings: AttendanceWarning[];
  revision: string;
  evaluatedAt: string;
};
