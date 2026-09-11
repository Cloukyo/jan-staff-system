"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { LeaveNavigation } from "@/components/leave/leave-navigation";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { cancelLeaveRequestAction, createLeaveRequestAction, reviewLeaveRequestAction } from "@/lib/leave/server";
import { calculateLeaveMinutes, leaveStatusTone, leaveTypeLabel } from "@/lib/calculations/leave";
import { formatDateUk, formatDurationCompact, isoDateInLondon } from "@/lib/dates/format";
import {
  leaveCancellationConfirmation,
  leaveDecisionConfirmation,
  leaveStatusCounts,
  leaveStatusLabel,
  orderLeaveRequests,
  type LeaveStatusFilter,
} from "@/lib/leave/presentation";
import type { LeaveDayPart, LeaveRequest, LeaveType, StaffAccount } from "@/types";

const leaveTypes: LeaveType[] = ["annual_leave", "sickness", "medical_appointment", "unpaid_leave", "training", "other"];

const statusFilters: Array<{ id: LeaveStatusFilter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

function LeaveSummary({ requests }: { requests: LeaveRequest[] }) {
  const counts = leaveStatusCounts(requests);
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-purple-100 bg-white px-5 py-4" aria-label="Leave request summary">
      {statusFilters.slice(0, 4).map((item) => (
        <p key={item.id} className="text-sm text-slate-600"><span className="font-black text-purple-950">{counts[item.id]}</span> {item.label.toLowerCase()}</p>
      ))}
    </div>
  );
}

function LeaveDetails({ request, staffName, canCancel = false }: { request: LeaveRequest; staffName?: string; canCancel?: boolean }) {
  return (
    <div className="rounded-xl border border-purple-100 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {staffName && <p className="font-black text-purple-950">{staffName}</p>}
          <p className="font-bold text-purple-950">{leaveTypeLabel(request.leaveType)}</p>
          <p className="mt-1 text-sm text-slate-600">
            {formatDateUk(request.startDate)} to {formatDateUk(request.endDate)} | {formatDurationCompact(request.requestedMinutes)}
          </p>
          {request.dayPart === "partial_day" && <p className="text-sm text-slate-600">{request.startTime} to {request.endTime}</p>}
          {request.staffNote && <p className="mt-2 text-sm text-slate-700">{request.staffNote}</p>}
          {request.managerNote && <p className="mt-2 text-sm font-semibold text-purple-800">Manager note: {request.managerNote}</p>}
        </div>
        <StatusPill tone={leaveStatusTone(request.status)}>{leaveStatusLabel(request.status)}</StatusPill>
      </div>
      {canCancel && request.status === "pending" && (
        <ProductionActionForm action={cancelLeaveRequestAction} submitLabel="Cancel request" submitVariant="secondary" className="mt-3" confirmMessage={leaveCancellationConfirmation(request)}>
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="operationId" value={crypto.randomUUID()} />
          {request.revision ? <input type="hidden" name="revision" value={request.revision} /> : null}
        </ProductionActionForm>
      )}
    </div>
  );
}

export function ProductionMyLeave({ requests, role }: { requests: LeaveRequest[]; role: StaffAccount["role"] }) {
  return (
    <div className="grid gap-5">
      <LeaveNavigation role={role} current="mine" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-purple-950">My leave</h1>
          <p className="mt-2 text-slate-600">Your submitted leave requests and manager decisions.</p>
        </div>
        <Link className="inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href="/leave/request">Request leave</Link>
      </div>
      <LeaveSummary requests={requests} />
      <Panel>
        <div className="grid gap-3">
          {requests.length ? orderLeaveRequests(requests).map((request) => <LeaveDetails key={request.id} request={request} canCancel />) : <EmptyState title="No leave requests" body="Use Request leave when you need to submit time away." kind="first-use" />}
        </div>
      </Panel>
    </div>
  );
}

export function ProductionLeaveRequest({ account }: { account: StaffAccount }) {
  const today = isoDateInLondon();
  const [input, setInput] = useState({
    leaveType: "annual_leave" as LeaveType,
    startDate: today,
    endDate: today,
    dayPart: "full_day" as LeaveDayPart,
    startTime: "09:00",
    endTime: "12:00",
  });
  const requestedMinutes = calculateLeaveMinutes(input);
  return (
    <div className="grid gap-5">
      <LeaveNavigation role={account.role} current="request" />
      <div>
        <h1 className="text-3xl font-black text-purple-950">Request leave</h1>
        <p className="mt-2 text-slate-600">Submit a request for manager review. It will remain pending until a manager decides it.</p>
      </div>
      <Panel>
        <div className="mb-5 border-b border-purple-100 pb-4">
          <h2 className="text-lg font-black text-purple-950">Request details</h2>
          <p className="mt-1 text-sm text-slate-600">Check the dates and calculated working time before submitting.</p>
        </div>
        <ProductionActionForm action={createLeaveRequestAction} submitLabel="Submit leave request">
          <input type="hidden" name="staffId" value={account.staffId} />
          <input type="hidden" name="operationId" value={crypto.randomUUID()} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Leave type">
              <select className={inputClassName()} name="leaveType" value={input.leaveType} onChange={(event) => setInput({ ...input, leaveType: event.target.value as LeaveType })}>
                {leaveTypes.map((type) => <option key={type} value={type}>{leaveTypeLabel(type)}</option>)}
              </select>
            </Field>
            <Field label="Full or partial day">
              <select className={inputClassName()} name="dayPart" value={input.dayPart} onChange={(event) => setInput({ ...input, dayPart: event.target.value as LeaveDayPart })}>
                <option value="full_day">Full day</option>
                <option value="partial_day">Partial day</option>
              </select>
            </Field>
            <Field label="Start date"><input className={inputClassName()} name="startDate" type="date" value={input.startDate} onChange={(event) => setInput({ ...input, startDate: event.target.value })} required /></Field>
            <Field label="End date"><input className={inputClassName()} name="endDate" type="date" value={input.endDate} onChange={(event) => setInput({ ...input, endDate: event.target.value })} required /></Field>
            {input.dayPart === "partial_day" && (
              <>
                <Field label="Start time"><input className={inputClassName()} name="startTime" type="time" value={input.startTime} onChange={(event) => setInput({ ...input, startTime: event.target.value })} required /></Field>
                <Field label="End time"><input className={inputClassName()} name="endTime" type="time" value={input.endTime} onChange={(event) => setInput({ ...input, endTime: event.target.value })} required /></Field>
              </>
            )}
          </div>
          <Field label="Reason or notes (optional)"><textarea className={inputClassName("mt-4 min-h-24 w-full")} name="staffNote" /></Field>
          <div className="mt-4 rounded-lg border border-purple-200 bg-purple-50 p-4" aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-wide text-purple-700">Request summary</p>
            <p className="mt-1 font-black text-purple-950">{formatDateUk(input.startDate)} to {formatDateUk(input.endDate)}</p>
            <p className="mt-1 text-sm font-semibold text-purple-800">Requested working time: {formatDurationCompact(requestedMinutes)}</p>
          </div>
        </ProductionActionForm>
      </Panel>
    </div>
  );
}

