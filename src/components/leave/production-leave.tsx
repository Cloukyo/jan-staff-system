"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { cancelLeaveRequestAction, createLeaveRequestAction, reviewLeaveRequestAction } from "@/lib/leave/server";
import { calculateLeaveMinutes, leaveStatusTone, leaveTypeLabel } from "@/lib/calculations/leave";
import { formatDateUk, formatDurationCompact, isoDateInLondon } from "@/lib/dates/format";
import type { LeaveDayPart, LeaveRequest, LeaveStatus, LeaveType, StaffAccount } from "@/types";

const leaveTypes: LeaveType[] = ["annual_leave", "sickness", "medical_appointment", "unpaid_leave", "training", "other"];

function LeaveSummary({ requests }: { requests: LeaveRequest[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(["pending", "approved", "rejected", "cancelled"] as LeaveStatus[]).map((status) => (
        <Panel key={status}>
          <p className="text-sm font-bold capitalize text-slate-500">{status}</p>
          <p className="mt-2 text-3xl font-black text-purple-950">{requests.filter((item) => item.status === status).length}</p>
        </Panel>
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
        <StatusPill tone={leaveStatusTone(request.status)}>{request.status}</StatusPill>
      </div>
      {canCancel && request.status === "pending" && (
        <ProductionActionForm action={cancelLeaveRequestAction} submitLabel="Cancel request" submitVariant="secondary" className="mt-3">
          <input type="hidden" name="requestId" value={request.id} />
        </ProductionActionForm>
      )}
    </div>
  );
}

export function ProductionMyLeave({ requests }: { requests: LeaveRequest[] }) {
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
          <h1 className="mt-1 text-3xl font-black text-purple-950">My leave</h1>
          <p className="mt-2 text-slate-600">Your submitted leave requests and manager decisions.</p>
        </div>
        <Link className="inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href="/leave/request">Request leave</Link>
      </div>
      <LeaveSummary requests={requests} />
      <Panel>
        <div className="grid gap-3">
          {requests.length ? requests.map((request) => <LeaveDetails key={request.id} request={request} canCancel />) : <EmptyState title="No leave requests" body="Use Request leave when you need to submit time away." />}
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
      <div>
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Request leave</h1>
        <p className="mt-2 text-slate-600">Submit a request for manager review. It will remain pending until a manager decides it.</p>
      </div>
      <Panel>
        <ProductionActionForm action={createLeaveRequestAction} submitLabel="Submit leave request">
          <input type="hidden" name="staffId" value={account.staffId} />
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
          <Field label="Reason or notes"><textarea className={inputClassName("mt-4 min-h-24 w-full")} name="staffNote" /></Field>
          <p className="mt-4 rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">Requested working time: {formatDurationCompact(requestedMinutes)}</p>
        </ProductionActionForm>
      </Panel>
    </div>
  );
}

export function ProductionManagerLeave({ requests, accounts }: { requests: LeaveRequest[]; accounts: StaffAccount[] }) {
  const [status, setStatus] = useState("pending");
  const names = useMemo(() => new Map(accounts.map((account) => [account.staffId, account.fullName])), [accounts]);
  const filtered = status === "all" ? requests : requests.filter((request) => request.status === status);
  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Leave requests</h1>
        <p className="mt-2 text-slate-600">Review staff requests. Approved leave is used by production rota conflict checks.</p>
      </div>
      <LeaveSummary requests={requests} />
      <Panel>
        <Field label="Status">
          <select className={inputClassName("max-w-xs")} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">Pending</option>
            <option value="all">All requests</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <div className="mt-4 grid gap-3">
          {filtered.length ? filtered.map((request) => (
            <div key={request.id} className="rounded-xl border border-purple-100 p-4">
              <LeaveDetails request={request} staffName={names.get(request.staffId) ?? "Staff member"} />
              {request.status === "pending" && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {(["approved", "rejected"] as const).map((decision) => (
                    <ProductionActionForm key={decision} action={reviewLeaveRequestAction} submitLabel={decision === "approved" ? "Approve" : "Reject"} submitVariant={decision === "approved" ? "primary" : "danger"}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="status" value={decision} />
                      <Field label="Manager note"><input className={inputClassName()} name="managerNote" /></Field>
                    </ProductionActionForm>
                  ))}
                </div>
              )}
            </div>
          )) : <EmptyState title="No matching leave requests" body="There are no requests in this status." />}
        </div>
      </Panel>
    </div>
  );
}
