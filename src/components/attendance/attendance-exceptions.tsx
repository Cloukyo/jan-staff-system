"use client";

import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { DetailDisclosure } from "@/components/ui/layout-primitives";
import { ActionSummary, Alert, StatusBadge } from "@/components/ui/semantic-primitives";
import { EmptyState, Field, Panel, inputClassName } from "@/components/ui/primitives";
import { dismissAttendanceExceptionAction, resolveAttendanceExceptionAction } from "@/lib/attendance/review-actions";
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
  events: Array<{ eventId?: string; id?: string; eventType: "clock_in" | "clock_out"; eventTimestamp: string; source: string; kioskDeviceId?: string | null }>;
  original?: boolean;
}) {
  return (
    <div>
      <h4 className="text-sm font-black text-purple-950">{title}</h4>
      {events.length ? (
        <ul className="mt-2 grid gap-2">
          {events.map((event) => (
            <li className="rounded-lg bg-slate-50 p-3 text-sm" key={event.eventId ?? event.id}>
              <span className="font-bold">{event.eventType === "clock_in" ? "Clock in" : "Clock out"}</span> at {formatTimeUk(event.eventTimestamp)}
              <span className="block text-xs text-slate-600">{sourceLabel(event)}{original ? " | immutable original" : ""}</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-slate-600">No events recorded.</p>}
    </div>
  );
}

function CorrectionForm({ issue, kind, target, label }: {
  issue: AttendanceExceptionRow;
  kind: "add_missing_clock_in" | "add_missing_clock_out" | "correct_clock_in" | "correct_clock_out";
  target?: EffectiveAttendanceEvent;
  label: string;
}) {
  const defaultDateTime = target?.eventTimestamp || issue.suggestedResolutionAt
    ? localDateTimeValue(target?.eventTimestamp ?? issue.suggestedResolutionAt!)
    : `${issue.operationalDate}T${kind.includes("clock_in") ? "08:30" : "17:00"}`;
  return (
    <ProductionActionForm action={resolveAttendanceExceptionAction} submitLabel={label} className="rounded-lg border border-purple-100 p-4">
      <input type="hidden" name="exceptionId" value={issue.id} />
      <input type="hidden" name="staffId" value={issue.staffId} />
      <input type="hidden" name="operationalDate" value={issue.operationalDate} />
      <input type="hidden" name="expectedRevision" value={issue.stateRevision} />
      <input type="hidden" name="resolutionKind" value={kind} />
      <input type="hidden" name="effectiveEventId" value={target?.eventId ?? ""} />
      <input type="hidden" name="originalEventId" value={target?.originalEventId ?? ""} />
      <input type="hidden" name="correctionId" value={target?.correctionId ?? ""} />
      <div className="grid gap-3">
        <Field label="Correction date and time (London)"><input className={inputClassName()} type="datetime-local" name="eventTimestamp" defaultValue={defaultDateTime} required /></Field>
        {issue.suggestedResolutionAt && !target ? <p className="text-xs font-semibold text-purple-700">Suggested from the published rota: {formatTimeUk(issue.suggestedResolutionAt)}. This is a suggestion, not recorded attendance.</p> : null}
        <Field label="Manager reason"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
      </div>
    </ProductionActionForm>
  );
}

function RecommendedCorrection({ issue }: { issue: AttendanceExceptionRow }) {
  if (issue.type === "missing_clock_out") {
    return <CorrectionForm issue={issue} kind="add_missing_clock_out" label={issue.suggestedResolutionAt ? "Save suggested clock-out" : "Add missing clock-out"} />;
  }
  if (issue.type === "missing_clock_in" || issue.type === "unmatched_clock_out") {
    return <CorrectionForm issue={issue} kind="add_missing_clock_in" label="Add missing clock-in" />;
  }
  return null;
}

function IssueCard({ issue, position, total }: { issue: AttendanceExceptionRow; position: number; total: number }) {
  const completedMinutes = effectiveDuration(issue.effectiveEvents);
  const shift = issue.scheduledShifts[0];
  const open = issue.status === "open" || issue.status === "under_review";
  const recommendedCorrection = open ? <RecommendedCorrection issue={issue} /> : null;
  const statusTone = open ? "blocking" : issue.status === "resolved" ? "success" : "neutral";

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Issue {position} of {total}</p>
          <h3 className="mt-1 text-xl font-black text-purple-950">{issue.staffName}</h3>
          <p className="mt-1 text-sm text-slate-600">{formatDateUk(issue.operationalDate)} | created <span suppressHydrationWarning>{elapsedLabel(issue.createdAt)}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={statusTone}>{issueLabels[issue.type]}</StatusBadge>
          <StatusBadge tone={open ? "attention" : "neutral"}>{issue.status.replaceAll("_", " ")}</StatusBadge>
          {issue.payrollMayBeAffected ? <StatusBadge tone="blocking">Payroll may be affected</StatusBadge> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 rounded-lg bg-purple-50 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p><span className="block text-xs font-bold uppercase text-slate-500">Planned shift</span>{shift ? `${String(shift.start_time).slice(0, 5)} to ${String(shift.end_time).slice(0, 5)}` : "No published shift"}</p>
        <p><span className="block text-xs font-bold uppercase text-slate-500">Recorded duration</span>{completedMinutes === null ? "Cannot be calculated safely" : formatDurationCompact(completedMinutes)}</p>
        <p><span className="block text-xs font-bold uppercase text-slate-500">Clock source</span>{issue.source.replaceAll("_", " ")}</p>
        <p><span className="block text-xs font-bold uppercase text-slate-500">Leave</span>{issue.leaveContext.length ? "Approved leave recorded" : "None recorded"}</p>
      </div>

      <DetailDisclosure className="mt-4" summary="Review clock evidence and audit history">
        <p className="mb-4 text-sm text-slate-700">Original clock records remain unchanged. Manager corrections are stored separately in the effective attendance ledger.</p>
        <div className="grid gap-5 md:grid-cols-2">
          <EventList title="Original evidence" original events={issue.originalEvents} />
          <EventList title="Current effective ledger" events={issue.effectiveEvents} />
        </div>
        {issue.corrections.length ? (
          <div className="mt-5">
            <h4 className="text-sm font-black text-purple-950">Correction history</h4>
            <ul className="mt-2 grid gap-2">
              {issue.corrections.map((correction) => <li className="rounded-lg bg-purple-50 p-3 text-sm" key={String(correction.id)}>{String(correction.event_type).replaceAll("_", " ")} at {formatTimeUk(String(correction.event_timestamp))}<span className="block text-xs text-slate-600">{String(correction.manager_name)} | {String(correction.reason)}</span></li>)}
            </ul>
          </div>
        ) : null}
        {issue.operationHistory.length ? (
          <div className="mt-5">
            <h4 className="text-sm font-black text-purple-950">Decision audit</h4>
            <ul className="mt-2 grid gap-2">
              {issue.operationHistory.map((operation) => <li className="rounded-lg bg-slate-50 p-3 text-sm" key={String(operation.operation_id)}>{String(operation.operation_kind)} by {String(operation.manager_name)}<span className="block text-xs text-slate-600">{String(operation.reason)}</span></li>)}
            </ul>
          </div>
        ) : null}
      </DetailDisclosure>

      {open ? (
        <div className="mt-4 grid gap-4">
          {recommendedCorrection ? (
            <section aria-label="Recommended next step">
              <h4 className="text-base font-black text-purple-950">Recommended next step</h4>
              <p className="mt-1 text-sm text-slate-700">Check the suggested time, enter a reason and save the correction.</p>
              <div className="mt-3">{recommendedCorrection}</div>
            </section>
          ) : null}

          <DetailDisclosure summary={recommendedCorrection ? "Other correction options" : "Review correction options"} defaultOpen={!recommendedCorrection}>
            <div className="grid gap-4 lg:grid-cols-2">
              {issue.effectiveEvents.map((event) => <CorrectionForm key={event.eventId} issue={issue} target={event} kind={event.eventType === "clock_in" ? "correct_clock_in" : "correct_clock_out"} label={`Correct ${event.eventType === "clock_in" ? "clock-in" : "clock-out"}`} />)}
              <ProductionActionForm action={dismissAttendanceExceptionAction} submitLabel="Mark no correction needed" submitVariant="secondary" className="rounded-lg border border-slate-200 p-4">
                <input type="hidden" name="exceptionId" value={issue.id} />
                <input type="hidden" name="expectedRevision" value={issue.stateRevision} />
                <Field label="Reason no correction is needed"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
                <p className="mt-2 text-xs text-slate-600">This preserves the issue and evidence but does not change worked hours.</p>
              </ProductionActionForm>
            </div>
          </DetailDisclosure>
        </div>
      ) : (
        <Alert className="mt-4" tone={issue.status === "resolved" ? "success" : "neutral"} title={issue.status === "resolved" ? "Issue resolved" : "No correction needed"}>
          {issue.status === "resolved" ? issue.resolutionReason ?? "Reason recorded" : issue.dismissalReason ?? "Reason recorded"}
          {issue.reviewingManagerName ? ` | ${issue.reviewingManagerName}` : ""}
        </Alert>
      )}
    </Panel>
  );
}

export function AttendanceExceptions({ issues, filters, staff }: {
  issues: AttendanceExceptionRow[];
  filters: { from: string; to: string; status?: string; type?: string; staffId?: string };
  staff: Array<{ staffId: string; fullName: string }>;
}) {
  const openCount = issues.filter((issue) => issue.status === "open" || issue.status === "under_review").length;
  const resolvedCount = issues.filter((issue) => issue.status === "resolved").length;
  const dismissedCount = issues.filter((issue) => issue.status === "dismissed").length;
  const issueLabel = openCount === 1 ? "issue needs" : "issues need";

  return (
    <div className="grid gap-5">
      <Panel>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-purple-700">Attendance issues</p>
          <h2 className="mt-1 text-2xl font-black text-purple-950">{openCount} {issueLabel} attention</h2>
          <p className="mt-1 text-sm text-slate-600">Fix unsafe recorded time first. Original clock evidence is never overwritten.</p>
        </div>
        <ActionSummary
          className="mt-4"
          title="Issues shown"
          items={[
            { key: "open", label: "Need attention", count: openCount, tone: openCount ? "blocking" : "neutral" },
            { key: "resolved", label: "Resolved", count: resolvedCount, tone: resolvedCount ? "success" : "neutral" },
            { key: "dismissed", label: "No correction needed", count: dismissedCount, tone: "neutral" },
          ]}
        />
        <DetailDisclosure className="mt-4" summary="Filters and date range">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
            <input type="hidden" name="view" value="needs-attention" />
            <Field label="Status"><select className={inputClassName()} name="status" defaultValue={filters.status ?? "open"}><option value="open">Open issues</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="under_review">Under review</option></select></Field>
            <Field label="Staff member"><select className={inputClassName()} name="staffId" defaultValue={filters.staffId ?? ""}><option value="">All staff</option>{staff.map((person) => <option key={person.staffId} value={person.staffId}>{person.fullName}</option>)}</select></Field>
            <Field label="Issue type"><select className={inputClassName()} name="type" defaultValue={filters.type ?? ""}><option value="">All issue types</option>{Object.entries(issueLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="From"><input className={inputClassName()} type="date" name="from" defaultValue={filters.from} /></Field>
            <Field label="To"><input className={inputClassName()} type="date" name="to" defaultValue={filters.to} /></Field>
            <button className="min-h-11 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white sm:col-span-2 lg:col-span-1" type="submit">Apply filters</button>
          </form>
        </DetailDisclosure>
      </Panel>

      {!openCount && issues.length ? <Alert tone="success" title="No open issues in this view">The records shown no longer need an attendance correction.</Alert> : null}
      {issues.length
        ? issues.map((issue, index) => <IssueCard issue={issue} position={index + 1} total={issues.length} key={issue.id} />)
        : <EmptyState title="No matching attendance issues" body="No attendance exceptions match these filters." />}
    </div>
  );
}
