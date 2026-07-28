export type AttendanceManagerView =
  | "needs-attention"
  | "today"
  | "yesterday"
  | "hours"
  | "add-event"
  | "history";

const attendanceViews = new Set<AttendanceManagerView>([
  "needs-attention",
  "today",
  "yesterday",
  "hours",
  "add-event",
  "history",
]);

export function parseAttendanceManagerView(value?: string): AttendanceManagerView {
  return attendanceViews.has(value as AttendanceManagerView)
    ? (value as AttendanceManagerView)
    : "needs-attention";
}
