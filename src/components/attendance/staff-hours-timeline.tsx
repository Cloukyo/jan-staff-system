import { randomUUID } from "node:crypto";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import Link from "next/link";
import { AttendanceCorrectionControls } from "@/components/attendance/attendance-correction-controls";
import { AttendanceDayDisclosure } from "@/components/attendance/attendance-day-disclosure";
import { EmptyState, Panel, StatusPill } from "@/components/ui/primitives";
import {
  removeBoundClockEventAction,
  resetBoundAttendanceToPlannedHoursAction,
  saveBoundClockEventCorrectionAction,
} from "@/lib/attendance/correction-actions";
import { buildAttendanceDayReturnTo } from "@/lib/attendance/day-route";
import { getPlannedHoursBoundaries } from "@/lib/attendance/planned-hours-boundaries";
import {
  buildAttendanceTimelineWindow,
  layoutAttendanceTimelineEvents,
  timelinePositionPercent,
  type AttendanceTimelineWindow,
  type AttendanceTimelineEventPlacement,
} from "@/lib/attendance/timeline-layout";
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

function formatTimelineMinute(minutes: number): string {
  if (minutes === 24 * 60) return "24:00";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function TimelineGrid({ window }: { window: AttendanceTimelineWindow }) {
  return window.ticks.map((tick) => (
    <span
      aria-hidden
      className="absolute inset-y-0 border-l border-slate-200"
      key={tick}
      style={{ left: `${timelinePositionPercent(tick, window)}%` }}
    />
  ));
}

function TimelineLane({ label, children, height = 72 }: { label: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-4">
      <p className="text-sm font-bold text-slate-800">{label}</p>
      <div className="relative min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

function TimelineEventMarker({
  eventType,
  eventTimestamp,
  detail,
  tone,
  placement,
}: {
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  detail: string;
  tone: "original" | "effective" | "replaced";
  placement: AttendanceTimelineEventPlacement;
}) {
  const position = placement.positionPercent;
  const edgeClass = position < 8
    ? "translate-x-0 text-left"
    : position > 92
      ? "-translate-x-full text-right"
      : "-translate-x-1/2 text-center";
  const markerClass = tone === "replaced"
    ? "border-red-500 bg-red-50 text-red-800"
    : tone === "effective"
      ? "border-green-600 bg-green-50 text-green-900"
      : "border-amber-500 bg-amber-50 text-amber-950";

  return (
    <div className="absolute inset-y-0" style={{ left: `${position}%` }}>
      <span aria-hidden className={`absolute inset-y-0 border-l-2 ${tone === "effective" ? "border-green-500" : tone === "replaced" ? "border-red-400 border-dashed" : "border-amber-400"}`} />
      <span className={`absolute z-10 w-max max-w-36 rounded border px-2 py-1 text-xs leading-tight ${edgeClass} ${markerClass}`} style={{ top: 8 + (placement.row * 46) }}>
        <strong>{formatTimeUk(eventTimestamp)} {eventType === "clock_in" ? "In" : "Out"}</strong>
        <span className="block font-medium">{detail}</span>
      </span>
    </div>
  );
}

function AttendanceTimeline({ day }: { day: StaffHoursDay }) {
  const window = buildAttendanceTimelineWindow({
    plannedPeriods: day.plannedPeriods,
    eventTimestamps: [
      ...day.audit.originals.map((event) => event.eventTimestamp),
      ...day.effectiveEvents.map((event) => event.eventTimestamp),
    ],
  });
  const originalPlacements = layoutAttendanceTimelineEvents(
    day.audit.originals.map((event) => event.eventTimestamp),
    window,
  );
  const effectivePlacements = layoutAttendanceTimelineEvents(
    day.effectiveEvents.map((event) => event.eventTimestamp),
    window,
  );
  const markerLaneHeight = (placements: AttendanceTimelineEventPlacement[]) => (
    Math.max(72, ((Math.max(-1, ...placements.map((placement) => placement.row)) + 1) * 46) + 16)
  );

  return (
    <section className="mt-5 hidden md:block" aria-label="Attendance timeline">
      <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-end gap-4">
        <p className="text-xs font-bold uppercase text-slate-500">Day timeline</p>
        <div className="relative h-6">
          {window.ticks.map((tick) => {
            const position = timelinePositionPercent(tick, window);
            const edgeClass = position === 0 ? "" : position === 100 ? "-translate-x-full" : "-translate-x-1/2";
            return <span className={`absolute text-xs font-semibold text-slate-500 ${edgeClass}`} key={tick} style={{ left: `${position}%` }}>{formatTimelineMinute(tick)}</span>;
          })}
        </div>
      </div>
      <div className="grid gap-3">
        <TimelineLane label="Planned rota">
          <TimelineGrid window={window} />
          {day.plannedPeriods.length ? day.plannedPeriods.map((period) => {
            const start = timelinePositionPercent(Number(period.startTime.slice(0, 2)) * 60 + Number(period.startTime.slice(3, 5)), window);
            const end = timelinePositionPercent(Number(period.endTime.slice(0, 2)) * 60 + Number(period.endTime.slice(3, 5)), window);
            return (
              <span
                className="absolute top-5 flex h-8 items-center justify-center overflow-hidden rounded bg-purple-100 px-2 text-xs font-bold text-purple-950 ring-1 ring-inset ring-purple-300"
                key={period.id}
                style={{ left: `${start}%`, width: `${Math.max(1, end - start)}%` }}
                title={`${period.startTime} to ${period.endTime}`}
              >
                {period.startTime} to {period.endTime}
              </span>
            );
          }) : <span className="absolute inset-0 flex items-center px-3 text-sm text-slate-500">No published rota shift</span>}
        </TimelineLane>
        <TimelineLane label="Original kiosk events" height={markerLaneHeight(originalPlacements)}>
          <TimelineGrid window={window} />
          {day.audit.originals.length ? day.audit.originals.map((event, index) => (
            <TimelineEventMarker
              detail={event.status === "active" ? event.sourceLabel : `Original, ${event.status}`}
              eventTimestamp={event.eventTimestamp}
              eventType={event.eventType}
              key={event.id}
              placement={originalPlacements[index]}
              tone={event.status === "active" ? "original" : "replaced"}
            />
          )) : <span className="absolute inset-0 flex items-center px-3 text-sm text-slate-500">No original clock events</span>}
        </TimelineLane>
        <TimelineLane label="Hours after corrections" height={markerLaneHeight(effectivePlacements)}>
          <TimelineGrid window={window} />
          {day.effectiveEvents.length ? day.effectiveEvents.map((event, index) => (
            <TimelineEventMarker
              detail={event.source === "kiosk" ? "Kiosk" : "Manager correction"}
              eventTimestamp={event.eventTimestamp}
              eventType={event.eventType}
              key={event.id}
              placement={effectivePlacements[index]}
              tone="effective"
            />
          )) : <span className="absolute inset-0 flex items-center px-3 text-sm text-slate-500">No events used for hours</span>}
        </TimelineLane>
      </div>
    </section>
  );
}

function MobileAttendanceTable({ day }: { day: StaffHoursDay }) {
  return (
    <div className="mt-5 md:hidden">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="mb-2 text-left text-sm font-bold text-slate-800">Attendance records</caption>
        <thead>
          <tr className="border-b border-slate-300 text-xs uppercase text-slate-500">
            <th className="w-[28%] py-2 pr-2">Record</th>
            <th className="w-[32%] px-2 py-2">Event</th>
            <th className="w-[40%] py-2 pl-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {day.plannedPeriods.map((period) => (
            <tr key={period.id} className="border-b border-slate-200 align-top">
              <td className="break-words py-3 pr-2 font-semibold">Planned</td>
              <td className="break-words px-2 py-3">{period.startTime}<br />to {period.endTime}</td>
              <td className="break-words py-3 pl-2 text-slate-600">Published rota</td>
            </tr>
          ))}
          {day.audit.originals.map((event) => (
            <tr key={event.id} className="border-b border-slate-200 align-top">
              <td className="break-words py-3 pr-2 font-semibold">Original</td>
              <td className="break-words px-2 py-3">{eventLabel(event.eventType)}<br /><strong>{formatTimeUk(event.eventTimestamp)}</strong></td>
              <td className="break-words py-3 pl-2 text-slate-600">{event.status === "active" ? event.sourceLabel : `Original, ${event.status}`}</td>
            </tr>
          ))}
          {day.effectiveEvents.map((event) => (
            <tr key={event.id} className="border-b border-slate-200 align-top">
              <td className="break-words py-3 pr-2 font-semibold">Used for hours</td>
              <td className="break-words px-2 py-3">{eventLabel(event.eventType)}<br /><strong>{formatTimeUk(event.eventTimestamp)}</strong></td>
              <td className="break-words py-3 pl-2 text-slate-600">{event.source === "kiosk" ? "Kiosk" : "Manager correction"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StaffHoursDayDetail({ day, from, to }: { day: StaffHoursDay; from: string; to: string }) {
  const correctionCount = day.audit.corrections.length;
  const correctionId = randomUUID();
  const returnTo = buildAttendanceDayReturnTo({ staffId: day.staffId, from, to, day: day.date });
  const plannedBoundaries = getPlannedHoursBoundaries(day.plannedPeriods);
  const context = {
    staffId: day.staffId,
    attendanceDate: day.date,
    correctionId,
    returnTo,
    eventRevision: day.eventRevision,
    plannedStart: plannedBoundaries?.plannedStart,
    plannedFinish: plannedBoundaries?.plannedFinish,
  };
  const manualAction = saveBoundClockEventCorrectionAction.bind(null, context);
  const removeAction = removeBoundClockEventAction.bind(null, context);
  const resetAction = resetBoundAttendanceToPlannedHoursAction.bind(null, context);
  return (
    <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-5 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-purple-950">{formatDateUk(day.date)}</h3>
          <p className="mt-1 text-sm text-slate-700">Completed time: <strong>{formatHours(day.completedMinutes)}</strong>{day.hasOpenShift ? ". An open shift is not included." : ""}</p>
        </div>
        {day.review ? <StatusPill tone="purple">{day.review.status.replaceAll("_", " ")}</StatusPill> : null}
      </div>

      {day.warnings.length ? <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-3 text-sm font-bold text-amber-950" role="alert"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />Needs attention: {day.warnings.map(warningLabel).join("; ")}</p> : <p className="mt-4 text-sm font-semibold text-green-800">No attendance warnings for this day.</p>}

      <AttendanceTimeline day={day} />
      <MobileAttendanceTable day={day} />

      <p className="mt-4 text-sm text-slate-700" data-attendance-mutation-slot="day-detail">Original clock events are read-only. {correctionCount ? `${correctionCount} manager correction${correctionCount === 1 ? " is" : "s are"} shown separately.` : ""}</p>
      <AttendanceCorrectionControls day={day} correctionId={correctionId} returnTo={returnTo} manualAction={manualAction} removeAction={removeAction} resetAction={resetAction} />
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
