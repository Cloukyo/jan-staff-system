"use client";

import { useMemo, useState } from "react";
import type { ManagerClockEvent, ManagerKioskRow } from "@/lib/kiosk/server";
import {
  MissingEventCorrectionForm,
  type CorrectionFormAction,
} from "@/components/attendance/attendance-correction-controls";
import { Button, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";
import type { AttendanceReviewRow } from "@/lib/attendance/review-server";
import type { MissingEventPage } from "@/lib/attendance/staff-hours";

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
      (row) => row.exceptions.includes("Missing clock-out"),
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
    const eventLabel = event.eventType === "clock_in"
      ? "clock in"
      : event.eventType === "clock_out"
        ? "clock out"
        : "excluded event";
    const sourceLabel = event.eventSource === "manager_correction"
      ? "manager correction"
      : event.eventSource === "manager"
        ? "legacy manager event"
        : "kiosk";
    const searchable = [
      staffNames.get(event.staffId) ?? "Unknown staff",
      event.recordType,
      eventLabel,
      sourceLabel,
      event.auditStatus,
      event.correctionKind ?? "",
      event.correctionReason ?? "",
      event.createdByName ?? "",
      event.recordedDate,
      formatDateUk(event.recordedDate),
      event.eventTimestamp ? formatDateUk(event.eventTimestamp) : "",
      event.eventTimestamp ? formatTimeUk(event.eventTimestamp) : "",
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
          <thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Record</th><th className="p-2">Event time</th><th className="p-2">Added</th><th className="p-2">Source and status</th><th className="p-2">Reason</th></tr></thead>
          <tbody>{result.events.map((event) => {
            const person = staff.find((item) => item.staffId === event.staffId);
            const eventText = event.eventType === "clock_in"
              ? "Clock in"
              : event.eventType === "clock_out"
                ? "Clock out"
                : "Excluded event";
            const sourceText = event.eventSource === "manager_correction"
              ? "Manager correction"
              : event.eventSource === "manager"
                ? "Legacy manager event"
                : "Kiosk";
            return <tr key={`${event.recordType}-${event.id}`} className="border-b border-purple-50">
              <td className="p-2 font-bold">{person?.fullName ?? "Unknown staff"}</td>
              <td className="p-2"><strong>{event.recordType === "original" ? "Original" : "Correction"}</strong><br />{eventText}{event.correctionKind ? `, ${event.correctionKind}` : ""}</td>
              <td className="p-2">{formatDateUk(event.recordedDate)}{event.eventTimestamp ? <> {formatTimeUk(event.eventTimestamp)}</> : <><br /><span className="text-xs text-slate-600">No effective event time</span></>}</td>
              <td className="p-2">{formatDateUk(event.createdAt)} {formatTimeUk(event.createdAt)}</td>
              <td className="p-2"><StatusPill tone={event.auditStatus === "active" ? "green" : "purple"}>{sourceText}, {event.auditStatus}</StatusPill>{event.createdByName ? <span className="mt-1 block text-xs text-slate-600">{event.createdByName}</span> : null}</td>
              <td className="p-2">{event.correctionReason ?? ""}</td>
            </tr>;
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

export function AttendanceCorrectionForm({
  data,
  action,
  returnTo,
}: {
  data: MissingEventPage;
  action: CorrectionFormAction | null;
  returnTo: string;
}) {
  return (
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Add a missing clock-in or clock-out</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(10rem,14rem)_auto] sm:items-end" method="get">
        <input name="view" type="hidden" value="add-event" />
        <Field label="Staff member">
          <select className={inputClassName()} defaultValue={data.selectedStaffId ?? ""} name="staffId" required>
            <option value="" disabled>Choose staff</option>
            {data.staff.map((person) => (
              <option key={person.staffId} value={person.staffId}>{person.fullName}</option>
            ))}
          </select>
        </Field>
        <Field label="Attendance date">
          <input className={inputClassName()} defaultValue={data.date} name="date" type="date" required />
        </Field>
        <Button type="submit" variant="secondary">Review day</Button>
      </form>

      {data.day && action ? (
        <div className="mt-5 border-t border-purple-100 pt-4">
          <h3 className="text-base font-black text-purple-950">{data.day.fullName}, {formatDateUk(data.day.date)}</h3>
          <p className="mt-1 text-sm text-slate-700">
            Current effective sequence: {data.day.effectiveEvents.length
              ? data.day.effectiveEvents.map((event) => `${formatTimeUk(event.eventTimestamp)} ${event.eventType === "clock_in" ? "clock in" : "clock out"}`).join(", ")
              : "No clock events"}
          </p>
          <MissingEventCorrectionForm day={data.day} returnTo={returnTo} action={action} />
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-600">Choose a staff member and date to review the day.</p>
      )}
    </Panel>
  );
}
