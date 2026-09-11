import type { AttendanceStateResult } from "@/lib/attendance/types";

export type KioskActionPresentation = {
  heading: string;
  body: string;
  primaryLabel: string | null;
};

function londonTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function kioskActionPresentation(
  state: AttendanceStateResult,
  now: string,
): KioskActionPresentation {
  void now;
  const olderIssueNotice = state.unresolvedExceptions.some(
    (issue) => issue.operationalDate < state.operationalDate,
  )
    ? " A manager will review an issue from an earlier day."
    : "";

  switch (state.state) {
    case "clocked_in": {
      const clockedInAt = state.currentEvent
        ? ` You clocked in at ${londonTime(state.currentEvent.eventTimestamp)}.`
        : "";
      return {
        heading: "You are clocked in",
        body: `${clockedInAt}${olderIssueNotice}`.trim(),
        primaryLabel: state.allowedActions.includes("clock_out")
          ? "Clock out"
          : null,
      };
    }
    case "missing_clock_out":
      return {
        heading: "Your previous shift needs review",
        body: "Your earlier clock-in has been kept. Start today's shift and a manager will review the missing clock-out.",
        primaryLabel: state.allowedActions.includes("start_new_shift")
          ? "Start today's shift"
          : null,
      };
    case "missing_clock_in":
      return {
        heading: "Attendance needs review",
        body: "A clock-in is missing. Please ask a manager for help.",
        primaryLabel: null,
      };
    case "awaiting_manager_review":
      return {
        heading: "Attendance needs manager review",
        body: "No clock event will be added. Please ask a manager for help.",
        primaryLabel: null,
      };
    case "clocked_out":
    default:
      return {
        heading: "You are clocked out",
        body: olderIssueNotice.trim() || "Ready to start your shift.",
        primaryLabel: state.allowedActions.includes("clock_in")
          ? "Clock in"
          : null,
      };
  }
}

export function offlineKioskStatus(
  connection: string,
  runtime: { lifecycle: string; pendingCount: number; conflictCount: number },
): { heading: string; body: string; tone: "green" | "amber" | "red" } {
  if (connection === "revoked") return { heading: "Device unavailable", body: "This device can no longer be used. Ask a manager for help.", tone: "red" };
  if (connection === "update_required") return { heading: "Reconnect before clocking", body: "This device needs to refresh its Staff Clock information.", tone: "red" };
  if (runtime.lifecycle === "expired") return { heading: "Reconnect before clocking", body: "This device needs to reconnect before staff can clock in or out.", tone: "red" };
  if (runtime.conflictCount > 0) return { heading: "Some actions need review", body: "Saved clock actions are safe, but this synchronisation issue needs manager review.", tone: "amber" };
  if (connection === "synchronising") return { heading: "Updating Staff Clock", body: "Saved actions are being synchronised.", tone: "amber" };
  if (connection === "sync_problem") return { heading: "Connection problem", body: "Saved actions remain on this device. Reconnect or ask a manager for help.", tone: "amber" };
  if (connection === "offline") return { heading: "Offline mode", body: "Clock actions will save on this device and synchronise when it reconnects.", tone: "amber" };
  if (runtime.lifecycle === "expiring") return { heading: "Reconnect soon", body: "Staff Clock is working, but this device should reconnect soon.", tone: "amber" };
  if (runtime.pendingCount > 0) return { heading: "Waiting to synchronise", body: `${runtime.pendingCount} saved action${runtime.pendingCount === 1 ? " is" : "s are"} waiting to synchronise.`, tone: "amber" };
  return { heading: "Online and ready", body: "Staff can clock in or out.", tone: "green" };
}
