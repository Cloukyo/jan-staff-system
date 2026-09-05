"use client";

import Link from "next/link";
import { useState } from "react";
import { buildAttendanceActionQueue } from "@/components/attendance/attendance-presentation";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { DetailDisclosure } from "@/components/ui/layout-primitives";
import { ActionSummary, Alert, StatusBadge } from "@/components/ui/semantic-primitives";
import { EmptyState, Field, Panel, inputClassName } from "@/components/ui/primitives";
import { resolveAttendanceCorrectionRequestAction, saveAttendanceReviewAction } from "@/lib/attendance/review-actions";
import type { AttendanceReviewDay, AttendanceReviewRow } from "@/lib/attendance/review-server";
import { formatDateUk, formatDurationCompact, formatTimeUk } from "@/lib/dates/format";

type ReviewDecision = "approved" | "corrected" | "ignored" | "needs_staff_clarification";

const reviewDecisionLabels: Record<ReviewDecision, string> = {
  approved: "Approve recorded times",
  corrected: "Enter corrected times",
  ignored: "Accept exception with reason",
  needs_staff_clarification: "Mark for follow-up",
};

type ClassifiedRow = ReturnType<typeof buildAttendanceActionQueue<AttendanceReviewRow>>["rows"][number];

function attendanceCorrectionHref(
  data: Pick<AttendanceReviewDay, "date">,
  row: Pick<AttendanceReviewRow, "staffId">,
) {
  return `/attendance?${new URLSearchParams({
    view: "hours",
    hoursFrom: data.date,
    hoursTo: data.date,
    staffId: row.staffId,
    day: data.date,
  }).toString()}`;
}

