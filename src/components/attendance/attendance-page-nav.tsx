import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import type { AttendanceManagerView } from "@/lib/attendance/manager-view";

type AttendancePageNavProps = {
  activeView: AttendanceManagerView;
  date?: string;
  day?: string;
  staffId?: string;
  hoursFrom?: string;
  hoursTo?: string;
};

const views = [
  { id: "needs-attention", label: "Needs attention" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "hours", label: "Staff hours" },
  { id: "history", label: "Clocking history" },
] as const;

export function attendanceViewHref(
  view: Exclude<AttendanceManagerView, "add-event">,
  parameters: Omit<AttendancePageNavProps, "activeView">,
) {
  const search = new URLSearchParams({ view });
  if (view === "needs-attention" && parameters.date) search.set("date", parameters.date);
  if (view === "hours") {
    if (parameters.day) search.set("day", parameters.day);
    if (parameters.staffId) search.set("staffId", parameters.staffId);
    if (parameters.hoursFrom) search.set("hoursFrom", parameters.hoursFrom);
    if (parameters.hoursTo) search.set("hoursTo", parameters.hoursTo);
  }
  return `/attendance?${search.toString()}`;
}

export function AttendancePageNav({
  activeView,
  date,
  day,
  staffId,
  hoursFrom,
  hoursTo,
}: AttendancePageNavProps) {
  const parameters = { date, day, staffId, hoursFrom, hoursTo };
  return (
    <ManagerPageNav
      label="Attendance sections"
      activeId={activeView === "add-event" ? "" : activeView}
      items={views.map((view) => ({
        ...view,
        href: attendanceViewHref(view.id, parameters),
      }))}
    />
  );
}
