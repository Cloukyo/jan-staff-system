import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  CreditCard,
  KeyRound,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { EmptyState, Panel, StatusPill } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";
import type { ProductionDashboardSummary } from "@/lib/dashboard/types";

type SummaryItem = {
  key: keyof Pick<
    ProductionDashboardSummary,
    | "activeStaff"
    | "expiredCertificates"
    | "certificatesExpiring30Days"
    | "incompleteCentralRecords"
    | "staffMissingKioskPin"
    | "staffMissingPayArrangement"
  >;
  label: string;
  href: string;
  icon: typeof Users;
};

const recordSummaryItems: SummaryItem[] = [
  { key: "activeStaff", label: "Active staff records", href: "/staff", icon: Users },
  { key: "expiredCertificates", label: "Expired certificates", href: "/staff?filter=needs-checks", icon: ShieldAlert },
  { key: "certificatesExpiring30Days", label: "Certificates expiring within 30 days", href: "/staff?filter=needs-checks", icon: ShieldAlert },
  { key: "incompleteCentralRecords", label: "Incomplete staff checks", href: "/staff?filter=needs-checks", icon: ClipboardCheck },
  { key: "staffMissingKioskPin", label: "Staff without a clocking-in PIN", href: "/staff?filter=needs-setup", icon: KeyRound },
  { key: "staffMissingPayArrangement", label: "Staff without current pay details", href: "/staff?filter=needs-setup", icon: CreditCard },
];

function attentionClass(count: number) {
  return count > 0
    ? "border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300"
    : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300";
}

