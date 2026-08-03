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

function parseSingleSearchParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseAttendancePageSearchParams(searchParams: Record<string, unknown>) {
  const viewValue = parseSingleSearchParam(searchParams.view);
  return {
    view: parseAttendanceManagerView(viewValue),
    date: parseSingleSearchParam(searchParams.date),
    day: parseSingleSearchParam(searchParams.day),
    staffId: parseSingleSearchParam(searchParams.staffId),
    staffIdProvided: Object.prototype.hasOwnProperty.call(searchParams, "staffId"),
    hoursFrom: parseSingleSearchParam(searchParams.hoursFrom),
    hoursTo: parseSingleSearchParam(searchParams.hoursTo),
  };
}
