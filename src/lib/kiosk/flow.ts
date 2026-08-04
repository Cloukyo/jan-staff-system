import type { AttendanceStateResult } from "@/lib/attendance/types";

export type KioskFlowMode =
  | "select"
  | "pin"
  | "change"
  | "confirm"
  | "success";

export type KioskFlowState = {
  mode: KioskFlowMode;
  pin: string;
  pending: boolean;
  idempotencyKey: string | null;
  attendanceState: AttendanceStateResult | null;
  recordedAt: string | null;
  completedMinutes: number | null;
};

export const initialKioskFlowState: KioskFlowState = {
  mode: "select",
  pin: "",
  pending: false,
  idempotencyKey: null,
  attendanceState: null,
  recordedAt: null,
  completedMinutes: null,
};

export type KioskFlowEvent =
  | { type: "invalid" | "cancel" | "timeout" }
  | { type: "choose" }
  | { type: "pin_changed"; pin: string }
  | { type: "change_required" }
  | { type: "verified"; attendanceState: AttendanceStateResult }
  | { type: "submit"; idempotencyKey: string }
  | { type: "conflict"; latest: AttendanceStateResult }
  | { type: "succeeded"; recordedAt: string; completedMinutes: number | null };

export function kioskFlowReducer(
  state: KioskFlowState,
  event: KioskFlowEvent,
): KioskFlowState {
  switch (event.type) {
    case "choose":
      return { ...initialKioskFlowState, mode: "pin" };
    case "pin_changed":
      return { ...state, pin: event.pin };
    case "change_required":
      return { ...state, mode: "change", pending: false };
    case "verified":
      return {
        ...state,
        mode: "confirm",
        pending: false,
        attendanceState: event.attendanceState,
      };
    case "submit":
      if (state.pending) return state;
      return {
        ...state,
        pending: true,
        idempotencyKey: event.idempotencyKey,
      };
    case "conflict":
      return {
        ...state,
        mode: "confirm",
        pin: "",
        pending: false,
        idempotencyKey: null,
        attendanceState: event.latest,
      };
    case "succeeded":
      return {
        ...state,
        mode: "success",
        pin: "",
        pending: false,
        idempotencyKey: null,
        recordedAt: event.recordedAt,
        completedMinutes: event.completedMinutes,
      };
    case "invalid":
      return {
        ...state,
        mode: "pin",
        pin: "",
        pending: false,
        idempotencyKey: null,
      };
    case "timeout":
    case "cancel":
      return { ...initialKioskFlowState };
  }
}