export function ProductionManagerLeave({ requests, accounts }: { requests: LeaveRequest[]; accounts: StaffAccount[] }) {
  const [status, setStatus] = useState<LeaveStatusFilter>("pending");
  const [managerNotes, setManagerNotes] = useState<Record<string, string>>({});
  const names = useMemo(() => new Map(accounts.map((account) => [account.staffId, account.fullName])), [accounts]);
  const counts = useMemo(() => leaveStatusCounts(requests), [requests]);
  const filtered = orderLeaveRequests(status === "all" ? requests : requests.filter((request) => request.status === status));
  return (
    <div className="grid gap-5">
      <LeaveNavigation role="manager" current="manage" />
      <div>
        <h1 className="text-3xl font-black text-purple-950">Leave requests</h1>
        <p className="mt-2 text-slate-600">Review staff requests. Approved leave appears in rota conflict checks.</p>
        <Link className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900" href="/leave/records">Leave and holiday pay records</Link>
      </div>
      <section className={`rounded-lg border p-5 ${counts.pending ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`} aria-labelledby="leave-attention-heading">
        <p className={`text-xs font-black uppercase tracking-wide ${counts.pending ? "text-amber-800" : "text-green-800"}`}>Manager work queue</p>
        <h2 id="leave-attention-heading" className={`mt-1 text-xl font-black ${counts.pending ? "text-amber-950" : "text-green-950"}`}>Requests needing a decision: {counts.pending}</h2>
        <p className={`mt-1 text-sm ${counts.pending ? "text-amber-900" : "text-green-900"}`}>{counts.pending ? "Review each request before it affects future rota planning." : "No leave requests currently need a manager decision."}</p>
      </section>
      <Panel>
        <div className="flex flex-wrap gap-2" aria-label="Filter leave requests">
          {statusFilters.map((item) => <button key={item.id} type="button" aria-pressed={status === item.id} onClick={() => setStatus(item.id)} className={`min-h-11 rounded-lg px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 ${status === item.id ? "bg-purple-700 text-white" : "bg-white text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50"}`}>{item.label} ({counts[item.id]})</button>)}
        </div>
        <p className="mt-4 text-sm font-bold text-purple-950" aria-live="polite">{filtered.length} {filtered.length === 1 ? "request" : "requests"} shown</p>
        <div className="mt-4 grid gap-3">
          {filtered.length ? filtered.map((request) => (
            <article key={request.id} className={`rounded-xl border p-4 ${request.status === "pending" ? "border-amber-200 bg-amber-50/40" : "border-purple-100"}`}>
              <LeaveDetails request={request} staffName={names.get(request.staffId) ?? "Staff member"} />
              {request.status === "pending" && (
                <div className="mt-4 rounded-lg border border-purple-100 bg-white p-4">
                  <Field label="Manager note (optional)"><input className={inputClassName()} value={managerNotes[request.id] ?? ""} onChange={(event) => setManagerNotes((current) => ({ ...current, [request.id]: event.target.value }))} /></Field>
                  <p className="mt-3 text-sm text-slate-600">Approving records the decision and flags any existing shifts in this period for review.</p>
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                    {(["approved", "rejected"] as const).map((decision) => (
                    <ProductionActionForm key={decision} action={reviewLeaveRequestAction} submitLabel={decision === "approved" ? "Approve leave" : "Reject request"} submitVariant={decision === "approved" ? "primary" : "danger"} className="flex-1 [&_.ui-button]:w-full" confirmMessage={leaveDecisionConfirmation(request, names.get(request.staffId) ?? "Staff member", decision)}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="operationId" value={crypto.randomUUID()} />
                      {request.revision ? <input type="hidden" name="revision" value={request.revision} /> : null}
                      <input type="hidden" name="status" value={decision} />
                      <input type="hidden" name="managerNote" value={managerNotes[request.id] ?? ""} />
                    </ProductionActionForm>
                  ))}
                  </div>
                </div>
              )}
            </article>
          )) : <EmptyState title="No matching leave requests" body={status === "pending" ? "No requests need a manager decision." : "There are no requests in this status."} kind="filtered" />}
        </div>
      </Panel>
    </div>
  );
}
