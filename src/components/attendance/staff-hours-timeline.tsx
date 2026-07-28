import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import Link from "next/link";
import { AttendanceCorrectionControls } from "@/components/attendance/attendance-correction-controls";
import { AttendanceDayDisclosure } from "@/components/attendance/attendance-day-disclosure";
import { EmptyState, Panel, StatusPill } from "@/components/ui/primitives";
import {
  saveBoundClockEventCorrectionAction,
  useBoundPlannedHoursAction,
} from "@/lib/attendance/correction-actions";
import { buildAttendanceDayReturnTo } from "@/lib/attendance/day-route";
import { formatDateUk, formatHours, formatTimeUk } from "@/lib/dates/format";
import type { AttendanceWarning } from "@/lib/attendance/sequence";
import type { AttendanceDay, StaffHoursDay, StaffHoursWeek } from "@/lib/attendance/staff-hours";

function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function hoursHref(from: string, to: string, staffId: string): string {
  return `/attendance?${new URLSearchParams({ view: "hours", hoursFrom: from, hoursTo: to, staffId }).toString()}`;
}

function warningLabel(warning: AttendanceWarning): string {
  const labels: Record<AttendanceWarning, string> = {
    missing_clock_in: "Missing clock-in",
    missing_clock_out: "Missing clock-out",
    clock_out_before_clock_in: "Clock-out before clock-in",
    duplicate_clock_in: "Duplicate clock-in",
    duplicate_clock_out: "Duplicate clock-out",
    events_wrong_order: "Events are in the wrong order",
    no_planned_shift: "Clock event without a published rota shift",
  };
  return labels[warning];
}

function eventLabel(eventType: "clock_in" | "clock_out" | null): string {
  if (!eventType) return "Removed event";
  return eventType === "clock_in" ? "Clock in" : "Clock out";
}

function plannedPeriodsText(day: StaffHoursDay): string {
  return day.plannedPeriods.length
    ? day.plannedPeriods.map((period) => `${period.startTime} to ${period.endTime}`).join(", ")
    : "No published rota shift";
}

