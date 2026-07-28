import { AttendanceScreen } from "@/components/attendance/attendance-screen";
import { AttendanceReview } from "@/components/attendance/attendance-review";
import { AttendancePageNav } from "@/components/attendance/attendance-page-nav";
import {
  AttendanceCorrectionForm,
  AttendanceHistory,
  AttendanceToday,
} from "@/components/attendance/production-attendance";
import { StaffHoursList } from "@/components/attendance/staff-hours-list";
import { StaffHoursNotFound, StaffHoursTimeline, YesterdayAttendance } from "@/components/attendance/staff-hours-timeline";
import { ManagerHelpLink } from "@/components/help/manager-help-link";
import { AppShell } from "@/components/layout/app-shell";
import Link from "next/link";
import { ClockPlus } from "lucide-react";
import { getAppMode } from "@/lib/app-mode";
import { parseAttendanceManagerView } from "@/lib/attendance/manager-view";
import { requireAccount } from "@/lib/auth/permissions";
import { isoDateInLondon } from "@/lib/dates/format";
import { loadManagerAttendance } from "@/lib/kiosk/server";
import { loadAttendanceReviewDay } from "@/lib/attendance/review-server";
import { loadAttendanceDay, loadStaffHoursList, loadStaffHoursWeek, previousLondonDate } from "@/lib/attendance/staff-hours";

export const dynamic = "force-dynamic";

type AttendanceSearchParams = {
  view?: string;
  date?: string;
  day?: string;
  staffId?: string;
  hoursFrom?: string;
  hoursTo?: string;
};

export default async function AttendancePage({ searchParams }: { searchParams: Promise<AttendanceSearchParams> }) {
  if (getAppMode() === "demo") return <AttendanceScreen />;
  await requireAccount(["manager"]);
  const { view: viewValue, date, day, staffId, hoursFrom, hoursTo } = await searchParams;
  const view = parseAttendanceManagerView(viewValue);
  const yesterdayDate = previousLondonDate();
  const dataset = view === "today" || view === "add-event" || view === "history"
    ? await loadManagerAttendance()
    : null;
  const review = view === "needs-attention"
    ? await loadAttendanceReviewDay(date)
    : view === "today"
      ? await loadAttendanceReviewDay(isoDateInLondon())
      : null;
  const yesterday = view === "yesterday" ? await loadAttendanceDay(yesterdayDate) : null;
  const staffHoursList = view === "hours" && !staffId ? await loadStaffHoursList(hoursFrom, hoursTo) : null;
  const staffHoursWeek = view === "hours" && staffId ? await loadStaffHoursWeek(staffId, hoursFrom, hoursTo) : null;
  return (
    <AppShell>
      <div className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-purple-950">Clock-ins &amp; hours</h1>
            <p className="mt-2 text-slate-600">Fix missing clock events, review exceptions and check staff hours.</p>
          </div>
          <Link className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href="/settings/kiosk">
            Clocking-in devices
          </Link>
        </div>
        <div className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <Link
            href="/attendance?view=add-event"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-purple-700 px-5 text-sm font-bold text-white hover:bg-purple-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 sm:w-auto"
          >
            <ClockPlus aria-hidden className="h-5 w-5" />
            Add a missing clock-in or clock-out
          </Link>
          <ManagerHelpLink taskId="add-missing-clock-event" />
        </div>
      </div>

      <AttendancePageNav
        activeView={view}
        date={date}
        day={day}
        staffId={staffId}
        hoursFrom={hoursFrom}
        hoursTo={hoursTo}
      />

      <div className="mt-5">
        {view === "needs-attention" && review ? <AttendanceReview data={review} /> : null}
        {view === "today" && dataset && review ? <AttendanceToday staff={dataset.staff} rows={review.rows} /> : null}
        {view === "yesterday" && yesterday ? <YesterdayAttendance data={yesterday} /> : null}
        {view === "hours" && staffHoursList ? <StaffHoursList data={staffHoursList} /> : null}
        {view === "hours" && staffHoursWeek ? <StaffHoursTimeline data={staffHoursWeek} selectedDay={day} /> : null}
        {view === "hours" && staffId && !staffHoursWeek ? <StaffHoursNotFound /> : null}
        {view === "add-event" && dataset ? <AttendanceCorrectionForm staff={dataset.staff} /> : null}
        {view === "history" && dataset ? <AttendanceHistory staff={dataset.staff} events={dataset.events} /> : null}
      </div>
    </AppShell>
  );
}
