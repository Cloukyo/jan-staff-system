"use client";

import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDurationCompact, formatTimeUk } from "@/lib/dates/format";
import { resolveAttendanceCorrectionRequestAction, saveAttendanceReviewAction } from "@/lib/attendance/review-actions";
import type { AttendanceReviewDay } from "@/lib/attendance/review-server";

export function AttendanceReview({ data }: { data: AttendanceReviewDay }) {
  return (
    <div className="grid gap-5">
      <Panel>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <Field label="Review date"><input className={inputClassName()} type="date" name="date" defaultValue={data.date} /></Field>
          <button className="min-h-11 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" type="submit">Load day</button>
        </form>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Scheduled", data.counts.scheduled],
            ["Clocked in", data.counts.clockedIn],
            ["Exceptions", data.counts.exceptions],
            ["Unreviewed", data.counts.unreviewed],
            ["Staff requests", data.counts.clarificationRequests],
          ].map(([label, value]) => <div key={label} className="rounded-lg bg-purple-50 p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-purple-950">{value}</p></div>)}
        </div>
      </Panel>

      {data.rows.length ? data.rows.map((row) => (
        <Panel key={row.staffId}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-purple-950">{row.fullName}</h2>
              <p className="mt-1 text-sm text-slate-600">
                Scheduled: {row.scheduledStart && row.scheduledEnd ? `${row.scheduledStart} to ${row.scheduledEnd}` : "No published shift"}
              </p>
              <p className="text-sm text-slate-600">
                Recorded: {row.firstClockIn ? formatTimeUk(row.firstClockIn) : "No clock-in"} to {row.finalClockOut ? formatTimeUk(row.finalClockOut) : "No clock-out"} | {formatDurationCompact(row.recordedMinutes)}
              </p>
            </div>
            <StatusPill tone={row.reviewStatus === "approved" ? "green" : row.reviewStatus === "unreviewed" ? "amber" : "purple"}>
              {row.reviewStatus.replaceAll("_", " ")}
            </StatusPill>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {row.exceptions.length ? row.exceptions.map((exception) => <StatusPill key={exception} tone="red">{exception}</StatusPill>) : <StatusPill tone="green">No calculated exceptions</StatusPill>}
            {row.managerCorrection ? <StatusPill tone="purple">Manager correction event</StatusPill> : null}
            {row.pendingClarificationCount ? <StatusPill tone="amber">{row.pendingClarificationCount} staff request(s)</StatusPill> : null}
          </div>
          {row.reviewReason ? <p className="mt-3 text-sm font-semibold text-purple-800">Review note: {row.reviewReason}</p> : null}
          {row.pendingClarifications.map((request) => (
            <div key={request.id} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="font-bold text-amber-950">{request.issueType.replaceAll("_", " ")}</p>
              <p className="mt-1 text-sm text-amber-900">{request.staffNote}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(["resolved", "rejected"] as const).map((requestStatus) => (
                  <ProductionActionForm key={requestStatus} action={resolveAttendanceCorrectionRequestAction} submitLabel={requestStatus === "resolved" ? "Resolve request" : "Reject request"} submitVariant={requestStatus === "resolved" ? "primary" : "danger"}>
                    <input type="hidden" name="requestId" value={request.id} />
                    <input type="hidden" name="requestStatus" value={requestStatus} />
                    <Field label="Manager note"><input className={inputClassName()} name="managerNote" minLength={5} required /></Field>
                  </ProductionActionForm>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {(["approved", "corrected", "ignored", "needs_staff_clarification"] as const).map((status) => (
              <ProductionActionForm
                key={status}
                action={saveAttendanceReviewAction}
                submitLabel={status === "approved" ? "Approve" : status === "corrected" ? "Mark corrected" : status === "ignored" ? "Ignore with reason" : "Needs clarification"}
                submitVariant={status === "approved" ? "primary" : "secondary"}
              >
                <input type="hidden" name="staffId" value={row.staffId} />
                <input type="hidden" name="reviewDate" value={data.date} />
                <input type="hidden" name="status" value={status} />
                <Field label={status === "approved" ? "Optional note" : "Reason"}>
                  <input className={inputClassName()} name="reason" minLength={status === "approved" ? undefined : 5} required={status !== "approved"} />
                </Field>
              </ProductionActionForm>
            ))}
          </div>
        </Panel>
      )) : <EmptyState title="No attendance activity" body="There are no published shifts, clock events or staff requests for this date." />}
    </div>
  );
}