function EventLane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
      <p className="text-sm font-bold text-purple-950">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function StaffHoursDayDetail({ day, from, to }: { day: StaffHoursDay; from: string; to: string }) {
  const correctionCount = day.audit.corrections.length;
  const returnTo = buildAttendanceDayReturnTo({ staffId: day.staffId, from, to, day: day.date });
  const context = { staffId: day.staffId, attendanceDate: day.date, returnTo };
  const manualAction = saveBoundClockEventCorrectionAction.bind(null, context);
  const plannedHoursAction = useBoundPlannedHoursAction.bind(null, context);
  return (
    <div className="border-t-4 border-amber-500 bg-amber-50/40 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-purple-950">{formatDateUk(day.date)}</h3>
          <p className="mt-1 text-sm text-slate-700">Completed time: <strong>{formatHours(day.completedMinutes)}</strong>{day.hasOpenShift ? ". An open shift is not included." : ""}</p>
        </div>
        {day.review ? <StatusPill tone="purple">{day.review.status.replaceAll("_", " ")}</StatusPill> : null}
      </div>

      {day.warnings.length ? <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-3 text-sm font-bold text-amber-950" role="alert"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />Needs attention: {day.warnings.map(warningLabel).join("; ")}</p> : <p className="mt-4 text-sm font-semibold text-green-800">No attendance warnings for this day.</p>}

      <div className="mt-4 grid gap-4">
        <EventLane label="Planned rota"><p className="text-sm text-slate-700">{plannedPeriodsText(day)}</p></EventLane>
        <EventLane label="Original events">
          {day.audit.originals.length ? <ol className="flex flex-wrap gap-2">{day.audit.originals.map((event) => <li key={event.id} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-purple-100"><strong>{formatTimeUk(event.eventTimestamp)}</strong> {eventLabel(event.eventType)} <span className="text-slate-600">{event.sourceLabel}{event.status === "active" ? "" : `, ${event.status}`}</span></li>)}</ol> : <p className="text-sm text-slate-600">No original clock events.</p>}
        </EventLane>
        <EventLane label="Effective events">
          {day.effectiveEvents.length ? <ol className="flex flex-wrap gap-2">{day.effectiveEvents.map((event) => <li key={event.id} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-purple-100"><strong>{formatTimeUk(event.eventTimestamp)}</strong> {eventLabel(event.eventType)} <span className="text-slate-600">{event.source === "kiosk" ? "Kiosk" : "Manager correction"}</span></li>)}</ol> : <p className="text-sm text-slate-600">No effective clock events.</p>}
        </EventLane>
      </div>

      <p className="mt-4 text-sm text-slate-700" data-attendance-mutation-slot="day-detail">Original clock events are read-only. {correctionCount ? `${correctionCount} manager correction${correctionCount === 1 ? " is" : "s are"} shown separately.` : ""}</p>
      <AttendanceCorrectionControls day={day} returnTo={returnTo} manualAction={manualAction} plannedHoursAction={plannedHoursAction} />

      <div className="mt-4 overflow-x-auto md:hidden">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">Planned, original and effective attendance events for {formatDateUk(day.date)}</caption>
          <thead><tr className="border-b border-purple-200 text-purple-950"><th className="p-2">Record</th><th className="p-2">Event</th><th className="p-2">Time</th><th className="p-2">Status</th></tr></thead>
          <tbody>
            {day.plannedPeriods.map((period) => <tr key={period.id} className="border-b border-purple-100"><td className="p-2 font-semibold">Planned</td><td className="p-2">Shift</td><td className="p-2">{period.startTime} to {period.endTime}</td><td className="p-2">Published rota</td></tr>)}
            {day.audit.originals.map((event) => <tr key={event.id} className="border-b border-purple-100"><td className="p-2 font-semibold">Original</td><td className="p-2">{eventLabel(event.eventType)}</td><td className="p-2">{formatTimeUk(event.eventTimestamp)}</td><td className="p-2">{event.status}</td></tr>)}
            {day.effectiveEvents.map((event) => <tr key={event.id} className="border-b border-purple-100"><td className="p-2 font-semibold">Effective</td><td className="p-2">{eventLabel(event.eventType)}</td><td className="p-2">{formatTimeUk(event.eventTimestamp)}</td><td className="p-2">{event.source === "kiosk" ? "Kiosk" : "Manager correction"}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayRow({ day, from, to, open }: { day: StaffHoursDay; from: string; to: string; open?: boolean }) {
  const issues = day.warnings.map(warningLabel);
  return (
    <AttendanceDayDisclosure
      day={day.date}
      open={open}
      summary={<summary className="grid min-h-16 cursor-pointer list-none gap-3 py-3 pr-1 marker:hidden sm:grid-cols-[8rem_minmax(10rem,1fr)_10rem_auto] sm:items-center [&::-webkit-details-marker]:hidden">
        <div><p className="font-bold text-purple-950">{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(`${day.date}T12:00:00Z`))}</p><p className="text-xs text-slate-600">{formatDateUk(day.date)}</p></div>
        <p className="text-sm text-slate-700">{issues.length ? <span className="font-bold text-red-700">{issues.join("; ")}</span> : plannedPeriodsText(day)}</p>
        <p className="flex items-center gap-2 text-sm font-bold text-purple-950"><Clock3 className="h-4 w-4" aria-hidden />{formatHours(day.completedMinutes)}</p>
        <span className="inline-flex min-h-11 items-center justify-end text-sm font-bold text-purple-800">Open</span>
      </summary>}
    >
      <StaffHoursDayDetail day={day} from={from} to={to} />
    </AttendanceDayDisclosure>
  );
}

export function StaffHoursTimeline({ data, selectedDay }: { data: StaffHoursWeek; selectedDay?: string }) {
  const previousFrom = shiftIsoDate(data.from, -7);
  const previousTo = shiftIsoDate(data.to, -7);
  const nextFrom = shiftIsoDate(data.from, 7);
  const nextTo = shiftIsoDate(data.to, 7);
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-black text-purple-950">{data.fullName}</h2><p className="mt-1 text-sm text-slate-600">Weekly attendance detail. Original kiosk events remain unchanged.</p></div>
        <Link href={`/attendance?${new URLSearchParams({ view: "hours", hoursFrom: data.from, hoursTo: data.to }).toString()}`} className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50">All staff</Link>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-y border-purple-100 py-3">
        <Link href={hoursHref(previousFrom, previousTo, data.staffId)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50" aria-label="Previous week"><ChevronLeft className="h-5 w-5" aria-hidden /></Link>
        <p className="text-center text-sm font-bold text-purple-950"><CalendarDays className="mr-1 inline h-4 w-4" aria-hidden />{formatDateUk(data.from)} to {formatDateUk(data.to)}</p>
        <Link href={hoursHref(nextFrom, nextTo, data.staffId)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50" aria-label="Next week"><ChevronRight className="h-5 w-5" aria-hidden /></Link>
      </div>
      {data.days.length ? <div className="mt-2">{data.days.map((day) => <DayRow key={day.date} day={day} from={data.from} to={data.to} open={day.date === selectedDay} />)}</div> : <div className="mt-5"><EmptyState title="No attendance activity" body="There are no shifts, original clock events or corrections for this staff member in this range." /></div>}
    </Panel>
  );
}

export function StaffHoursNotFound() {
  return (
    <Panel>
      <EmptyState
        title="Staff member unavailable"
        body="This Staff hours link is no longer available. The staff member may be inactive or the link may be out of date."
      />
      <Link href="/attendance?view=hours" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50">
        Back to Staff hours
      </Link>
    </Panel>
  );
}

export function YesterdayAttendance({ data }: { data: AttendanceDay }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black text-purple-950">Yesterday</h2><p className="mt-1 text-sm text-slate-600">{formatDateUk(data.date)}. Days needing attention are shown first.</p></div><StatusPill tone="grey">{data.rows.length} staff</StatusPill></div>
      {data.rows.length ? <div className="mt-4 border-t border-purple-100">{data.rows.map((day) => <details key={day.staffId} className="border-b border-purple-100"><summary className="grid min-h-16 cursor-pointer list-none gap-3 py-3 pr-1 marker:hidden sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_auto] sm:items-center [&::-webkit-details-marker]:hidden"><div><p className="font-bold text-purple-950">{day.fullName}</p><p className="text-sm text-slate-600">{plannedPeriodsText(day)}</p></div><p className="text-sm font-bold text-red-700">{day.warnings.length ? day.warnings.map(warningLabel).join("; ") : "No attendance warnings"}</p><span className="inline-flex min-h-11 items-center justify-end text-sm font-bold text-purple-800">Open</span></summary><StaffHoursDayDetail day={day} from={data.date} to={data.date} /></details>)}</div> : <div className="mt-5"><EmptyState title="No attendance activity" body="There are no shifts, original clock events or corrections for yesterday." /></div>}
    </Panel>
  );
}
