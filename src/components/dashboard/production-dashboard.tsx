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
  Users,
} from "lucide-react";
import { EmptyState, Panel, StatusPill } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";
import type { ProductionDashboardSummary } from "@/lib/dashboard/types";

type Tone = "green" | "amber" | "red" | "grey" | "purple";

const cards: Array<{
  key: keyof Pick<
    ProductionDashboardSummary,
    | "activeStaff"
    | "currentlyClockedIn"
    | "todayScheduledShifts"
    | "todayAttendanceExceptions"
    | "missingClockOuts"
    | "pendingLeaveRequests"
    | "approvedLeaveRotaConflicts"
    | "expiredCertificates"
    | "certificatesExpiring30Days"
    | "incompleteCentralRecords"
    | "staffMissingKioskPin"
    | "staffMissingPayArrangement"
  >;
  label: string;
  href: string;
  tone: Tone;
  icon: typeof Users;
}> = [
  { key: "activeStaff", label: "Active staff", href: "/staff", tone: "purple", icon: Users },
  { key: "currentlyClockedIn", label: "Currently clocked in", href: "/attendance", tone: "green", icon: Clock3 },
  { key: "todayScheduledShifts", label: "Today's scheduled shifts", href: "/rota", tone: "purple", icon: CalendarClock },
  { key: "todayAttendanceExceptions", label: "Today's attendance exceptions", href: "/attendance", tone: "red", icon: AlertTriangle },
  { key: "missingClockOuts", label: "Missing clock-outs", href: "/attendance", tone: "red", icon: Clock3 },
  { key: "pendingLeaveRequests", label: "Pending leave requests", href: "/leave/requests", tone: "amber", icon: CalendarX2 },
  { key: "approvedLeaveRotaConflicts", label: "Approved leave conflicts", href: "/rota", tone: "red", icon: CalendarDays },
  { key: "expiredCertificates", label: "Expired certificates", href: "/compliance", tone: "red", icon: ShieldAlert },
  { key: "certificatesExpiring30Days", label: "Certificates expiring in 30 days", href: "/compliance", tone: "amber", icon: ShieldAlert },
  { key: "incompleteCentralRecords", label: "Incomplete central records", href: "/compliance", tone: "amber", icon: ClipboardCheck },
  { key: "staffMissingKioskPin", label: "Staff missing a kiosk PIN", href: "/settings/kiosk", tone: "amber", icon: KeyRound },
  { key: "staffMissingPayArrangement", label: "Missing active pay arrangement", href: "/payroll/arrangements", tone: "amber", icon: CreditCard },
];

export function ProductionDashboard({ data }: { data: ProductionDashboardSummary }) {
  const rotaHref = `/rota?week=${data.weekStartDate}`;
  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Dashboard</h1>
        <p className="mt-2 text-slate-600">Live nursery staffing, attendance, rota and compliance signals for {formatDateUk(data.referenceDate)}.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.key} href={card.href} className="group rounded-lg border border-purple-100 bg-white p-4 shadow-soft transition hover:border-purple-300 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-600">{card.label}</p>
                  <p className="mt-2 text-3xl font-black text-purple-950">{data[card.key]}</p>
                </div>
                <Icon className="h-5 w-5 text-purple-600" aria-hidden />
              </div>
              <div className="mt-3"><StatusPill tone={card.tone}>Live</StatusPill></div>
            </Link>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-purple-950">Current rota week</h2>
              <p className="mt-1 text-sm text-slate-600">Week commencing {formatDateUk(data.weekStartDate)}</p>
            </div>
            <CalendarDays className="h-5 w-5 text-purple-600" aria-hidden />
          </div>
          {data.currentRota ? (
            <div className="mt-4">
              <StatusPill tone={data.currentRota.status === "published" ? "green" : "amber"}>{data.currentRota.status}</StatusPill>
              <p className="mt-3 text-sm text-slate-600">
                {data.currentRota.status === "published" && data.currentRota.publishedAt
                  ? `Published ${formatDateUk(data.currentRota.publishedAt)} at ${formatTimeUk(data.currentRota.publishedAt)}`
                  : "This rota is still being prepared."}
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-900">No active rota exists for the current week.</p>
          )}
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-purple-700 px-4 text-sm font-bold text-white" href={rotaHref}>Open current rota</Link>
        </Panel>

        <Panel>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-lg font-black text-purple-950">Currently clocked in</h2><p className="mt-1 text-sm text-slate-600">Latest immutable clock events from Supabase.</p></div>
            <CheckCircle2 className="h-5 w-5 text-green-700" aria-hidden />
          </div>
          {data.clockedInStaff.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {data.clockedInStaff.map((person) => (
                <div key={person.staffId} className="rounded-lg border border-green-100 bg-green-50 p-3">
                  <p className="font-bold text-green-950">{person.displayName}</p>
                  <p className="mt-1 text-sm text-green-800">In at {formatTimeUk(person.clockedInAt)}{person.scheduledEnd ? ` | Scheduled to ${person.scheduledEnd}` : ""}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Nobody is clocked in" body="The latest production clock events show no open attendance sessions." />}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black text-purple-950">Attendance warnings</h2><Link className="text-sm font-bold text-purple-700" href="/attendance">Open attendance</Link></div>
          {data.attendanceWarnings.length ? (
            <div className="mt-4 grid gap-2">
              {data.attendanceWarnings.map((warning) => (
                <div key={`${warning.staffId}-${warning.warning}-${warning.warningDate}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="font-bold text-amber-950">{warning.displayName} | {formatDateUk(warning.warningDate)}</p>
                  <p className="text-sm text-amber-800">{warning.warning}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No attendance warnings" body="No reliable attendance exceptions were found for the live dashboard." />}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-black text-purple-950">Today and tomorrow</h2><Link className="text-sm font-bold text-purple-700" href={rotaHref}>Open rota</Link></div>
          {data.upcomingShifts.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead><tr className="border-b border-purple-100"><th className="p-2">Date</th><th className="p-2">Staff</th><th className="p-2">Shift</th><th className="p-2">Room or role</th><th className="p-2">Rota</th></tr></thead>
                <tbody>{data.upcomingShifts.map((shift) => (
                  <tr key={shift.id} className="border-b border-purple-50">
                    <td className="p-2">{formatDateUk(shift.shiftDate)}</td>
                    <td className="p-2 font-bold text-purple-950">{shift.displayName}</td>
                    <td className="p-2">{shift.startTime} to {shift.endTime}</td>
                    <td className="p-2">{shift.roomOrArea || shift.roleOnShift || "-"}</td>
                    <td className="p-2"><StatusPill tone={shift.rotaStatus === "published" ? "green" : "amber"}>{shift.rotaStatus}</StatusPill></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <EmptyState title="No upcoming shifts" body="No active production shifts are scheduled for today or tomorrow." />}
        </Panel>
      </div>
    </div>
  );
}

export function ProductionDashboardError() {
  return (
    <Panel>
      <h1 className="text-2xl font-black text-red-900">Live dashboard unavailable</h1>
      <p className="mt-2 text-sm text-red-800">Supabase dashboard data could not be loaded. No demo or placeholder figures have been shown.</p>
    </Panel>
  );
}