function AttendanceReviewCard({ item, data }: { item: ClassifiedRow; data: AttendanceReviewDay }) {
  const { row, presentation } = item;
  const correctionHref = attendanceCorrectionHref(data, row);
  const needsCorrection = presentation.kind === "correction";

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-purple-950">{row.fullName}</h3>
          <p className="mt-1 text-sm text-slate-700">
            Planned: {row.scheduledStart && row.scheduledEnd ? `${row.scheduledStart} to ${row.scheduledEnd}` : "No published shift"}
          </p>
          <p className="text-sm text-slate-700">
            Recorded: {row.firstClockIn ? formatTimeUk(row.firstClockIn) : "No clock-in"} to {row.finalClockOut ? formatTimeUk(row.finalClockOut) : "No clock-out"} | {formatDurationCompact(row.recordedMinutes)}
          </p>
        </div>
        <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
      </div>

      {needsCorrection ? (
        <Alert
          className="mt-4"
          tone="blocking"
          title="Recorded time needs fixing"
          action={(
            <Link
              aria-label={`Open corrections for ${row.fullName}`}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-700 px-4 text-sm font-bold text-white hover:bg-red-800"
              href={correctionHref}
            >
              Fix attendance
            </Link>
          )}
        >
          <ul className="grid gap-1">
            {row.exceptions.map((exception) => <li key={exception}>{exception}</li>)}
          </ul>
        </Alert>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">{presentation.description}</p>
          <Link className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50" href={correctionHref}>
            View attendance details
          </Link>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {row.managerCorrection ? <StatusBadge tone="information">Manager correction recorded</StatusBadge> : null}
        {row.pendingClarificationCount ? <StatusBadge tone="attention">{row.pendingClarificationCount} staff request{row.pendingClarificationCount === 1 ? "" : "s"}</StatusBadge> : null}
      </div>
      {row.reviewReason ? <p className="mt-3 text-sm font-semibold text-purple-800">Manager note: {row.reviewReason}</p> : null}

      {row.pendingClarifications.map((request) => (
        <Alert key={request.id} className="mt-4" tone="attention" title="Staff request awaiting response">
          <p className="font-bold">{request.issueType.replaceAll("_", " ")}</p>
          <p className="mt-1">{request.staffNote}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {(["resolved", "rejected"] as const).map((requestStatus) => (
              <ProductionActionForm key={requestStatus} action={resolveAttendanceCorrectionRequestAction} submitLabel={requestStatus === "resolved" ? "Resolve request" : "Reject request"} submitVariant={requestStatus === "resolved" ? "primary" : "danger"}>
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="requestStatus" value={requestStatus} />
                <Field label="Manager note"><input className={inputClassName()} name="managerNote" minLength={5} required /></Field>
              </ProductionActionForm>
            ))}
          </div>
        </Alert>
      ))}

      <DetailDisclosure
        className="mt-4"
        summary={presentation.kind === "complete" ? "View or change review decision" : "Record review decision"}
        defaultOpen={presentation.kind === "review"}
      >
        <AttendanceReviewDecision staffId={row.staffId} reviewDate={data.date} currentStatus={row.reviewStatus} />
      </DetailDisclosure>
    </Panel>
  );
}

export function AttendanceReview({ data }: { data: AttendanceReviewDay }) {
  const queue = buildAttendanceActionQueue(data.rows);
  const actionRows = queue.rows.filter(({ presentation }) => presentation.kind !== "complete");
  const completedRows = queue.rows.filter(({ presentation }) => presentation.kind === "complete");
  const recordLabel = queue.counts.actionRequired === 1 ? "record needs" : "records need";

  return (
    <div className="grid gap-5">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-purple-700">Daily review</p>
            <h2 className="mt-1 text-2xl font-black text-purple-950">
              {queue.counts.actionRequired} {recordLabel} attention
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {formatDateUk(data.date)} | {data.counts.scheduled} scheduled | {data.counts.clockedIn} clocked in
            </p>
          </div>
          <StatusBadge tone={queue.counts.actionRequired ? "attention" : "success"}>
            {queue.counts.actionRequired ? "Review in progress" : "Day reviewed"}
          </StatusBadge>
        </div>

        <ActionSummary
          className="mt-4"
          title="Review progress"
          items={[
            { key: "correction", label: "Need attendance fixed", count: queue.counts.correction, tone: queue.counts.correction ? "blocking" : "neutral" },
            { key: "follow-up", label: "Need staff follow-up", count: queue.counts.followUp, tone: queue.counts.followUp ? "attention" : "neutral" },
            { key: "review", label: "Ready for review", count: queue.counts.review, tone: queue.counts.review ? "attention" : "neutral" },
            { key: "complete", label: "Reviewed", count: queue.counts.complete, tone: queue.counts.complete ? "success" : "neutral" },
          ]}
        />

        <DetailDisclosure className="mt-4" summary="Change review date">
          <form className="flex flex-wrap items-end gap-3" method="get">
            <input type="hidden" name="view" value="needs-attention" />
            <Field label="Review date"><input className={inputClassName()} type="date" name="date" defaultValue={data.date} /></Field>
            <button className="min-h-11 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" type="submit">Load day</button>
          </form>
        </DetailDisclosure>
      </Panel>

      {queue.counts.actionRequired === 0 && data.rows.length ? (
        <Alert tone="success" title="No attendance records need attention">
          All records shown for this day have a saved manager decision.
        </Alert>
      ) : null}

      {actionRows.map((item) => <AttendanceReviewCard key={item.row.staffId} item={item} data={data} />)}

      {completedRows.length ? (
        <DetailDisclosure summary={`Completed records (${completedRows.length})`} defaultOpen={actionRows.length === 0}>
          <div className="grid gap-4">
            {completedRows.map((item) => <AttendanceReviewCard key={item.row.staffId} item={item} data={data} />)}
          </div>
        </DetailDisclosure>
      ) : null}

      {!data.rows.length ? <EmptyState title="No attendance activity" body="There are no published shifts, clock events or staff requests for this date." /> : null}
    </div>
  );
}

function AttendanceReviewDecision({
  staffId,
  reviewDate,
  currentStatus,
}: {
  staffId: string;
  reviewDate: string;
  currentStatus: AttendanceReviewDay["rows"][number]["reviewStatus"];
}) {
  const [decision, setDecision] = useState<ReviewDecision>(
    currentStatus === "unreviewed" ? "approved" : currentStatus,
  );
  const reasonRequired = decision !== "approved";

  return (
    <ProductionActionForm
      action={saveAttendanceReviewAction}
      submitLabel="Save decision"
      submitVariant={decision === "approved" ? "primary" : "secondary"}
      className="max-w-2xl"
    >
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="reviewDate" value={reviewDate} />
      <Field label="Decision">
        <select className={inputClassName()} name="status" value={decision} onChange={(event) => setDecision(event.target.value as ReviewDecision)}>
          {(Object.entries(reviewDecisionLabels) as Array<[ReviewDecision, string]>).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      {reasonRequired ? (
        <div className="mt-3">
          <Field label="Reason"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
        </div>
      ) : null}
    </ProductionActionForm>
  );
}
