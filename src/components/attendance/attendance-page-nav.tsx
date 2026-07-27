import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import type { AttendanceManagerView } from "@/lib/attendance/manager-view";

type AttendancePageNavProps = {
  activeView: AttendanceManagerView;
  date?: string;
  hoursFrom?: string;
  hoursTo?: string;
};

const views = [
  { id: "needs-attention", label: "Needs attention" },
  { id: "today", label: "Today" },
  { id: "hours", label: "Hours summary" },
  { id: "history", label: "Clocking history" },
] as const;

function attendanceViewHref(
  view: Exclude<AttendanceManagerView, "add-event">,
  parameters: Omit<AttendancePageNavProps, "activeView">,
) {
  const search = new URLSearchParams({ view });
  if (parameters.date) search.set("date", parameters.date);
  if (parameters.hoursFrom) search.set("hoursFrom", parameters.hoursFrom);
  if (parameters.hoursTo) search.set("hoursTo", parameters.hoursTo);
  return `/attendance?${search.toString()}`;
}

export function AttendancePageNav({
  activeView,
  date,
  hoursFrom,
  hoursTo,
}: AttendancePageNavProps) {
  const parameters = { date, hoursFrom, hoursTo };
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