export function ProductionDashboard({ data }: { data: ProductionDashboardSummary }) {
  const rotaHref = `/rota?week=${data.weekStartDate}&view=weekly`;

  return (
    <div className="dashboard-page">
      <div className="dashboard-page__header mb-6">
        <h1 className="text-3xl font-black text-purple-950">Home</h1>
        <p className="mt-2 text-slate-600">
          Nursery staffing and records for {formatDateUk(data.referenceDate)}.
        </p>
      </div>

      <section aria-labelledby="needs-attention-heading">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden />
          <h2 id="needs-attention-heading" className="text-xl font-black text-purple-950">Needs attention</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link className={`min-h-11 rounded-lg border p-4 font-bold transition ${attentionClass(data.missingClockOuts)}`} href="/attendance?view=needs-attention">
            Review {data.missingClockOuts} missing clock-out{data.missingClockOuts === 1 ? "" : "s"}
          </Link>
          <Link className={`min-h-11 rounded-lg border p-4 font-bold transition ${attentionClass(data.todayAttendanceExceptions)}`} href="/attendance?view=needs-attention">
            Review {data.todayAttendanceExceptions} attendance issue{data.todayAttendanceExceptions === 1 ? "" : "s"} today
          </Link>
          <Link className={`min-h-11 rounded-lg border p-4 font-bold transition ${attentionClass(data.pendingLeaveRequests)}`} href="/leave/requests">
            Review {data.pendingLeaveRequests} leave request{data.pendingLeaveRequests === 1 ? "" : "s"}
          </Link>
          <Link className={`min-h-11 rounded-lg border p-4 font-bold transition ${attentionClass(data.approvedLeaveRotaConflicts)}`} href={rotaHref}>
            Resolve {data.approvedLeaveRotaConflicts} rota leave conflict{data.approvedLeaveRotaConflicts === 1 ? "" : "s"}
          </Link>
        </div>
        {data.attendanceWarnings.length ? (
          <div className="mt-3 grid gap-2">
            {data.attendanceWarnings.map((warning) => (
              <Link
                key={`${warning.staffId}-${warning.warning}-${warning.warningDate}`}
                href="/attendance?view=needs-attention"
                className="rounded-lg border border-amber-200 bg-white p-3 text-sm text-amber-950"
              >
                <strong>{warning.displayName}, {formatDateUk(warning.warningDate)}:</strong>{" "}
                {warning.warning}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-7" aria-labelledby="today-heading">
        <h2 id="today-heading" className="mb-3 text-xl font-black text-purple-950">Today</h2>
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-purple-950">Current rota</h3>
                <p className="mt-1 text-sm text-slate-600">Week commencing {formatDateUk(data.weekStartDate)}</p>
              </div>
              <CalendarDays className="h-5 w-5 text-purple-600" aria-hidden />
            </div>
            {data.currentRota ? (
              <div className="mt-4">
                <StatusPill tone={data.currentRota.status === "published" ? "green" : "amber"}>
                  {data.currentRota.status}
                </StatusPill>
                <p className="mt-3 text-sm text-slate-600">
                  {data.currentRota.status === "published" && data.currentRota.publishedAt
                    ? `Published ${formatDateUk(data.currentRota.publishedAt)} at ${formatTimeUk(data.currentRota.publishedAt)}`
                    : "This rota is still being prepared."}
                </p>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">
                No rota has been created for this week.
              </p>
            )}
            <Link className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-purple-700 px-4 text-sm font-bold text-white" href={rotaHref}>
              Open current rota
            </Link>
          </Panel>

          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-purple-950">Currently clocked in</h3>
                <p className="mt-1 text-sm text-slate-600">{data.currentlyClockedIn} staff currently clocked in</p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-green-700" aria-hidden />
            </div>
            {data.clockedInStaff.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {data.clockedInStaff.map((person) => (
                  <div key={person.staffId} className="rounded-lg border border-green-100 bg-green-50 p-3">
                    <p className="font-bold text-green-950">{person.displayName}</p>
                    <p className="mt-1 text-sm text-green-800">
                      In at {formatTimeUk(person.clockedInAt)}
                      {person.scheduledEnd ? ` | Scheduled to ${person.scheduledEnd}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nobody is clocked in" body="There are no open clocking-in records." />
            )}
          </Panel>
        </div>

        <Panel className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-purple-950">Today and tomorrow</h3>
              <p className="mt-1 text-sm text-slate-600">{data.todayScheduledShifts} shifts scheduled today</p>
            </div>
            <CalendarClock className="h-5 w-5 text-purple-600" aria-hidden />
          </div>
          {data.upcomingShifts.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-purple-100">
                    <th className="p-2">Date</th><th className="p-2">Staff</th><th className="p-2">Shift</th><th className="p-2">Room or role</th><th className="p-2">Rota</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcomingShifts.map((shift) => (
                    <tr key={shift.id} className="border-b border-purple-50">
                      <td className="p-2">{formatDateUk(shift.shiftDate)}</td>
                      <td className="p-2 font-bold text-purple-950">{shift.displayName}</td>
                      <td className="p-2">{shift.startTime} to {shift.endTime}</td>
                      <td className="p-2">{shift.roomOrArea || shift.roleOnShift || "-"}</td>
                      <td className="p-2"><StatusPill tone={shift.rotaStatus === "published" ? "green" : "amber"}>{shift.rotaStatus}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No upcoming shifts" body="No shifts are scheduled for today or tomorrow." />
          )}
        </Panel>
      </section>

      <section className="mt-7" aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="mb-3 text-xl font-black text-purple-950">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-purple-700 px-4 py-3 font-bold text-white" href="/attendance?view=add-event">
            <Clock3 className="h-5 w-5" aria-hidden /> Add missing clock event
          </Link>
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-purple-200 bg-white px-4 py-3 font-bold text-purple-900" href={rotaHref}>
            <CalendarDays className="h-5 w-5" aria-hidden /> Open weekly rota
          </Link>
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-purple-200 bg-white px-4 py-3 font-bold text-purple-900" href="/leave/requests">
            <CalendarX2 className="h-5 w-5" aria-hidden /> Review leave requests
          </Link>
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-purple-200 bg-white px-4 py-3 font-bold text-purple-900" href="/staff?action=add">
            <UserPlus className="h-5 w-5" aria-hidden /> Add staff member
          </Link>
        </div>
      </section>

      <section className="mt-7" aria-labelledby="records-summary-heading">
        <h2 id="records-summary-heading" className="mb-3 text-xl font-black text-purple-950">Records and checks summary</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {recordSummaryItems.map((item) => {
            const Icon = item.icon;
            const count = data[item.key];
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex min-h-11 items-center justify-between gap-3 rounded-lg border p-4 transition ${
                  count === 0 ? "border-slate-200 bg-slate-50 text-slate-500" : "border-purple-100 bg-white text-purple-950 hover:border-purple-300"
                }`}
              >
                <span className="font-bold">{item.label}</span>
                <span className="flex items-center gap-2 text-xl font-black">
                  {count}<Icon className="h-5 w-5" aria-hidden />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function ProductionDashboardError() {
  return (
    <Panel>
      <h1 className="text-2xl font-black text-red-900">Live dashboard unavailable</h1>
      <p className="mt-2 text-sm text-red-800">
        The dashboard data could not be loaded. No demo or placeholder figures have been shown.
      </p>
    </Panel>
  );
}
