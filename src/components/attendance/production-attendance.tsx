"use client";

import { useActionState, useMemo, useState } from "react";
import { addClockCorrectionAction } from "@/lib/kiosk/actions";
import type { KioskActionResult } from "@/lib/kiosk/types";
import type { ManagerClockEvent, ManagerKioskRow } from "@/lib/kiosk/server";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatHours, formatTimeUk } from "@/lib/dates/format";
import type {
  AttendanceReviewRow,
  ManagerHoursPreview,
} from "@/lib/attendance/review-server";

const initial: KioskActionResult = { ok: false, code: "idle", message: "" };

export function buildAttendanceTodayGroups(
  staff: ManagerKioskRow[],
  rows: AttendanceReviewRow[],
) {
  return {
    clockedIn: staff.filter((person) => person.currentStatus === "clocked_in"),
    scheduledNotClockedIn: rows.filter(
      (row) => Boolean(row.scheduledStart) && !row.firstClockIn,
    ),
    missingClockOuts: rows.filter(
      (row) => Boolean(row.firstClockIn) && !row.finalClockOut,
    ),
  };
}

export function AttendanceToday({
  staff,
  rows,
}: {
  staff: ManagerKioskRow[];
  rows: AttendanceReviewRow[];
}) {
  const groups = buildAttendanceTodayGroups(staff, rows);
  return (
    <div className="grid gap-4">
      <Panel>
        <h2 className="text-xl font-black text-purple-950">Currently clocked in</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {groups.clockedIn.length
            ? groups.clockedIn.map((person) => (
              <StatusPill key={person.staffId} tone="green">
                {person.displayName}
              </StatusPill>
            ))
            : <p className="text-sm text-slate-600">No staff are currently clocked in.</p>}
        </div>
      </Panel>
      <Panel>
        <h2 className="text-xl font-black text-purple-950">Scheduled but not clocked in</h2>
        <div className="mt-4 grid gap-2">
          {groups.scheduledNotClockedIn.length
            ? groups.scheduledNotClockedIn.map((row) => (
              <p key={row.staffId} className="text-sm text-slate-700">
                <strong className="text-purple-950">{row.fullName}</strong>
                {row.scheduledStart ? `, due at ${row.scheduledStart}` : ""}
              </p>
            ))
            : <p className="text-sm text-slate-600">Everyone scheduled today has clocked in.</p>}
        </div>
      </Panel>
      <Panel>
        <h2 className="text-xl font-black text-purple-950">Missing clock-outs</h2>
        <div className="mt-4 grid gap-2">
          {groups.missingClockOuts.length
            ? groups.missingClockOuts.map((row) => (
              <p key={row.staffId} className="text-sm text-slate-700">
                <strong className="text-purple-950">{row.fullName}</strong>
                {row.firstClockIn
                  ? `, clocked in at ${formatTimeUk(row.firstClockIn)}`
                  : ""}
              </p>
            ))
            : <p className="text-sm text-slate-600">No clock-outs are missing today.</p>}
        </div>
      </Panel>
    </div>
  );
}

