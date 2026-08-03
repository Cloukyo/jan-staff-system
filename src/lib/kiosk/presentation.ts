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
