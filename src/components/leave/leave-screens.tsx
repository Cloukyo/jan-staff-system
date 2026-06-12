"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button, EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { calculateLeaveMinutes, findRotaLeaveWarnings, leaveStatusTone, leaveTypeLabel } from "@/lib/calculations/leave";
import { formatDateUk, formatDurationCompact } from "@/lib/dates/format";
import { useDemoRepository } from "@/lib/repositories/demo-store";
import type { LeaveDayPart, LeaveRequest, LeaveStatus, LeaveType } from "@/types";

const leaveTypes: LeaveType[] = ["annual_leave", "sickness", "medical_appointment", "unpaid_leave", "training", "other"];
const statuses: LeaveStatus[] = ["pending", "approved", "rejected", "cancelled"];

function PageHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6">
      <p className="text-sm font-bold text-purple-700">Jan Staff</p>
      <h1 className="mt-1 text-3xl font-black text-purple-950">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{body}</p>
    </div>
  );
}

function LeaveTable({ requests, staffName, onCancel }: { requests: LeaveRequest[]; staffName: (staffId: string) => string; onCancel?: (request: LeaveRequest) => void }) {
  if (!requests.length) return <EmptyState title="No leave requests" body="Leave requests will appear here once submitted." />;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {["Staff", "Type", "Dates", "Time", "Status", "Submitted", "Manager note", "Action"].map((header) => (
              <th key={header} className="border-b border-purple-100 bg-purple-50 px-3 py-3 font-black text-purple-950 first:rounded-l-xl last:rounded-r-xl">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} className="align-top">
              <td className="border-b border-purple-50 px-3 py-3 font-bold text-purple-950">{staffName(request.staffId)}</td>
              <td className="border-b border-purple-50 px-3 py-3">{leaveTypeLabel(request.leaveType)}</td>
              <td className="border-b border-purple-50 px-3 py-3">
                {formatDateUk(request.startDate)} to {formatDateUk(request.endDate)}
                <span className="mt-1 block text-xs font-bold text-slate-500">{formatDurationCompact(request.requestedMinutes)}</span>
              </td>
              <td className="border-b border-purple-50 px-3 py-3">{request.dayPart === "partial_day" ? `${request.startTime} to ${request.endTime}` : "Full day"}</td>
              <td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={leaveStatusTone(request.status)}>{request.status}</StatusPill></td>
              <td className="border-b border-purple-50 px-3 py-3">{formatDateUk(request.createdAt)}</td>
              <td className="border-b border-purple-50 px-3 py-3">{request.managerNote ?? "-"}</td>
              <td className="border-b border-purple-50 px-3 py-3">
                {onCancel && request.status === "pending" ? <Button variant="secondary" onClick={() => onCancel(request)}>Cancel</Button> : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MyLeaveScreen() {
  const repo = useDemoRepository();
  const staffAccount = repo.state.staffAccounts.find((account) => account.role === "staff" && account.active) ?? repo.state.staffAccounts[1];
  const requests = repo.state.leaveRequests.filter((request) => request.staffId === staffAccount.staffId);
  const count = (status: LeaveStatus) => requests.filter((request) => request.status === status).length;
  const staffName = (staffId: string) => repo.state.staff.find((person) => person.id === staffId)?.fullName ?? staffId;
  const [message, setMessage] = useState("");

  return (
    <AppShell>
      <PageHeader title="My Leave" body={`Leave history for ${staffAccount.fullName}. Production access is limited to the signed-in staff account.`} />
      {message && <p className="mb-4 rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">{message}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {(["pending", "approved", "rejected"] as LeaveStatus[]).map((status) => (
          <Panel key={status}>
            <p className="text-sm font-bold text-slate-500">{status}</p>
            <p className="mt-2 text-3xl font-black text-purple-950">{count(status)}</p>
          </Panel>
        ))}
      </div>
      <Panel className="mt-4">
        <LeaveTable
          requests={requests}
          staffName={staffName}
          onCancel={(request) => {
            const result = repo.cancelLeaveRequest(request.id, request.staffId);
            setMessage(result.message);
          }}
        />
      </Panel>
    </AppShell>
  );
}

export function RequestLeaveScreen() {
  const repo = useDemoRepository();
  const staffAccount = repo.state.staffAccounts.find((account) => account.role === "staff" && account.active) ?? repo.state.staffAccounts[1];
  const [form, setForm] = useState({
    leaveType: "annual_leave" as LeaveType,
    startDate: repo.state.settings.demoToday,
    endDate: repo.state.settings.demoToday,
    dayPart: "full_day" as LeaveDayPart,
    startTime: "09:00",
    endTime: "12:00",
    staffNote: "",
  });
  const [message, setMessage] = useState("");
  const requestedMinutes = calculateLeaveMinutes(form);

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = repo.submitLeaveRequest({ ...form, staffId: staffAccount.staffId });
    setMessage(result.message);
  }

  return (
    <AppShell>
      <PageHeader title="Request Leave" body="Submit annual leave, sickness, appointment, unpaid leave, training or other leave for manager review." />
      <Panel>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Leave type">
              <select className={inputClassName()} value={form.leaveType} onChange={(event) => setForm({ ...form, leaveType: event.target.value as LeaveType })}>
                {leaveTypes.map((type) => <option key={type} value={type}>{leaveTypeLabel(type)}</option>)}
              </select>
            </Field>
            <Field label="Full or partial day">
              <select className={inputClassName()} value={form.dayPart} onChange={(event) => setForm({ ...form, dayPart: event.target.value as LeaveDayPart })}>
                <option value="full_day">Full day</option>
                <option value="partial_day">Partial day</option>
              </select>
            </Field>
            <Field label="Start date"><input className={inputClassName()} type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></Field>
            <Field label="End date"><input className={inputClassName()} type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></Field>
            {form.dayPart === "partial_day" && (
              <>
                <Field label="Start time"><input className={inputClassName()} type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} /></Field>
                <Field label="End time"><input className={inputClassName()} type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} /></Field>
              </>
            )}
          </div>
          <Field label="Reason or notes"><textarea className={inputClassName("min-h-24")} value={form.staffNote} onChange={(event) => setForm({ ...form, staffNote: event.target.value })} /></Field>
          <p className="rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">Requested time: {formatDurationCompact(requestedMinutes)}. Weekends are excluded; nursery closure dates can be added later.</p>
          {message && <p className="rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">{message}</p>}
          <Button type="submit">Submit leave request</Button>
        </form>
      </Panel>
    </AppShell>
  );
}

export function ManagerLeaveRequestsScreen() {
  const repo = useDemoRepository();
  const [statusFilter, setStatusFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [managerNote, setManagerNote] = useState<Record<string, string>>({});
  const staffName = (staffId: string) => repo.state.staff.find((person) => person.id === staffId)?.fullName ?? staffId;
  const filtered = repo.state.leaveRequests.filter((request) => {
    const name = staffName(request.staffId).toLowerCase();
    return (statusFilter === "all" || request.status === statusFilter) && (staffFilter === "all" || request.staffId === staffFilter) && (typeFilter === "all" || request.leaveType === typeFilter) && (!query || name.includes(query.toLowerCase()));
  });
  const totals = useMemo(() => ({
    requested: repo.state.leaveRequests.reduce((sum, request) => sum + request.requestedMinutes, 0),
    approved: repo.state.leaveRequests.filter((request) => request.status === "approved").reduce((sum, request) => sum + request.requestedMinutes, 0),
  }), [repo.state.leaveRequests]);

  function review(request: LeaveRequest, status: "approved" | "rejected") {
    if (!confirm(`${status === "approved" ? "Approve" : "Reject"} leave request for ${staffName(request.staffId)}?`)) return;
    const result = repo.reviewLeaveRequest(request.id, status, managerNote[request.id] ?? "");
    setMessage(result.message);
  }

  return (
    <AppShell>
      <PageHeader title="Leave Requests" body="Review pending leave, filter history and keep rota conflicts visible for managers." />
      {message && <p className="mb-4 rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">{message}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel><p className="text-sm font-bold text-slate-500">Requested leave</p><p className="mt-2 text-3xl font-black text-purple-950">{formatDurationCompact(totals.requested)}</p></Panel>
        <Panel><p className="text-sm font-bold text-slate-500">Approved leave</p><p className="mt-2 text-3xl font-black text-purple-950">{formatDurationCompact(totals.approved)}</p></Panel>
      </div>
      <Panel className="mt-4">
        <div className="grid gap-3 md:grid-cols-[1fr_170px_170px_170px]">
          <label className="relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-purple-400" />
            <input className={inputClassName("w-full pl-10")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff" />
          </label>
          <select className={inputClassName()} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select className={inputClassName()} value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)}>
            <option value="all">All staff</option>
            {repo.state.staff.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
          </select>
          <select className={inputClassName()} value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">All types</option>
            {leaveTypes.map((type) => <option key={type} value={type}>{leaveTypeLabel(type)}</option>)}
          </select>
        </div>
        <div className="mt-4 grid gap-3">
          {filtered.length ? filtered.map((request) => (
            <div key={request.id} className="rounded-xl border border-purple-100 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-black text-purple-950">{staffName(request.staffId)}: {leaveTypeLabel(request.leaveType)}</p>
                  <p className="mt-1 text-sm text-slate-600">{formatDateUk(request.startDate)} to {formatDateUk(request.endDate)} · {formatDurationCompact(request.requestedMinutes)} · Submitted {formatDateUk(request.createdAt)}</p>
                  {request.staffNote && <p className="mt-2 text-sm text-slate-700">{request.staffNote}</p>}
                </div>
                <StatusPill tone={leaveStatusTone(request.status)}>{request.status}</StatusPill>
              </div>
              {request.status === "pending" && (
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <input className={inputClassName()} value={managerNote[request.id] ?? ""} onChange={(event) => setManagerNote({ ...managerNote, [request.id]: event.target.value })} placeholder="Optional manager note" />
                  <Button variant="secondary" onClick={() => review(request, "approved")}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
                  <Button variant="danger" onClick={() => review(request, "rejected")}><XCircle className="h-4 w-4" /> Reject</Button>
                </div>
              )}
            </div>
          )) : <EmptyState title="No matching requests" body="Change filters to see more leave history." />}
        </div>
      </Panel>
    </AppShell>
  );
}

export function AccountsScreen() {
  const repo = useDemoRepository();
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ staffId: "", fullName: "", email: "", role: "staff" as "staff" | "manager" });

  return (
    <AppShell>
      <PageHeader title="Accounts" body="Link Supabase users to existing staff records, assign roles and deactivate accounts when people leave." />
      {message && <p className="mb-4 rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-800">{message}</p>}
      <Panel className="mb-4">
        <h2 className="text-lg font-black text-purple-950">Login account workflow</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Create the staff profile first, add an email when supplied, invite the user from Supabase Auth, then link the Auth user ID to the existing staff profile. Never use shared default passwords.
        </p>
      </Panel>
      <Panel>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Staff member">
            <select className={inputClassName()} value={form.staffId} onChange={(event) => {
              const staff = repo.state.staff.find((person) => person.id === event.target.value);
              setForm({ ...form, staffId: event.target.value, fullName: staff?.fullName ?? form.fullName });
            }}>
              <option value="">Choose staff</option>
              {repo.state.staff.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
            </select>
          </Field>
          <Field label="Full name"><input className={inputClassName()} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></Field>
          <Field label="Email"><input className={inputClassName()} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Role"><select className={inputClassName()} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "staff" | "manager" })}><option value="staff">Staff</option><option value="manager">Manager</option></select></Field>
        </div>
        <Button className="mt-4" onClick={() => {
          const result = repo.addStaffAccount({ ...form, active: true, mustChangePassword: false });
          setMessage(result.message);
        }}>Create account link</Button>
      </Panel>
      <Panel className="mt-4">
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead><tr>{["Name", "Email", "Role", "Login state", "Status", "Action"].map((header) => <th key={header} className="border-b border-purple-100 bg-purple-50 px-3 py-3 font-black text-purple-950 first:rounded-l-xl last:rounded-r-xl">{header}</th>)}</tr></thead>
            <tbody>{repo.state.staffAccounts.map((account) => {
              const loginState = !account.email ? "No email" : !account.authUserId ? "Invitation pending" : account.active ? "Active login" : "Disabled login";
              return <tr key={account.id}><td className="border-b border-purple-50 px-3 py-3 font-bold text-purple-950">{account.fullName}</td><td className="border-b border-purple-50 px-3 py-3">{account.email}</td><td className="border-b border-purple-50 px-3 py-3">{account.role}</td><td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={loginState === "Active login" ? "green" : loginState === "Disabled login" ? "grey" : "amber"}>{loginState}</StatusPill></td><td className="border-b border-purple-50 px-3 py-3"><StatusPill tone={account.active ? "green" : "grey"}>{account.active ? "Active" : "Inactive"}</StatusPill></td><td className="border-b border-purple-50 px-3 py-3">{account.active ? <Button variant="secondary" onClick={() => { repo.deactivateAccount(account.id); setMessage("Account deactivated."); }}>Deactivate</Button> : "-"}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}

export function ProfileScreen() {
  const repo = useDemoRepository();
  const account = repo.state.staffAccounts.find((item) => item.role === "staff" && item.active) ?? repo.state.staffAccounts[0];
  const staff = repo.state.staff.find((person) => person.id === account.staffId);
  return (
    <AppShell>
      <PageHeader title="Profile" body="Your staff account details. Production access is scoped to the signed-in user." />
      <Panel>
        <dl className="grid gap-4 md:grid-cols-2">
          <div><dt className="text-sm font-bold text-slate-500">Name</dt><dd className="mt-1 font-black text-purple-950">{account.fullName}</dd></div>
          <div><dt className="text-sm font-bold text-slate-500">Email</dt><dd className="mt-1 font-black text-purple-950">{account.email}</dd></div>
          <div><dt className="text-sm font-bold text-slate-500">Role</dt><dd className="mt-1 font-black text-purple-950">{account.role}</dd></div>
          <div><dt className="text-sm font-bold text-slate-500">Staff role</dt><dd className="mt-1 font-black text-purple-950">{staff?.role ?? "-"}</dd></div>
        </dl>
      </Panel>
    </AppShell>
  );
}

export function RotaLeaveWarnings({ staffId, date }: { staffId: string; date: string }) {
  const repo = useDemoRepository();
  const warnings = findRotaLeaveWarnings({ id: "preview", staffId, date, status: "working", scheduledStart: "09:00", scheduledEnd: "17:00", plannedBreakMinutes: 30 }, repo.state.leaveRequests);
  if (!warnings.length) return null;
  return (
    <div className="mt-1 grid gap-1">
      {warnings.map((request) => (
        <StatusPill key={request.id} tone={request.status === "approved" ? "red" : "amber"}>
          {request.status === "approved" ? "Approved leave" : "Pending leave"}
        </StatusPill>
      ))}
    </div>
  );
}