export function filterAndPaginateAttendanceHistory(
  staff: ManagerKioskRow[],
  events: ManagerClockEvent[],
  query: string,
  requestedPage: number,
  pageSize = 25,
) {
  const staffNames = new Map(
    staff.map((person) => [person.staffId, person.fullName]),
  );
  const normalisedQuery = query.trim().toLowerCase();
  const filtered = events.filter((event) => {
    if (!normalisedQuery) return true;
    const eventLabel = event.eventType === "clock_in" ? "clock in" : "clock out";
    const sourceLabel = event.managerCorrection
      ? "manager correction"
      : event.eventSource === "manager"
        ? "manager"
        : "kiosk";
    const searchable = [
      staffNames.get(event.staffId) ?? "Unknown staff",
      eventLabel,
      sourceLabel,
      event.correctionReason ?? "",
      event.recordedDate,
      formatDateUk(event.eventTimestamp),
      formatTimeUk(event.eventTimestamp),
    ].join(" ").toLowerCase();
    return searchable.includes(normalisedQuery);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return {
    events: filtered.slice(start, start + pageSize),
    page,
    totalPages,
    totalItems: filtered.length,
  };
}

export function AttendanceHistory({ staff, events }: { staff: ManagerKioskRow[]; events: ManagerClockEvent[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const result = useMemo(
    () => filterAndPaginateAttendanceHistory(staff, events, query, page),
    [events, page, query, staff],
  );
  return (
    <Panel>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-purple-950">Clocking history</h2>
          <p className="mt-1 text-sm text-slate-600">Original clock records are unchanged. Manager corrections are identified below.</p>
        </div>
        <label className="grid w-full gap-1 text-sm font-semibold text-purple-950 sm:w-72">
          <span>Search history</span>
          <input
            className={inputClassName()}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Staff, event, date or reason"
          />
        </label>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Event</th><th className="p-2">Time</th><th className="p-2">Source</th><th className="p-2">Reason</th></tr></thead>
          <tbody>{result.events.map((event) => {
            const person = staff.find((item) => item.staffId === event.staffId);
            return <tr key={event.id} className="border-b border-purple-50"><td className="p-2 font-bold">{person?.fullName ?? "Unknown staff"}</td><td className="p-2">{event.eventType === "clock_in" ? "Clock in" : "Clock out"}</td><td className="p-2">{formatDateUk(event.eventTimestamp)} {formatTimeUk(event.eventTimestamp)}</td><td className="p-2">{event.managerCorrection ? <StatusPill tone="purple">Manager correction</StatusPill> : "Kiosk"}</td><td className="p-2">{event.correctionReason ?? ""}</td></tr>;
          })}</tbody>
        </table>
        {!result.totalItems ? <p className="mt-3 text-sm text-slate-600">No clocking records match this search.</p> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Page {result.page} of {result.totalPages}, {result.totalItems} records
        </p>
        <div className="flex gap-2">
          <button className="min-h-11 rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 disabled:opacity-50" type="button" disabled={result.page === 1} onClick={() => setPage(result.page - 1)}>Previous</button>
          <button className="min-h-11 rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 disabled:opacity-50" type="button" disabled={result.page === result.totalPages} onClick={() => setPage(result.page + 1)}>Next</button>
        </div>
      </div>
    </Panel>
  );
}

export function AttendanceHoursSummary({ hoursPreview }: { hoursPreview: ManagerHoursPreview }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-purple-950">Staff hours summary</h2>
          <p className="mt-2 text-sm text-slate-600">Completed clock-in to clock-out time for each staff member in the selected range.</p>
        </div>
        <a
          className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200"
          href={`/attendance?view=hours&hoursFrom=${hoursPreview.currentWeekStart}&hoursTo=${hoursPreview.currentWeekEnd}`}
        >
          Current work week
        </a>
      </div>
      <form className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="get">
        <input type="hidden" name="view" value="hours" />
        <Field label="Start date"><input className={inputClassName()} name="hoursFrom" type="date" defaultValue={hoursPreview.rangeStart} required /></Field>
        <Field label="End date"><input className={inputClassName()} name="hoursTo" type="date" defaultValue={hoursPreview.rangeEnd} required /></Field>
        <button className="min-h-11 self-end rounded-lg bg-purple-700 px-5 font-bold text-white" type="submit">Update summary</button>
      </form>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Completed hours</th><th className="p-2">Current shift</th></tr></thead>
          <tbody>{hoursPreview.rows.map((row) => (
            <tr key={row.staffId} className="border-b border-purple-50">
              <td className="p-2 font-bold">{row.fullName}</td>
              <td className="p-2">{formatHours(row.completedMinutes)}</td>
              <td className="p-2">{row.openShiftCount > 0 ? "In progress, not included" : "None"}</td>
            </tr>
          ))}</tbody>
        </table>
        {!hoursPreview.rows.length ? <p className="mt-3 text-sm text-slate-600">No active staff found. The selected range has 0 logged hours.</p> : null}
      </div>
    </Panel>
  );
}

export function AttendanceCorrectionForm({ staff }: { staff: ManagerKioskRow[] }) {
  return (
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Add a missing clock-in or clock-out</h2>
      <p className="mt-2 text-sm text-slate-600">This adds a separate manager correction. Original kiosk records are never overwritten.</p>
      <CorrectionForm>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Staff member"><select className={inputClassName()} name="staffId" required>{staff.map((person) => <option key={person.staffId} value={person.staffId}>{person.fullName}</option>)}</select></Field>
          <Field label="Clock event"><select className={inputClassName()} name="eventType"><option value="clock_in">Clock in</option><option value="clock_out">Clock out</option></select></Field>
          <Field label="Date and time"><input className={inputClassName()} name="eventTimestamp" type="datetime-local" required /></Field>
          <Field label="Reason for correction"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
        </div>
      </CorrectionForm>
    </Panel>
  );
}

function CorrectionForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState(addClockCorrectionAction, initial);
  return (
    <form action={action}>
      {children}
      <button className="mt-4 min-h-11 rounded-lg bg-purple-700 px-4 font-bold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "Saving" : "Add correction"}</button>
      {state.message && <p className={`mt-3 text-sm font-bold ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
