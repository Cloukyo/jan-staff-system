"use client";

import { addWeeks, format, parseISO } from "date-fns";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Edit3,
  Plus,
  Printer,
  RefreshCcw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { BrandMark } from "@/components/ui/brand";
import { Button, EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { hasSeriousException, isCleanApprovalCandidate } from "@/lib/calculations/attendance";
import { shiftPayableStatusMinutes, shiftScheduledMinutes, weeklyPaidStatusTotal, weeklyRotaTotal, rotaWarnings } from "@/lib/calculations/rota";
import { createAppClock } from "@/lib/dates/app-clock";
import { weekDates, weekStart, formatDateUk, formatDurationCompact, formatHours, formatMoney, formatTimeUk, isoDate } from "@/lib/dates/format";
import { exportAttendanceCsv, exportPayCsv } from "@/lib/exports/csv";
import { exportPayWorkbook } from "@/lib/exports/xlsx";
import { useDemoRepository } from "@/lib/repositories/demo-store";
import { staffFormSchema } from "@/lib/validation/staff";
import type { AttendanceDay, ClockEventType, PayPeriodSummary, RotaShift, StaffMember } from "@/types";

type Screen = "dashboard" | "staff" | "rota" | "attendance" | "payroll" | "settings";
type AttendanceTab = "needs_review" | "ready" | "approved" | "all";

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function attendanceTabForDay(day: AttendanceDay): AttendanceTab {
  if (day.approvalStatus === "approved") return "approved";
  if (day.approvalStatus === "needs_review" || hasSeriousException(day)) return "needs_review";
  return "ready";
}

function statusStyle(status: RotaShift["status"]) {
  const styles = {
    working: "border-purple-200 bg-purple-50 text-purple-950",
    holiday: "border-sky-200 bg-sky-50 text-sky-950",
    sick: "border-rose-200 bg-rose-50 text-rose-950",
    training: "border-teal-200 bg-teal-50 text-teal-950",
    off: "border-slate-200 bg-slate-100 text-slate-700",
  };
  return styles[status];
}

function PayTreatmentBadge({ shift }: { shift?: RotaShift }) {
  if (!shift || shift.status === "working") return null;
  const tone = shift.payTreatment === "paid" ? "green" : shift.payTreatment === "unpaid" ? "grey" : "amber";
  return <StatusPill tone={tone}>{titleCase(shift.payTreatment ?? "informational")}</StatusPill>;
}

function PageHeader({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="text-sm font-bold text-purple-700">Jan Staff</p>
        <h1 className="mt-1 text-3xl font-black tracking-normal text-purple-950">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{body}</p>
      </div>
      {action}
    </div>
  );
}

function DemoGuard({ children }: { children: React.ReactNode }) {
  const { hydrated } = useDemoRepository();
  if (!hydrated) {
    return (
      <AppShell>
        <Panel>
          <p className="font-semibold text-purple-950">Loading demo data...</p>
        </Panel>
      </AppShell>
    );
  }
  return <>{children}</>;
}

export function ManagerApp({ screen }: { screen: Screen }) {
  return (
    <DemoGuard>
      <AppShell>
        {screen === "dashboard" && <DashboardScreen />}
        {screen === "staff" && <StaffScreen />}
        {screen === "rota" && <RotaScreen />}
        {screen === "attendance" && <AttendanceScreen />}
        {screen === "payroll" && <PayrollScreen />}
        {screen === "settings" && <SettingsScreen />}
      </AppShell>
    </DemoGuard>
  );
}

function DashboardScreen() {
  const repo = useDemoRepository();
  const clock = createAppClock(repo.state.settings);
  const today = clock.today();
  const tomorrow = "2026-06-09";
  const days = repo.attendanceDays(today, today);
  const expected = repo.state.rota.filter((shift) => shift.date === today && shift.status === "working");
  const present = days.filter((day) => day.firstClockIn && !day.finalClockOut);
  const periodDays = repo.attendanceDays("2026-06-01", "2026-06-12");
  const serious = periodDays.filter((day) => attendanceTabForDay(day) === "needs_review");
  const cleanAwaitingApproval = periodDays.filter((day) => attendanceTabForDay(day) === "ready");
  const missingClockOuts = periodDays.filter((day) => day.exceptionFlags.includes("Missing clock-out"));
  const { start: periodStart, end: periodEnd } = clock.currentMonthRange();
  const estimatedPayroll = repo.paySummaries(periodStart, periodEnd).reduce((sum, item) => sum + item.finalGrossPayPence, 0);

  return (
    <>
      <PageHeader title="Dashboard" body="Today’s attendance, rota coverage and payroll preparation signals in one place." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Currently clocked in", present.length, "green"],
          ["Serious exceptions", serious.length, "red"],
          ["Clean awaiting approval", cleanAwaitingApproval.length, "amber"],
          ["Missing clock-outs", missingClockOuts.length, "red"],
          ["Expected not clocked in", Math.max(0, expected.length - days.filter((day) => day.firstClockIn).length), "amber"],
        ].map(([label, value, tone]) => (
          <Panel key={label as string}>
            <p className="text-sm font-bold text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-black text-purple-950">{value}</p>
            <StatusPill tone={tone as "green" | "amber" | "red" | "grey" | "purple"}>Live demo</StatusPill>
          </Panel>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-black text-purple-950">Live attendance</h2>
            <StatusPill tone="purple">{formatMoney(estimatedPayroll)} estimated June payroll, includes provisional hourly attendance</StatusPill>
          </div>
          <DataTable
            headers={["Staff", "Clock-in", "Status", "Scheduled finish", "Flag"]}
            rows={days
              .filter((day) => day.firstClockIn)
              .map((day) => {
                const person = repo.state.staff.find((item) => item.id === day.staffId);
                return [
                  person?.displayName ?? "",
                  formatTimeUk(day.firstClockIn),
                  day.finalClockOut ? "Clocked out" : day.events.at(-1)?.type === "break_start" ? "On break" : "Present",
                  day.shift?.scheduledEnd ?? "-",
                  day.exceptionFlags.includes("Unscheduled attendance") ? "Unscheduled" : "On rota",
                ];
              })}
          />
        </Panel>
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Recent exceptions</h2>
          <div className="mt-4 grid gap-3">
            {serious.slice(0, 6).map((day) => {
              const person = repo.state.staff.find((item) => item.id === day.staffId);
              return (
                <div key={`${day.staffId}-${day.date}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="font-bold text-amber-950">{person?.displayName} on {formatDateUk(day.date)}</p>
                  <p className="text-sm text-amber-800">{day.exceptionFlags.join(", ")}</p>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      <Panel className="mt-4">
        <h2 className="text-xl font-black text-purple-950">Upcoming rota</h2>
        <DataTable
          headers={["Date", "Staff", "Shift", "Status", "Room or duty"]}
          rows={repo.state.rota
            .filter((shift) => [today, tomorrow].includes(shift.date) && shift.status !== "off")
            .slice(0, 12)
            .map((shift) => {
              const person = repo.state.staff.find((item) => item.id === shift.staffId);
              return [formatDateUk(shift.date), person?.displayName ?? "", `${shift.scheduledStart ?? "-"} to ${shift.scheduledEnd ?? "-"}`, shift.status, shift.roomOrRole ?? ""];
            })}
        />
      </Panel>
      <Panel className="mt-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="text-xl font-black text-purple-950">Compliance alerts</h2>
            <p className="mt-1 text-sm text-slate-600">Review expired certificates, upcoming expiries, missing first-aid and safeguarding records, and incomplete central records.</p>
          </div>
          <a className="inline-flex min-h-11 items-center justify-center rounded-xl bg-purple-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-800" href="/compliance">
            Open staff compliance
          </a>
        </div>
      </Panel>
    </>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: (React.ReactNode[])[] }) {
  if (!rows.length) return <EmptyState title="Nothing to show" body="Try changing the filters or add new demo data." />;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-purple-100 bg-purple-50 px-3 py-3 font-black text-purple-950 first:rounded-l-xl last:rounded-r-xl">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-purple-50 px-3 py-3 text-slate-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffScreen() {
  const repo = useDemoRepository();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [payFilter, setPayFilter] = useState("all");
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);
  const filtered = repo.state.staff.filter((person) => {
    const matchesQuery = `${person.fullName} ${person.role}`.toLowerCase().includes(query.toLowerCase());
    const matchesActive = activeFilter === "all" || (activeFilter === "active" ? person.active : !person.active);
    const matchesPay = payFilter === "all" || person.payType === payFilter;
    return matchesQuery && matchesActive && matchesPay;
  });

  return (
    <>
      <PageHeader
        title="Staff"
        body="Manage staff records, contract hours, pay type, historic rates and temporary PIN resets."
        action={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add staff member</Button>}
      />
      <Panel>
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <label className="relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-purple-400" />
            <input className={inputClassName("w-full pl-10")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search staff" />
          </label>
          <select className={inputClassName()} value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="all">All staff</option>
          </select>
          <select className={inputClassName()} value={payFilter} onChange={(event) => setPayFilter(event.target.value)}>
            <option value="all">All pay types</option>
            <option value="hourly">Hourly</option>
            <option value="salaried">Salaried</option>
          </select>
        </div>
        <DataTable
          headers={["Name", "Role", "Pay type", "Contract", "Current rate or salary", "Status", "Action"]}
          rows={filtered.map((person) => [
            <div key="name"><strong className="text-purple-950">{person.fullName}</strong>{person.pinIsTemporary && <p className="mt-1 text-xs font-bold text-amber-700">PIN reset required</p>}</div>,
            person.role,
            titleCase(person.payType),
            formatDurationCompact(person.contractedWeeklyMinutes),
            <span key="rate">{person.payType === "hourly" ? `${formatMoney(person.hourlyRatePence)} / hour` : `${formatMoney(person.monthlySalaryPence)} / month`}{(person.payType === "hourly" && !person.hourlyRatePence) || (person.payType === "salaried" && !person.monthlySalaryPence) ? <span className="ml-2 text-xs font-bold text-red-700">Missing active rate</span> : null}</span>,
            <StatusPill key="status" tone={person.active ? "green" : "grey"}>{person.active ? "Active" : "Inactive"}</StatusPill>,
            <Button key="edit" variant="secondary" onClick={() => setEditing(person)}><Edit3 className="h-4 w-4" /> Edit</Button>,
          ])}
        />
      </Panel>
      {editing && <StaffModal staff={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function StaffModal({ staff, onClose }: { staff: StaffMember | null; onClose: () => void }) {
  const repo = useDemoRepository();
  const [form, setForm] = useState({
    fullName: staff?.fullName ?? "",
    displayName: staff?.displayName ?? "",
    role: staff?.role ?? "Nursery Practitioner",
    payType: staff?.payType ?? "hourly",
    hourlyRate: staff?.hourlyRatePence ? staff.hourlyRatePence / 100 : 12.5,
    monthlySalary: staff?.monthlySalaryPence ? staff.monthlySalaryPence / 100 : 2400,
    contractedWeeklyHours: staff ? staff.contractedWeeklyMinutes / 60 : 30,
    defaultBreakMinutes: staff?.defaultBreakMinutes ?? 30,
    startDate: staff?.startDate ?? "2026-06-08",
    temporaryPin: "",
    active: staff?.active ?? true,
    endDate: staff?.endDate ?? "",
    effectiveFrom: "2026-06-08",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!staff) {
      const parsed = staffFormSchema.safeParse(form);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check the form");
        return;
      }
      repo.addStaff({
        fullName: form.fullName,
        displayName: form.displayName,
        role: form.role,
        employmentStatus: form.active ? "employed" : "former",
        payType: form.payType,
        hourlyRatePence: form.payType === "hourly" ? Math.round(Number(form.hourlyRate) * 100) : null,
        monthlySalaryPence: form.payType === "salaried" ? Math.round(Number(form.monthlySalary) * 100) : null,
        contractedWeeklyMinutes: Math.round(Number(form.contractedWeeklyHours) * 60),
        defaultBreakMinutes: Number(form.defaultBreakMinutes),
        startDate: form.startDate,
        endDate: null,
        active: form.active,
        pinIsTemporary: true,
        temporaryPin: form.temporaryPin,
      });
    } else {
      const next: StaffMember = {
        ...staff,
        fullName: form.fullName,
        displayName: form.displayName,
        role: form.role,
        payType: form.payType,
        hourlyRatePence: form.payType === "hourly" ? Math.round(Number(form.hourlyRate) * 100) : null,
        monthlySalaryPence: form.payType === "salaried" ? Math.round(Number(form.monthlySalary) * 100) : null,
        contractedWeeklyMinutes: Math.round(Number(form.contractedWeeklyHours) * 60),
        defaultBreakMinutes: Number(form.defaultBreakMinutes),
        active: form.active,
        employmentStatus: form.active ? "employed" : "former",
        endDate: form.endDate || null,
      };
      repo.updateStaff(next, {
        staffId: staff.id,
        payType: form.payType,
        hourlyRatePence: next.hourlyRatePence,
        monthlySalaryPence: next.monthlySalaryPence,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: null,
      });
      if (form.temporaryPin) repo.changePin(staff.id, form.temporaryPin);
    }
    onClose();
  }

  return (
    <Modal title={staff ? "Edit staff member" : "Add staff member"} onClose={onClose}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full name"><input className={inputClassName()} value={form.fullName} onChange={(event) => set("fullName", event.target.value)} /></Field>
          <Field label="Display name"><input className={inputClassName()} value={form.displayName} onChange={(event) => set("displayName", event.target.value)} /></Field>
          <Field label="Role"><input className={inputClassName()} value={form.role} onChange={(event) => set("role", event.target.value)} /></Field>
          <Field label="Pay type">
            <select className={inputClassName()} value={form.payType} onChange={(event) => set("payType", event.target.value as "hourly" | "salaried")}>
              <option value="hourly">Hourly</option>
              <option value="salaried">Salaried</option>
            </select>
          </Field>
          {form.payType === "hourly" ? (
            <Field label="Hourly rate"><input className={inputClassName()} value={form.hourlyRate} onChange={(event) => set("hourlyRate", Number(event.target.value))} type="number" step="0.01" /></Field>
          ) : (
            <Field label="Monthly salary"><input className={inputClassName()} value={form.monthlySalary} onChange={(event) => set("monthlySalary", Number(event.target.value))} type="number" step="0.01" /></Field>
          )}
          <Field label="Contracted weekly hours"><input className={inputClassName()} value={form.contractedWeeklyHours} onChange={(event) => set("contractedWeeklyHours", Number(event.target.value))} type="number" step="0.25" /></Field>
          <Field label="Default unpaid break"><input className={inputClassName()} value={form.defaultBreakMinutes} onChange={(event) => set("defaultBreakMinutes", Number(event.target.value))} type="number" /></Field>
          <Field label="Start date"><input className={inputClassName()} value={form.startDate} onChange={(event) => set("startDate", event.target.value)} type="date" /></Field>
          <Field label={staff ? "Reset temporary PIN" : "Temporary PIN"}><input className={inputClassName()} value={form.temporaryPin} onChange={(event) => set("temporaryPin", event.target.value)} inputMode="numeric" /></Field>
          {staff && <Field label="Rate effective from"><input className={inputClassName()} value={form.effectiveFrom} onChange={(event) => set("effectiveFrom", event.target.value)} type="date" /></Field>}
          {staff && <Field label="End date"><input className={inputClassName()} value={form.endDate} onChange={(event) => set("endDate", event.target.value)} type="date" /></Field>}
        </div>
        <label className="flex items-center gap-3 text-sm font-semibold text-purple-950">
          <input checked={form.active} onChange={(event) => set("active", event.target.checked)} type="checkbox" className="h-5 w-5 accent-purple-700" />
          Active staff member
        </label>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        <div className="flex justify-end gap-3"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit"><Save className="h-4 w-4" /> Save</Button></div>
      </form>
    </Modal>
  );
}

function RotaScreen() {
  const repo = useDemoRepository();
  const clock = createAppClock(repo.state.settings);
  const [start, setStart] = useState(clock.currentWeekStart());
  const [editing, setEditing] = useState<RotaShift | null>(null);
  const [view, setView] = useState<"week" | "day" | "staff">(() => (typeof window === "undefined" ? "week" : (sessionStorage.getItem("jan-staff-rota-view") as "week" | "day" | "staff" | null) ?? "week"));
  const [selectedDate, setSelectedDate] = useState(clock.today());
  const [selectedStaffId, setSelectedStaffId] = useState(repo.state.staff.find((person) => person.active)?.id ?? "");
  const dates = weekDates(start, repo.state.settings.showWeekends);
  const weekShifts = repo.state.rota.filter((shift) => dates.includes(shift.date));
  const setRotaView = (next: "week" | "day" | "staff") => {
    setView(next);
    sessionStorage.setItem("jan-staff-rota-view", next);
  };

  return (
    <>
      <PageHeader
        title="Weekly rota"
        body="A familiar weekly rota with live totals, edit cells, copy controls and print styling."
        action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button><Button variant="secondary" onClick={() => repo.copyPreviousWeek(start)}>Copy previous week</Button><Button variant="danger" onClick={() => confirm("Clear this draft week?") && repo.clearWeek(start)}><Trash2 className="h-4 w-4" /> Clear week</Button></div>}
      />
      <Panel className="print:shadow-none">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button variant="secondary" aria-label="Previous week" onClick={() => setStart(isoDate(addWeeks(parseISO(start), -1)))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="secondary" onClick={() => setStart(clock.currentWeekStart())}>This week</Button>
            <Button variant="secondary" aria-label="Next week" onClick={() => setStart(isoDate(addWeeks(parseISO(start), 1)))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <p className="font-black text-purple-950">Week commencing {formatDateUk(start)}</p>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant={view === "week" ? "primary" : "secondary"} onClick={() => setRotaView("week")}>Week grid</Button>
          <Button variant={view === "day" ? "primary" : "secondary"} onClick={() => setRotaView("day")}>Day view</Button>
          <Button variant={view === "staff" ? "primary" : "secondary"} onClick={() => setRotaView("staff")}>Staff view</Button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {(["working", "holiday", "sick", "training", "off"] as RotaShift["status"][]).map((status) => (
            <span key={status} className={`rounded-full border px-3 py-1 font-bold capitalize ${statusStyle(status)}`}>{status}</span>
          ))}
          <StatusPill tone="green">Paid status</StatusPill>
          <StatusPill tone="grey">Unpaid status</StatusPill>
        </div>
        {view === "week" && <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-purple-50 px-3 py-3 text-left font-black text-purple-950">Staff</th>
                {dates.map((date) => <th key={date} className="bg-purple-50 px-3 py-3 text-left font-black text-purple-950">{format(parseISO(date), "EEE dd/MM")}</th>)}
                <th className="bg-purple-50 px-3 py-3 text-left font-black text-purple-950">Weekly total</th>
              </tr>
            </thead>
            <tbody>
              {repo.state.staff.filter((person) => person.active).map((person) => (
                <tr key={person.id}>
                  <td className="sticky left-0 z-10 border-b border-purple-50 bg-white px-3 py-3 font-bold text-purple-950">{person.displayName}<p className="text-xs text-slate-500">{formatHours(person.contractedWeeklyMinutes)} contract</p></td>
                  {dates.map((date) => {
                    const shift = repo.state.rota.find((item) => item.staffId === person.id && item.date === date) ?? {
                      id: `new-${person.id}-${date}`,
                      staffId: person.id,
                      date,
                      scheduledStart: "08:30",
                      scheduledEnd: "16:30",
                      status: "working",
                      plannedBreakMinutes: person.defaultBreakMinutes,
                    } satisfies RotaShift;
                    const warnings = rotaWarnings(shift, person, repo.state.leaveRequests);
                    return (
                      <td key={date} className="border-b border-purple-50 px-2 py-2">
                        <button aria-label={`Edit ${person.displayName} on ${formatDateUk(date)}. ${shift.status}. ${shift.scheduledStart ?? "No start"} to ${shift.scheduledEnd ?? "No finish"}.`} className={`min-h-28 w-full rounded-xl border p-3 text-left transition hover:border-purple-400 focus:outline-purple-700 ${statusStyle(shift.status)}`} onClick={() => setEditing(shift)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setEditing(shift); }}>
                          <span className="font-bold capitalize text-purple-950">{shift.status}</span>
                          <span className="mt-1 block"><PayTreatmentBadge shift={shift} /></span>
                          <span className="mt-1 block text-slate-700">{shift.scheduledStart ?? "-"} to {shift.scheduledEnd ?? "-"}</span>
                          <span className="mt-1 block text-xs font-bold text-slate-600">{shift.status === "working" ? formatHours(shiftScheduledMinutes(shift)) : `${formatHours(shift.creditedMinutes ?? 0)} credited`}</span>
                          {shift.notes && <span className="mt-1 block text-xs text-slate-500">{shift.notes}</span>}
                          {warnings.length > 0 && <span className="mt-2 inline-flex text-xs font-bold text-amber-700"><AlertTriangle className="mr-1 h-4 w-4" /> {warnings[0]}</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-purple-50 px-3 py-3 font-black text-purple-950">{formatHours(weeklyRotaTotal(person.id, weekShifts))}<p className="text-xs text-green-700">{formatHours(weeklyPaidStatusTotal(person.id, weekShifts))} paid status</p></td>
                </tr>
              ))}
              <tr className="bg-purple-50/70">
                <td className="sticky left-0 z-10 bg-purple-50 px-3 py-3 font-black text-purple-950">Daily totals</td>
                {dates.map((date) => {
                  const daily = weekShifts.filter((shift) => shift.date === date);
                  const workingMinutes = daily.filter((shift) => shift.status === "working").reduce((sum, shift) => sum + shiftScheduledMinutes(shift), 0);
                  const paidMinutes = daily.reduce((sum, shift) => sum + shiftPayableStatusMinutes(shift), 0);
                  return (
                    <td key={date} className="px-3 py-3 text-xs font-semibold text-purple-950">
                      <p>{formatHours(workingMinutes)} working</p>
                      <p>{formatHours(paidMinutes)} paid status</p>
                      <p>{daily.filter((shift) => shift.status === "working").length} scheduled</p>
                      <p>{daily.filter((shift) => shift.status !== "working").length} off/special</p>
                    </td>
                  );
                })}
                <td className="px-3 py-3" />
              </tr>
            </tbody>
          </table>
        </div>}
        {view === "day" && (
          <div>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <Button variant="secondary" onClick={() => setSelectedDate(isoDate(addWeeks(parseISO(selectedDate), 0)))}>Selected day</Button>
              <Field label="Date"><input className={inputClassName()} type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></Field>
            </div>
            <DataTable
              headers={["Staff", "Status", "Start", "Finish", "Break", "Pay", "Credited", "Room or duty", "Warnings", "Edit"]}
              rows={repo.state.staff.filter((person) => person.active).map((person) => {
                const shift = repo.state.rota.find((item) => item.staffId === person.id && item.date === selectedDate) ?? { id: `new-${person.id}-${selectedDate}`, staffId: person.id, date: selectedDate, scheduledStart: "08:30", scheduledEnd: "16:30", status: "working", plannedBreakMinutes: person.defaultBreakMinutes } satisfies RotaShift;
                return [person.displayName, titleCase(shift.status), shift.scheduledStart ?? "-", shift.scheduledEnd ?? "-", shift.plannedBreakMinutes, <PayTreatmentBadge key="pay" shift={shift} />, formatHours(shift.creditedMinutes ?? shiftScheduledMinutes(shift)), shift.roomOrRole ?? "", rotaWarnings(shift, person, repo.state.leaveRequests).join(", ") || "None", <Button key="edit" variant="secondary" aria-label={`Edit ${person.displayName} on ${formatDateUk(selectedDate)}`} onClick={() => setEditing(shift)}>Edit</Button>];
              })}
            />
          </div>
        )}
        {view === "staff" && (
          <div>
            <div className="mb-4 max-w-sm"><Field label="Staff member"><select className={inputClassName()} value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value)}>{repo.state.staff.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></Field></div>
            {(() => {
              const person = repo.state.staff.find((item) => item.id === selectedStaffId);
              if (!person) return <EmptyState title="No staff selected" body="Choose a staff member to view their rota." />;
              const total = weeklyRotaTotal(person.id, weekShifts);
              return (
                <>
                  <p className="mb-3 rounded-xl bg-purple-50 p-3 text-sm font-bold text-purple-950">Weekly total {formatHours(total)}. Contract {formatDurationCompact(person.contractedWeeklyMinutes)}. Difference {formatHours(total - person.contractedWeeklyMinutes)}.</p>
                  <DataTable
                    headers={["Day", "Status", "Times", "Break", "Credited", "Pay", "Warnings", "Edit"]}
                    rows={dates.map((date) => {
                      const shift = repo.state.rota.find((item) => item.staffId === person.id && item.date === date) ?? { id: `new-${person.id}-${date}`, staffId: person.id, date, scheduledStart: "08:30", scheduledEnd: "16:30", status: "working", plannedBreakMinutes: person.defaultBreakMinutes } satisfies RotaShift;
                      return [formatDateUk(date), titleCase(shift.status), `${shift.scheduledStart ?? "-"} to ${shift.scheduledEnd ?? "-"}`, shift.plannedBreakMinutes, formatHours(shift.creditedMinutes ?? shiftScheduledMinutes(shift)), <PayTreatmentBadge key="pay" shift={shift} />, rotaWarnings(shift, person, repo.state.leaveRequests).join(", ") || "None", <Button key="edit" variant="secondary" aria-label={`Edit ${person.displayName} on ${formatDateUk(date)}`} onClick={() => setEditing(shift)}>Edit</Button>];
                    })}
                  />
                </>
              );
            })()}
          </div>
        )}
      </Panel>
      {editing && <ShiftModal shift={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ShiftModal({ shift, onClose }: { shift: RotaShift; onClose: () => void }) {
  const repo = useDemoRepository();
  const [draft, setDraft] = useState(shift);
  const staff = repo.state.staff.find((person) => person.id === draft.staffId);
  const warnings = rotaWarnings(draft, staff, repo.state.leaveRequests);
  function save() {
    if (warnings.some((warning) => warning.includes("leave")) && !confirm("This shift overlaps leave. Save the shift and keep the conflict warning?")) return;
    repo.saveShift(draft);
    onClose();
  }
  return (
    <Modal title={`Edit shift for ${formatDateUk(shift.date)}`} onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Status"><select className={inputClassName()} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as RotaShift["status"] })}><option value="working">Working</option><option value="off">Off</option><option value="holiday">Holiday</option><option value="sick">Sick</option><option value="training">Training</option></select></Field>
        <Field label="Room or duty"><input className={inputClassName()} value={draft.roomOrRole ?? ""} onChange={(e) => setDraft({ ...draft, roomOrRole: e.target.value })} /></Field>
        <Field label="Start time"><input className={inputClassName()} value={draft.scheduledStart ?? ""} onChange={(e) => setDraft({ ...draft, scheduledStart: e.target.value })} type="time" /></Field>
        <Field label="Finish time"><input className={inputClassName()} value={draft.scheduledEnd ?? ""} onChange={(e) => setDraft({ ...draft, scheduledEnd: e.target.value })} type="time" /></Field>
        <Field label="Planned break minutes"><input className={inputClassName()} value={draft.plannedBreakMinutes} onChange={(e) => setDraft({ ...draft, plannedBreakMinutes: Number(e.target.value) })} type="number" /></Field>
        {draft.status !== "working" && (
          <>
            <Field label="Pay treatment"><select className={inputClassName()} value={draft.payTreatment ?? "informational"} onChange={(e) => setDraft({ ...draft, payTreatment: e.target.value as RotaShift["payTreatment"] })}><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="informational">Informational only</option></select></Field>
            <Field label="Credited hours"><input className={inputClassName()} value={(draft.creditedMinutes ?? 0) / 60} onChange={(e) => setDraft({ ...draft, creditedMinutes: Math.round(Number(e.target.value) * 60), payableMinutes: draft.payTreatment === "paid" ? Math.round(Number(e.target.value) * 60) : 0 })} type="number" step="0.25" /></Field>
            <Field label="Payable hours"><input className={inputClassName()} value={(draft.payableMinutes ?? 0) / 60} onChange={(e) => setDraft({ ...draft, payableMinutes: Math.round(Number(e.target.value) * 60) })} type="number" step="0.25" /></Field>
          </>
        )}
        <Field label="Notes"><input className={inputClassName()} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
        <Field label="Manager note"><input className={inputClassName()} value={draft.managerNote ?? ""} onChange={(e) => setDraft({ ...draft, managerNote: e.target.value })} /></Field>
      </div>
      {warnings.length > 0 && (
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
          {warnings.join(", ")}
        </div>
      )}
      <div className="mt-5 flex justify-between gap-3">
        <Button variant="secondary" onClick={() => repo.copyPreviousWeek(isoDate(weekStart(shift.date)), shift.staffId)}>Copy employee previous week</Button>
        <div className="flex gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save shift</Button></div>
      </div>
    </Modal>
  );
}

function AttendanceScreen() {
  const repo = useDemoRepository();
  const searchParams = useSearchParams();
  const clock = createAppClock(repo.state.settings);
  const defaultMonth = clock.currentMonthRange();
  const [periodStart, setPeriodStart] = useState(searchParams.get("from") ?? (repo.state.settings.attendanceDefaultRange === "current_month" ? defaultMonth.start : clock.currentWeekStart()));
  const [periodEnd, setPeriodEnd] = useState(searchParams.get("to") ?? (repo.state.settings.attendanceDefaultRange === "current_month" ? defaultMonth.end : isoDate(addWeeks(parseISO(clock.currentWeekStart()), 1))));
  const [staffId, setStaffId] = useState(searchParams.get("staffId") ?? "all");
  const [status, setStatus] = useState<AttendanceTab>((searchParams.get("tab")?.replace("-", "_") as AttendanceTab | null) ?? repo.state.settings.attendanceDefaultTab);
  const [exceptionFilter, setExceptionFilter] = useState(searchParams.get("exception") ?? "all");
  const [pageSize, setPageSize] = useState<number>(repo.state.settings.attendancePageSize);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"date" | "employee" | "status">("date");
  const [selected, setSelected] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState<AttendanceDay | null>(null);
  const allDays = repo.attendanceDays(periodStart, periodEnd, staffId === "all" ? undefined : staffId);
  const summary = {
    needs: allDays.filter((day) => attendanceTabForDay(day) === "needs_review").length,
    ready: allDays.filter((day) => attendanceTabForDay(day) === "ready").length,
    approved: allDays.filter((day) => attendanceTabForDay(day) === "approved").length,
    total: allDays.length,
  };
  const days = allDays
    .filter((day) => status === "all" || attendanceTabForDay(day) === status)
    .filter((day) => exceptionFilter === "all" || day.exceptionFlags.some((flag) => flag.toLowerCase().replaceAll(" ", "-").includes(exceptionFilter)))
    .sort((a, b) => {
      if (sort === "employee") return (repo.state.staff.find((p) => p.id === a.staffId)?.displayName ?? "").localeCompare(repo.state.staff.find((p) => p.id === b.staffId)?.displayName ?? "");
      if (sort === "status") return attendanceTabForDay(a).localeCompare(attendanceTabForDay(b));
      return b.date.localeCompare(a.date);
    });
  const pageCount = Math.max(1, Math.ceil(days.length / pageSize));
  const visibleDays = days.slice((page - 1) * pageSize, page * pageSize);
  const visibleClean = visibleDays.filter(isCleanApprovalCandidate);
  const selectedDays = allDays.filter((day) => selected.includes(`${day.staffId}-${day.date}`));
  const approve = (target: AttendanceDay[], label: string) => {
    if (!repo.state.settings.allowBulkCleanApproval) {
      setFeedback("Bulk clean approval is disabled in Settings.");
      return;
    }
    if (!target.length || !confirm(`${label}?`)) return;
    const result = repo.approveCleanDays(target, label.includes("all clean records") ? "bulk_range" : "bulk_selected");
    setSelected([]);
    setFeedback(`${result.approved} clean record${result.approved === 1 ? "" : "s"} approved. ${result.skipped.length ? `${result.skipped.length} skipped because individual review is required.` : ""}`);
  };
  return (
    <>
      <PageHeader title="Attendance review" body="Review recorded clock events separately from manager-approved payable time." action={<Button variant="secondary" onClick={() => exportAttendanceCsv(days, repo.state.staff, periodStart, periodEnd)}><Download className="h-4 w-4" /> Export CSV</Button>} />
      <Panel>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="From"><input className={inputClassName()} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Field>
          <Field label="To"><input className={inputClassName()} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
          <Field label="Staff"><select className={inputClassName()} value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="all">All staff</option>{repo.state.staff.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></Field>
          <Field label="Exception"><select className={inputClassName()} value={exceptionFilter} onChange={(e) => setExceptionFilter(e.target.value)}><option value="all">All exceptions</option><option value="missing-clock-out">Missing clock-out</option><option value="no-clock-in">Missing clock-in</option><option value="unscheduled">Unscheduled</option><option value="overtime">Overtime</option><option value="approved-differs">Adjusted</option></select></Field>
          <Field label="Sort by"><select className={inputClassName()} value={sort} onChange={(e) => setSort(e.target.value as "date" | "employee" | "status")}><option value="date">Date</option><option value="employee">Employee</option><option value="status">Review status</option></select></Field>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Panel className="shadow-none"><p className="text-sm font-bold text-slate-500">Needs review</p><p className="text-2xl font-black">{summary.needs}</p></Panel>
          <Panel className="shadow-none"><p className="text-sm font-bold text-slate-500">Ready to approve</p><p className="text-2xl font-black">{summary.ready}</p></Panel>
          <Panel className="shadow-none"><p className="text-sm font-bold text-slate-500">Approved</p><p className="text-2xl font-black">{summary.approved}</p></Panel>
          <Panel className="shadow-none"><p className="text-sm font-bold text-slate-500">Total records</p><p className="text-2xl font-black">{summary.total}</p></Panel>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[
            ["needs_review", "Needs review"],
            ["ready", "Ready to approve"],
            ["approved", "Approved"],
            ["all", "All records"],
          ].map(([value, label]) => <Button key={value} variant={status === value ? "primary" : "secondary"} onClick={() => { setStatus(value as AttendanceTab); setPage(1); }}>{label}</Button>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSelected(visibleClean.map((day) => `${day.staffId}-${day.date}`))}>Select all visible clean records</Button>
            <Button onClick={() => approve(selectedDays, "Approve selected clean records")}>Approve selected</Button>
            <Button variant="secondary" onClick={() => approve(allDays.filter(isCleanApprovalCandidate), "Approve all clean records in range")}>Approve all clean records in range</Button>
          </div>
          <label className="text-sm font-semibold text-purple-950">Rows <select className={inputClassName("ml-2")} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
        </div>
        {feedback && <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm font-bold text-green-800">{feedback}</p>}
        {visibleDays.length ? (
          <div className="mt-4 max-h-[680px] overflow-auto rounded-2xl border border-purple-100">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-purple-50">
                <tr>{["", "Date", "Staff", "Scheduled", "Actual", "Recorded", "Approved", "Exceptions", "Status", "Review"].map((h) => <th key={h} className="px-3 py-3 font-black text-purple-950">{h}</th>)}</tr>
              </thead>
              <tbody>
                {visibleDays.map((day) => {
                  const key = `${day.staffId}-${day.date}`;
                  const person = repo.state.staff.find((item) => item.id === day.staffId);
                  const clean = isCleanApprovalCandidate(day);
                  return (
                    <tr key={key} className="border-t border-purple-50">
                      <td className="px-3 py-2"><input type="checkbox" disabled={!clean} checked={selected.includes(key)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, key] : current.filter((item) => item !== key))} className="h-5 w-5 accent-purple-700" /></td>
                      <td className="px-3 py-2">{formatDateUk(day.date)}</td>
                      <td className="px-3 py-2 font-bold text-purple-950">{person?.displayName}</td>
                      <td className="px-3 py-2">{day.shift?.scheduledStart ?? "-"} to {day.shift?.scheduledEnd ?? "-"}</td>
                      <td className="px-3 py-2">{formatTimeUk(day.firstClockIn)} to {formatTimeUk(day.finalClockOut)}</td>
                      <td className="px-3 py-2">{formatHours(day.recordedMinutes)}</td>
                      <td className="px-3 py-2">{formatHours(day.approvedPayableMinutes)}</td>
                      <td className="px-3 py-2">{day.exceptionFlags.length ? day.exceptionFlags.map((flag) => <StatusPill key={flag} tone={hasSeriousException({ exceptionFlags: [flag] }) ? "red" : "amber"}>{flag}</StatusPill>) : <StatusPill tone="green">Clean</StatusPill>}</td>
                      <td className="px-3 py-2"><StatusPill tone={attendanceTabForDay(day) === "approved" ? "green" : attendanceTabForDay(day) === "ready" ? "purple" : "amber"}>{attendanceTabForDay(day).replace("_", " ")}</StatusPill></td>
                      <td className="px-3 py-2"><Button variant="secondary" onClick={() => setEditing(day)}>Review</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No records match" body="Try another tab, date range or staff filter." />}
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
          <p className="text-sm font-bold text-purple-950">Page {page} of {pageCount}. {days.length} matching records.</p>
          <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button>
        </div>
      </Panel>
      {editing && <AttendanceModal day={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AttendanceModal({ day, onClose }: { day: AttendanceDay; onClose: () => void }) {
  const repo = useDemoRepository();
  const person = repo.state.staff.find((item) => item.id === day.staffId);
  const approvalHistory = repo.state.attendanceApprovals.filter((approval) => approval.staffId === day.staffId && approval.date === day.date);
  const [hours, setHours] = useState(Math.floor(day.approvedPayableMinutes / 60));
  const [minutes, setMinutes] = useState(day.approvedPayableMinutes % 60);
  const [reason, setReason] = useState(day.adjustmentReason ?? "");
  const [note, setNote] = useState(day.managerNote ?? "");
  const [error, setError] = useState("");
  function approve() {
    const approvedMinutes = hours * 60 + minutes;
    if (approvedMinutes !== day.recordedMinutes && !reason.trim()) {
      setError("A reason is required when approved time differs from recorded time.");
      return;
    }
    if (approvedMinutes === day.recordedMinutes && isCleanApprovalCandidate(day)) {
      repo.approveCleanDays([day], "individual");
    } else {
      repo.addAdjustment({ staffId: day.staffId, date: day.date, originalRecordedMinutes: day.recordedMinutes, approvedMinutes, reason: reason || "Approved as recorded", managerNote: note });
    }
    onClose();
  }
  return (
    <Modal title={`Review ${person?.displayName} on ${formatDateUk(day.date)}`} onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="shadow-none">
          <h3 className="font-black text-purple-950">Original clock events</h3>
          <div className="mt-3 grid gap-2">{day.events.map((event) => <p key={event.id} className="rounded-xl bg-purple-50 p-3 text-sm"><strong>{event.type.replace("_", " ")}</strong> at {formatTimeUk(event.timestamp)} from {event.source}</p>)}</div>
        </Panel>
        <Panel className="shadow-none">
          <h3 className="font-black text-purple-950">Manager-approved payable time</h3>
          <p className="mt-2 text-sm text-slate-600">Recorded attendance: {formatHours(day.recordedMinutes)}. Original events remain unchanged.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Approved hours"><input className={inputClassName()} type="number" value={hours} onChange={(e) => setHours(Number(e.target.value))} /></Field>
            <Field label="Approved minutes"><input className={inputClassName()} type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>
          </div>
          <Field label="Reason"><input className={inputClassName()} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Manager note"><textarea className={inputClassName("min-h-24")} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
        </Panel>
      </div>
      <Panel className="mt-4 shadow-none">
        <h3 className="font-black text-purple-950">Approval audit</h3>
        {approvalHistory.length ? (
          <div className="mt-3 grid gap-2">
            {approvalHistory.toReversed().map((approval) => (
              <div key={approval.id} className="rounded-xl bg-purple-50 p-3 text-sm">
                <p className="font-bold text-purple-950">{formatHours(approval.approvedMinutes)} approved by {approval.approvedBy} at {formatTimeUk(approval.approvedAt)}</p>
                <p className="text-purple-800">Method: {approval.approvalMethod.replace("_", " ")}. Recorded at approval: {formatHours(approval.recordedMinutesAtApproval)}. Revision {approval.approvalVersion}.</p>
                {approval.adjustmentReason && <p className="text-purple-800">Reason: {approval.adjustmentReason}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">No approval has been recorded yet.</p>
        )}
      </Panel>
      <div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={approve}><CheckCircle2 className="h-4 w-4" /> Approve</Button></div>
    </Modal>
  );
}

function PayrollScreen() {
  const repo = useDemoRepository();
  const clock = createAppClock(repo.state.settings);
  const defaultPayPeriod = clock.currentMonthRange();
  const [periodStart, setPeriodStart] = useState(defaultPayPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPayPeriod.end);
  const [editing, setEditing] = useState<PayPeriodSummary | null>(null);
  const [exportPreview, setExportPreview] = useState<"csv" | "xlsx" | null>(null);
  const summaries = repo.paySummaries(periodStart, periodEnd);
  const attendanceDays = repo.attendanceDays(periodStart, periodEnd);
  const totals = {
    salaried: summaries.reduce((sum, item) => sum + (item.standardSalaryPence ?? 0), 0),
    hourly: summaries.reduce((sum, item) => sum + (item.calculatedHourlyPayPence ?? 0), 0),
    additions: summaries.reduce((sum, item) => sum + item.additionsPence, 0),
    deductions: summaries.reduce((sum, item) => sum + item.deductionsPence, 0),
    final: summaries.reduce((sum, item) => sum + item.finalGrossPayPence, 0),
    reviewed: summaries.filter((item) => item.status === "reviewed").length,
    unreviewed: summaries.filter((item) => item.status !== "reviewed").length,
  };
  const markEligibleReviewed = () => summaries.filter((summary) => summary.unresolvedAttendanceCount === 0).forEach((summary) => repo.savePaySummary({ ...summary, status: "reviewed" }));
  return (
    <>
      <PageHeader title="Pay preparation" body="Estimated and manager-entered figures for payroll preparation. This is not completed payroll." action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setExportPreview("csv")}><Download className="h-4 w-4" /> Export CSV</Button><Button variant="secondary" onClick={() => setExportPreview("xlsx")}><FileSpreadsheet className="h-4 w-4" /> Export Excel workbook</Button></div>} />
      <Panel>
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <Field label="Period start"><input className={inputClassName()} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Field>
          <Field label="Period end"><input className={inputClassName()} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {[
            ["Total salaried", formatMoney(totals.salaried)],
            ["Calculated hourly", formatMoney(totals.hourly)],
            ["Additions", formatMoney(totals.additions)],
            ["Deductions", formatMoney(totals.deductions)],
            ["Final gross", formatMoney(totals.final)],
            ["Reviewed", totals.reviewed],
            ["Still requiring review", totals.unreviewed],
          ].map(([label, value]) => <Panel key={String(label)} className="shadow-none"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-lg font-black text-purple-950">{value}</p></Panel>)}
        </div>
        <p className="mb-4 rounded-xl bg-purple-50 p-3 text-sm font-semibold text-purple-900">Attendance information is shown for review. Salaried pay is not automatically reduced.</p>
        <div className="mb-4"><Button variant="secondary" onClick={markEligibleReviewed}><BadgeCheck className="h-4 w-4" /> Mark all eligible employees reviewed</Button></div>
        <DataTable
          headers={["Staff", "Type", "Recorded", "Approved", "Provisional", "Paid status", "Warnings", "Calculated", "Final gross", "Status", "Action"]}
          rows={summaries.map((summary) => {
            const person = repo.state.staff.find((item) => item.id === summary.staffId);
            const warnings = [
              summary.unresolvedAttendanceCount ? `${summary.unresolvedAttendanceCount} unresolved attendance record(s)` : "",
              summary.cleanUnapprovedCount ? `${summary.cleanUnapprovedCount} clean record(s) awaiting approval` : "",
              summary.missingClockDataCount ? `${summary.missingClockDataCount} day(s) missing clock data` : "",
              summary.recordedMinutes > 0 && summary.approvedMinutes === 0 ? "Attendance recorded but not approved" : "",
            ].filter(Boolean);
            const reviewTab = summary.cleanUnapprovedCount && !summary.unresolvedAttendanceCount ? "ready" : "needs-review";
            const exception = summary.missingClockDataCount ? "&exception=missing-clock-out" : "";
            const attendanceLink = `/attendance?staffId=${summary.staffId}&from=${periodStart}&to=${periodEnd}&tab=${reviewTab}${exception}`;
            return [
              person?.displayName ?? "",
              titleCase(summary.payType),
              formatHours(summary.recordedMinutes),
              formatHours(summary.approvedMinutes),
              summary.payType === "hourly" && summary.provisionalMinutes ? <span key="prov">{formatHours(summary.provisionalMinutes)}<br /><span className="text-xs font-bold text-purple-700">{formatMoney(summary.provisionalHourlyPayPence)} provisional</span></span> : "-",
              `${formatHours(summary.paidHolidayMinutes)} holiday / ${formatHours(summary.paidSicknessMinutes)} sick / ${formatHours(summary.paidTrainingMinutes)} training`,
              warnings.length ? <div key="warnings" className="grid gap-1">{warnings.map((warning) => <p key={warning} className="text-xs font-bold text-amber-700">{warning}</p>)}<Button variant="ghost" className="min-h-8 justify-start px-0" onClick={() => { window.location.href = attendanceLink; }}>Review attendance</Button></div> : <StatusPill tone="green">Clear</StatusPill>,
              summary.payType === "hourly" ? formatMoney(summary.calculatedHourlyPayPence) : "Salary unchanged",
              formatMoney(summary.finalGrossPayPence),
              <StatusPill key="s" tone={summary.status === "reviewed" ? "green" : "amber"}>{summary.status}</StatusPill>,
              <Button key="b" variant="secondary" onClick={() => setEditing(summary)}>Edit</Button>,
            ];
          })}
        />
      </Panel>
      {editing && <PayModal summary={editing} onClose={() => setEditing(null)} />}
      {exportPreview && (
        <ExportPreviewModal
          type={exportPreview}
          periodStart={periodStart}
          periodEnd={periodEnd}
          summaries={summaries}
          days={attendanceDays}
          staff={repo.state.staff}
          onClose={() => setExportPreview(null)}
          onContinue={() => {
            if (exportPreview === "csv") exportPayCsv(summaries, repo.state.staff, periodStart, periodEnd);
            else exportPayWorkbook(summaries, attendanceDays, repo.state.staff, periodStart, periodEnd);
            setExportPreview(null);
          }}
        />
      )}
    </>
  );
}

function ExportPreviewModal({
  type,
  periodStart,
  periodEnd,
  summaries,
  days,
  staff,
  onClose,
  onContinue,
}: {
  type: "csv" | "xlsx";
  periodStart: string;
  periodEnd: string;
  summaries: PayPeriodSummary[];
  days: AttendanceDay[];
  staff: StaffMember[];
  onClose: () => void;
  onContinue: () => void;
}) {
  const unresolved = days.filter((day) => attendanceTabForDay(day) === "needs_review").length;
  const provisional = days.filter((day) => day.provisionalPayableMinutes > 0).length;
  const approved = days.filter((day) => day.approvalStatus === "approved").length;
  const filename = type === "csv" ? `jan-staff-pay-preparation-${periodStart}-to-${periodEnd}.csv` : `jan-staff-pay-workbook-${periodStart}-to-${periodEnd}.xlsx`;
  return (
    <Modal title={`Preview ${type.toUpperCase()} export`} onClose={onClose} description="Review export contents before downloading.">
      {unresolved > 0 && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">This export includes unresolved attendance. Some pay figures may be incomplete or provisional.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <p><strong>Date range:</strong> {formatDateUk(periodStart)} to {formatDateUk(periodEnd)}</p>
        <p><strong>Filename:</strong> {filename}</p>
        <p><strong>Staff included:</strong> {summaries.length}</p>
        <p><strong>Attendance rows:</strong> {days.length}</p>
        <p><strong>Approved records:</strong> {approved}</p>
        <p><strong>Provisional records:</strong> {provisional}</p>
        <p><strong>Unresolved records:</strong> {unresolved}</p>
        <p><strong>Salaried staff:</strong> {summaries.some((summary) => summary.payType === "salaried") ? "Included" : "None"}</p>
        <p><strong>Inactive historic staff:</strong> {staff.some((person) => !person.active && days.some((day) => day.staffId === person.id)) ? "Included" : "None"}</p>
        <p><strong>Sheets:</strong> {type === "xlsx" ? "Pay Summary, Attendance Detail" : "Single CSV file"}</p>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" onClick={() => { window.location.href = `/attendance?from=${periodStart}&to=${periodEnd}&tab=needs-review`; }}>Return to review attendance</Button>
        <Button onClick={onContinue}>Continue export</Button>
      </div>
    </Modal>
  );
}

function PayModal({ summary, onClose }: { summary: PayPeriodSummary; onClose: () => void }) {
  const repo = useDemoRepository();
  const [draft, setDraft] = useState(summary);
  const [error, setError] = useState("");
  function save(status: PayPeriodSummary["status"]) {
    const suggestedValue = suggested + draft.additionsPence - draft.deductionsPence;
    if (Math.abs(draft.finalGrossPayPence - suggestedValue) >= repo.state.settings.materialPayAdjustmentThresholdPence && !draft.managerNotes.trim()) {
      setError(`Add a manager note when final pay differs from suggested pay by ${formatMoney(repo.state.settings.materialPayAdjustmentThresholdPence)} or more.`);
      return;
    }
    repo.savePaySummary({ ...draft, status });
    onClose();
  }
  const suggested = draft.payType === "hourly" ? draft.calculatedHourlyPayPence ?? 0 : draft.standardSalaryPence ?? 0;
  return (
    <Modal title="Edit pay preparation" onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Additions"><input className={inputClassName()} type="number" step="0.01" value={draft.additionsPence / 100} onChange={(e) => setDraft({ ...draft, additionsPence: Math.round(Number(e.target.value) * 100) })} /></Field>
        <Field label="Deductions"><input className={inputClassName()} type="number" step="0.01" value={draft.deductionsPence / 100} onChange={(e) => setDraft({ ...draft, deductionsPence: Math.round(Number(e.target.value) * 100) })} /></Field>
        <Field label="Final gross pay"><input className={inputClassName()} type="number" step="0.01" value={draft.finalGrossPayPence / 100} onChange={(e) => setDraft({ ...draft, finalGrossPayPence: Math.round(Number(e.target.value) * 100) })} /></Field>
        <Field label="Manager notes"><textarea className={inputClassName("min-h-24")} value={draft.managerNotes} onChange={(e) => setDraft({ ...draft, managerNotes: e.target.value })} /></Field>
      </div>
      {draft.finalGrossPayPence !== suggested + draft.additionsPence - draft.deductionsPence && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Final pay differs from suggested pay.</p>}
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-3"><Button variant="secondary" onClick={() => setDraft({ ...draft, finalGrossPayPence: suggested + draft.additionsPence - draft.deductionsPence })}><RefreshCcw className="h-4 w-4" /> Reset figure</Button><Button variant="secondary" onClick={() => save("draft")}>Mark unreviewed</Button><Button variant="secondary" onClick={() => save("draft")}>Save draft</Button><Button onClick={() => save("reviewed")}>Mark reviewed</Button></div>
    </Modal>
  );
}

function SettingsScreen() {
  const repo = useDemoRepository();
  const [settings, setSettings] = useState(repo.state.settings);
  return (
    <>
      <PageHeader title="Settings" body="Prototype settings that affect warnings, rota columns and kiosk behaviour where practical." />
      <Panel>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nursery display name"><input className={inputClassName()} value={settings.nurseryDisplayName} onChange={(e) => setSettings({ ...settings, nurseryDisplayName: e.target.value })} /></Field>
          <Field label="Default unpaid break"><input className={inputClassName()} type="number" value={settings.defaultBreakMinutes} onChange={(e) => setSettings({ ...settings, defaultBreakMinutes: Number(e.target.value) })} /></Field>
          <Field label="Late arrival warning threshold"><input className={inputClassName()} type="number" value={settings.lateArrivalThresholdMinutes} onChange={(e) => setSettings({ ...settings, lateArrivalThresholdMinutes: Number(e.target.value) })} /></Field>
          <Field label="Overtime warning threshold"><input className={inputClassName()} type="number" value={settings.overtimeWarningThresholdMinutes} onChange={(e) => setSettings({ ...settings, overtimeWarningThresholdMinutes: Number(e.target.value) })} /></Field>
          <Field label="Maximum plausible shift minutes"><input className={inputClassName()} type="number" value={settings.maximumShiftMinutes} onChange={(e) => setSettings({ ...settings, maximumShiftMinutes: Number(e.target.value) })} /></Field>
          <Field label="Kiosk auto-return seconds"><input className={inputClassName()} type="number" value={settings.kioskAutoReturnSeconds} onChange={(e) => setSettings({ ...settings, kioskAutoReturnSeconds: Number(e.target.value) })} /></Field>
          <Field label="Demo today (development only)"><input className={inputClassName()} type="date" value={settings.demoToday} onChange={(e) => setSettings({ ...settings, demoToday: e.target.value })} /></Field>
          <Field label="Attendance default range"><select className={inputClassName()} value={settings.attendanceDefaultRange} onChange={(e) => setSettings({ ...settings, attendanceDefaultRange: e.target.value as "current_week" | "current_month" })}><option value="current_week">Current week</option><option value="current_month">Current month</option></select></Field>
          <Field label="Attendance default tab"><select className={inputClassName()} value={settings.attendanceDefaultTab} onChange={(e) => setSettings({ ...settings, attendanceDefaultTab: e.target.value as AttendanceTab })}><option value="needs_review">Needs review</option><option value="ready">Ready to approve</option><option value="approved">Approved</option><option value="all">All records</option></select></Field>
          <Field label="Attendance page size"><select className={inputClassName()} value={settings.attendancePageSize} onChange={(e) => setSettings({ ...settings, attendancePageSize: Number(e.target.value) as 25 | 50 | 100 })}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></Field>
          <Field label="Material pay change threshold"><input className={inputClassName()} type="number" step="0.01" value={settings.materialPayAdjustmentThresholdPence / 100} onChange={(e) => setSettings({ ...settings, materialPayAdjustmentThresholdPence: Math.round(Number(e.target.value) * 100) })} /></Field>
          <Field label="Default holiday pay treatment"><select className={inputClassName()} value={settings.defaultHolidayPayTreatment} onChange={(e) => setSettings({ ...settings, defaultHolidayPayTreatment: e.target.value as "paid" | "unpaid" | "informational" })}><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="informational">Informational only</option></select></Field>
          <Field label="Default sickness pay treatment"><select className={inputClassName()} value={settings.defaultSicknessPayTreatment} onChange={(e) => setSettings({ ...settings, defaultSicknessPayTreatment: e.target.value as "paid" | "unpaid" | "informational" })}><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="informational">Informational only</option></select></Field>
          <Field label="Default training pay treatment"><select className={inputClassName()} value={settings.defaultTrainingPayTreatment} onChange={(e) => setSettings({ ...settings, defaultTrainingPayTreatment: e.target.value as "paid" | "unpaid" | "informational" })}><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="informational">Informational only</option></select></Field>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="flex items-center gap-3 font-semibold text-purple-950"><input type="checkbox" checked={settings.showWeekends} onChange={(e) => setSettings({ ...settings, showWeekends: e.target.checked })} className="h-5 w-5 accent-purple-700" /> Show weekend rota columns</label>
          <label className="flex items-center gap-3 font-semibold text-purple-950"><input type="checkbox" checked={settings.allowBulkCleanApproval} onChange={(e) => setSettings({ ...settings, allowBulkCleanApproval: e.target.checked })} className="h-5 w-5 accent-purple-700" /> Allow clean attendance bulk approval</label>
          <label className="flex items-center gap-3 font-semibold text-purple-950"><input type="checkbox" checked={settings.showProvisionalHourlyPay} onChange={(e) => setSettings({ ...settings, showProvisionalHourlyPay: e.target.checked })} className="h-5 w-5 accent-purple-700" /> Show provisional hourly pay</label>
          <p className="text-sm text-slate-600">Week starts Monday, currency is GBP, and timezone is Europe/London.</p>
        </div>
        <div className="mt-5 flex flex-wrap justify-between gap-3"><Button variant="danger" onClick={() => confirm("Reset all demo data?") && repo.reseed()}><RefreshCcw className="h-4 w-4" /> Reset and reseed demo data</Button><Button onClick={() => repo.updateSettings(settings)}>Save settings</Button></div>
      </Panel>
      {process.env.NODE_ENV !== "production" && (
        <Panel className="mt-4">
          <h2 className="text-xl font-black text-purple-950">Development-only scenario controls</h2>
          <p className="mt-1 text-sm text-slate-600">These controls create identifiable scenario records for testing. They are hidden in production builds.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["clean_week", "Generate clean attendance week"],
              ["missing_clock_out", "Add missing clock-out"],
              ["late_arrival", "Add late arrival"],
              ["early_departure", "Add early departure"],
              ["overtime_day", "Add overtime day"],
              ["paid_holiday", "Add paid holiday"],
              ["unpaid_sickness", "Add unpaid sickness"],
              ["paid_training", "Add paid training"],
            ].map(([kind, label]) => (
              <Button key={kind} variant="secondary" onClick={() => { repo.addDevelopmentScenario(kind); alert(`${label} scenario added.`); }}>{label}</Button>
            ))}
            <Button variant="danger" onClick={() => { if (confirm("Clear generated scenarios?")) repo.clearDevelopmentScenarios(); }}>Clear generated scenarios</Button>
          </div>
        </Panel>
      )}
    </>
  );
}

function Modal({ title, children, onClose, description }: { title: string; children: React.ReactNode; onClose: () => void; description?: string }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const focusable = dialogRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled"));
        if (!items.length) return;
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      openerRef.current?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-purple-950/40 p-4" role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby={description ? "dialog-description" : undefined} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 id="dialog-title" className="text-2xl font-black text-purple-950">{title}</h2>
            {description && <p id="dialog-description" className="mt-1 text-sm text-slate-600">{description}</p>}
          </div>
          <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ClockKiosk() {
  const repo = useDemoRepository();
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"select" | "pin" | "change" | "actions" | "success">("select");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState("");
  const clock = createAppClock(repo.state.settings);
  const today = clock.now().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const currentState = selected ? repo.attendanceDays(clock.today(), clock.today(), selected.id)[0] : undefined;
  const lastType = currentState?.events.at(-1)?.type;
  const actions: { label: string; type: ClockEventType }[] = !lastType || lastType === "clock_out" ? [{ label: "Clock in", type: "clock_in" }] : lastType === "break_start" ? [{ label: "End break", type: "break_end" }] : [{ label: "Start break", type: "break_start" }, { label: "Clock out", type: "clock_out" }];

  function pressDigit(digit: string) {
    if (pin.length < 6) setPin((value) => value + digit);
  }
  function submitPin() {
    if (!selected) return;
    const result = repo.verifyPin(selected.id, pin);
    setPin("");
    if (result === "ok") setMode("actions");
    if (result === "change_required") setMode("change");
    if (result === "error") setMessage("PIN not recognised. Please try again.");
  }
  function completeAction(type: ClockEventType) {
    if (!selected) return;
    repo.addClockEvent(selected.id, type);
    setMessage(`${type.replace("_", " ")} recorded for ${selected.displayName} at ${formatTimeUk(new Date())}`);
    setMode("success");
    window.setTimeout(() => {
      setSelected(null);
      setMode("select");
      setMessage("");
    }, repo.state.settings.kioskAutoReturnSeconds * 1000);
  }
  function savePin() {
    if (!selected) return;
    if (newPin !== confirmPin || !/^\d{4,6}$/.test(newPin)) {
      setMessage("Choose matching PINs of four to six digits.");
      return;
    }
    repo.changePin(selected.id, newPin);
    setMessage("New PIN saved. Please use it for future clocking.");
    setMode("actions");
  }

  return (
    <DemoGuard>
      <main className="min-h-screen bg-purple-950 p-4 text-white">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col rounded-[2rem] bg-lavender p-5 text-purple-950 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <BrandMark />
            <div className="text-right"><p className="text-sm font-bold text-purple-700">{today}</p><LiveTime /></div>
          </div>
          {mode === "select" && (
            <>
              <h1 className="mt-10 text-center text-4xl font-black">Staff clock in</h1>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {repo.state.staff.filter((person) => person.active).map((person) => (
                  <button key={person.id} className="min-h-24 rounded-2xl bg-white p-5 text-left text-2xl font-black text-purple-950 shadow-soft ring-1 ring-purple-100 transition hover:ring-purple-500 focus:outline-purple-700" onClick={() => { setSelected(person); setMode("pin"); setMessage(""); }}>
                    {person.displayName}<span className="mt-2 block text-sm font-semibold text-slate-500">{person.role}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {mode === "pin" && selected && (
            <KioskPanel title={`Enter PIN for ${selected.displayName}`} message={message}>
              <div className="mx-auto max-w-sm">
                <div className="mb-5 rounded-2xl bg-white p-5 text-center text-4xl tracking-[0.5rem] shadow-soft">{pin.replace(/./g, "•") || " "}</div>
                <Keypad onDigit={pressDigit} onBack={() => setPin((v) => v.slice(0, -1))} onClear={() => setPin("")} />
                <div className="mt-5 grid grid-cols-2 gap-3"><Button variant="secondary" onClick={() => { setSelected(null); setMode("select"); }}>Cancel</Button><Button onClick={submitPin}>Continue</Button></div>
              </div>
            </KioskPanel>
          )}
          {mode === "change" && selected && (
            <KioskPanel title="Choose a new PIN" message={message}>
              <div className="mx-auto grid max-w-sm gap-4"><input className={inputClassName("text-center text-2xl")} value={newPin} onChange={(e) => setNewPin(e.target.value)} inputMode="numeric" placeholder="New PIN" /><input className={inputClassName("text-center text-2xl")} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} inputMode="numeric" placeholder="Confirm PIN" /><Button onClick={savePin}>Save PIN</Button></div>
            </KioskPanel>
          )}
          {mode === "actions" && selected && (
            <KioskPanel title={`Hello ${selected.displayName}`} message="Choose the action you need.">
              <div className="mx-auto grid max-w-xl gap-4 sm:grid-cols-2">{actions.map((action) => <button key={action.type} className="min-h-28 rounded-2xl bg-purple-700 p-6 text-2xl font-black text-white shadow-soft hover:bg-purple-800" onClick={() => completeAction(action.type)}>{action.label}</button>)}</div>
              <div className="mt-5 text-center"><Button variant="secondary" onClick={() => { setSelected(null); setMode("select"); }}>Done</Button></div>
            </KioskPanel>
          )}
          {mode === "success" && <KioskPanel title="Recorded" message={message}><CheckCircle2 className="mx-auto h-24 w-24 text-green-600" /><div className="mt-6 text-center"><Button onClick={() => { setSelected(null); setMode("select"); }}>Done</Button></div></KioskPanel>}
        </div>
      </main>
    </DemoGuard>
  );
}

function LiveTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <p className="text-3xl font-black text-purple-950">{formatTimeUk(now)}</p>;
}

function KioskPanel({ title, message, children }: { title: string; message: string; children: React.ReactNode }) {
  return <div className="grid flex-1 place-items-center py-10"><div className="w-full"><h1 className="text-center text-4xl font-black">{title}</h1>{message && <p className="mx-auto mt-4 max-w-xl text-center text-lg font-semibold text-purple-700">{message}</p>}<div className="mt-8">{children}</div></div></div>;
}

function Keypad({ onDigit, onBack, onClear }: { onDigit: (digit: string) => void; onBack: () => void; onClear: () => void }) {
  return <div className="grid grid-cols-3 gap-3">{["1","2","3","4","5","6","7","8","9"].map((digit) => <button key={digit} aria-label={`PIN digit ${digit}`} className="min-h-20 rounded-2xl bg-white text-3xl font-black shadow-soft" onClick={() => onDigit(digit)}>{digit}</button>)}<button aria-label="Clear PIN" className="min-h-20 rounded-2xl bg-white text-xl font-black shadow-soft" onClick={onClear}>Clear</button><button aria-label="PIN digit 0" className="min-h-20 rounded-2xl bg-white text-3xl font-black shadow-soft" onClick={() => onDigit("0")}>0</button><button aria-label="Backspace PIN" className="min-h-20 rounded-2xl bg-white text-xl font-black shadow-soft" onClick={onBack}>Back</button></div>;
}
