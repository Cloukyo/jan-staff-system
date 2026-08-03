"use client";

import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import {
  dismissAttendanceExceptionAction,
  resolveAttendanceExceptionAction,
} from "@/lib/attendance/review-actions";
import type { AttendanceExceptionRow } from "@/lib/attendance/exceptions-server";
import { pairAttendanceByOperationalDay } from "@/lib/attendance/pairing";
import { formatDateUk, formatDurationCompact, formatTimeUk } from "@/lib/dates/format";
import type { AttendanceExceptionType, EffectiveAttendanceEvent } from "@/lib/attendance/types";

const issueLabels: Record<AttendanceExceptionType, string> = {
  missing_clock_out: "Missing clock-out",
  missing_clock_in: "Missing clock-in",
  consecutive_clock_in: "Consecutive clock-ins",
  unmatched_clock_out: "Unmatched clock-out",
  overlapping_attendance: "Overlapping or malformed attendance",
  unusually_long_shift: "Unusually long shift",
  offline_sync_conflict: "Offline synchronisation conflict",
  device_clock_drift: "Device clock difference",
  offline_time_uncertain: "Offline time needs review",
};

function localDateTimeValue(value: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function sourceLabel(event: { source: string; kioskDeviceId?: string | null }): string {
  if (event.kioskDeviceId) return `${event.source.replaceAll("_", " ")} | kiosk ${event.kioskDeviceId}`;
  return event.source.replaceAll("_", " ");
}

function elapsedLabel(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function effectiveDuration(events: EffectiveAttendanceEvent[]): number | null {
  const [day] = pairAttendanceByOperationalDay(events);
  return day && day.anomalies.length === 0 ? day.completedMinutes : null;
}

function EventList({ title, events, original = false }: {
  title: string;
  events: Array<{
    eventId?: string; id?: string; eventType: "clock_in" | "clock_out";
    eventTimestamp: string; source: string; kioskDeviceId?: string | null;
  }>;
  original?: boolean;
}) {
  return <div><h4 className="text-sm font-black text-purple-950">{title}</h4>{events.length ? <ul className="mt-2 grid gap-2">{events.map((event) => <li className="rounded-lg bg-slate-50 p-3 text-sm" key={event.eventId ?? event.id}><span className="font-bold">{event.eventType === "clock_in" ? "Clock in" : "Clock out"}</span> at {formatTimeUk(event.eventTimestamp)}<span className="block text-xs text-slate-600">{sourceLabel(event)}{original ? " | immutable original" : ""}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No events recorded.</p>}</div>;
}

function CorrectionForm({ issue, kind, target, label }: {
  issue: AttendanceExceptionRow;
  kind: "add_missing_clock_in" | "add_missing_clock_out" | "correct_clock_in" | "correct_clock_out";
  target?: EffectiveAttendanceEvent;
  label: string;
}) {
  const fallback = `${issue.operationalDate}T${kind.includes("clock_in") ? "08:30" : "17:00"}:00+01:00`;
  const suggested = issue.suggestedResolutionAt ?? fallback;
  return <ProductionActionForm action={resolveAttendanceExceptionAction} submitLabel={label} className="rounded-lg border border-purple-100 p-4">
    <input type="hidden" name="exceptionId" value={issue.id} />
    <input type="hidden" name="staffId" value={issue.staffId} />
    <input type="hidden" name="operationalDate" value={issue.operationalDate} />
    <input type="hidden" name="expectedRevision" value={issue.stateRevision} />
    <input type="hidden" name="resolutionKind" value={kind} />
    <input type="hidden" name="effectiveEventId" value={target?.eventId ?? ""} />
    <input type="hidden" name="originalEventId" value={target?.originalEventId ?? ""} />
    <input type="hidden" name="correctionId" value={target?.correctionId ?? ""} />
    <div className="grid gap-3">
      <Field label="Correction date and time (London)"><input className={inputClassName()} type="datetime-local" name="eventTimestamp" defaultValue={localDateTimeValue(target?.eventTimestamp ?? suggested)} required /></Field>
      {issue.suggestedResolutionAt && !target ? <p className="text-xs font-semibold text-purple-700">Suggested from the published rota: {formatTimeUk(issue.suggestedResolutionAt)}. This is a suggestion, not recorded attendance.</p> : null}
      <Field label="Manager reason"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
    </div>
  </ProductionActionForm>;
}

function IssueCard({ issue }: { issue: AttendanceExceptionRow }) {
  const completedMinutes = effectiveDuration(issue.effectiveEvents);
  const shift = issue.scheduledShifts[0];
  const open = issue.status === "open" || issue.status === "under_review";
  return <Panel>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-xl font-black text-purple-950">{issue.staffName}</h3><p className="mt-1 text-sm text-slate-600">{formatDateUk(issue.operationalDate)} | created <span suppressHydrationWarning>{elapsedLabel(issue.createdAt)}</span></p></div>
      <div className="flex flex-wrap gap-2"><StatusPill tone={open ? "red" : issue.status === "resolved" ? "green" : "grey"}>{issueLabels[issue.type]}</StatusPill><StatusPill tone={open ? "amber" : "grey"}>{issue.status.replaceAll("_", " ")}</StatusPill>{issue.payrollMayBeAffected ? <StatusPill tone="red">Payroll may be affected</StatusPill> : null}</div>
    </div>
    <div className="mt-4 grid gap-2 rounded-lg bg-purple-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <p><span className="block text-xs font-bold uppercase text-slate-500">Scheduled shift</span>{shift ? `${String(shift.start_time).slice(0, 5)} to ${String(shift.end_time).slice(0, 5)}` : "No published shift"}</p>
      <p><span className="block text-xs font-bold uppercase text-slate-500">Effective duration</span>{completedMinutes === null ? "Not safely calculable" : formatDurationCompact(completedMinutes)}</p>
      <p><span className="block text-xs font-bold uppercase text-slate-500">Source</span>{issue.source.replaceAll("_", " ")}</p>
      <p><span className="block text-xs font-bold uppercase text-slate-500">Leave context</span>{issue.leaveContext.length ? "Approved leave recorded" : "None recorded"}</p>
    </div>
    <details className="mt-4 rounded-lg border border-purple-100 p-4" open>
      <summary className="cursor-pointer font-black text-purple-950">Review evidence and audit</summary>
      <div className="mt-4 grid gap-5 md:grid-cols-2"><EventList title="Original evidence" original events={issue.originalEvents} /><EventList title="Current effective ledger" events={issue.effectiveEvents} /></div>
      {issue.corrections.length ? <div className="mt-5"><h4 className="text-sm font-black text-purple-950">Correction history</h4><ul className="mt-2 grid gap-2">{issue.corrections.map((correction) => <li className="rounded-lg bg-purple-50 p-3 text-sm" key={String(correction.id)}>{String(correction.event_type).replaceAll("_", " ")} at {formatTimeUk(String(correction.event_timestamp))}<span className="block text-xs text-slate-600">{String(correction.manager_name)} | {String(correction.reason)}</span></li>)}</ul></div> : null}
      {issue.operationHistory.length ? <div className="mt-5"><h4 className="text-sm font-black text-purple-950">Decision audit</h4><ul className="mt-2 grid gap-2">{issue.operationHistory.map((operation) => <li className="rounded-lg bg-slate-50 p-3 text-sm" key={String(operation.operation_id)}>{String(operation.operation_kind)} by {String(operation.manager_name)}<span className="block text-xs text-slate-600">{String(operation.reason)}</span></li>)}</ul></div> : null}
    </details>
    {open ? <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {issue.type === "missing_clock_out" ? <CorrectionForm issue={issue} kind="add_missing_clock_out" label={issue.suggestedResolutionAt ? "Resolve with this clock-out" : "Add missing clock-out"} /> : null}
      {(issue.type === "missing_clock_in" || issue.type === "unmatched_clock_out") ? <CorrectionForm issue={issue} kind="add_missing_clock_in" label="Add missing clock-in" /> : null}
      {issue.effectiveEvents.map((event) => <CorrectionForm key={event.eventId} issue={issue} target={event} kind={event.eventType === "clock_in" ? "correct_clock_in" : "correct_clock_out"} label={`Correct ${event.eventType === "clock_in" ? "clock-in" : "clock-out"}`} />)}
      <ProductionActionForm action={dismissAttendanceExceptionAction} submitLabel="Mark no correction needed" submitVariant="secondary" className="rounded-lg border border-slate-200 p-4">
        <input type="hidden" name="exceptionId" value={issue.id} /><input type="hidden" name="expectedRevision" value={issue.stateRevision} />
        <Field label="Reason for dismissal"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
        <p className="mt-2 text-xs text-slate-600">This preserves the issue and evidence but does not change worked hours.</p>
      </ProductionActionForm>
    </div> : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">{issue.status === "resolved" ? `Resolved: ${issue.resolutionReason ?? "Reason recorded"}` : `Dismissed: ${issue.dismissalReason ?? "Reason recorded"}`}{issue.reviewingManagerName ? ` | ${issue.reviewingManagerName}` : ""}</p>}
  </Panel>;
}

export function AttendanceExceptions({ issues, filters, staff }: {
  issues: AttendanceExceptionRow[];
  filters: { from: string; to: string; status?: string; type?: string; staffId?: string };
  staff: Array<{ staffId: string; fullName: string }>;
}) {
  return <div className="grid gap-5"><Panel><div><h2 className="text-2xl font-black text-purple-950">Attendance issues</h2><p className="mt-1 text-sm text-slate-600">Review evidence before recording an immutable correction or dismissing a false positive.</p></div><form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
    <Field label="Status"><select className={inputClassName()} name="status" defaultValue={filters.status ?? "open"}><option value="open">Open issues</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="under_review">Under review</option></select></Field>
    <Field label="Staff member"><select className={inputClassName()} name="staffId" defaultValue={filters.staffId ?? ""}><option value="">All staff</option>{staff.map((person) => <option key={person.staffId} value={person.staffId}>{person.fullName}</option>)}</select></Field>
    <Field label="Issue type"><select className={inputClassName()} name="type" defaultValue={filters.type ?? ""}><option value="">All issue types</option>{Object.entries(issueLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    <Field label="From"><input className={inputClassName()} type="date" name="from" defaultValue={filters.from} /></Field><Field label="To"><input className={inputClassName()} type="date" name="to" defaultValue={filters.to} /></Field>
    <button className="min-h-11 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white sm:col-span-2 lg:col-span-1" type="submit">Apply filters</button>
  </form></Panel>{issues.length ? issues.map((issue) => <IssueCard issue={issue} key={issue.id} />) : <EmptyState title="No matching attendance issues" body="No attendance exceptions match these filters." />}</div>;
}
