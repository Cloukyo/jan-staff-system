import { addDays, format, parseISO } from "date-fns";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { EmptyState, Panel, StatusPill } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk, isoDate } from "@/lib/dates/format";
import type { StaffApprovedLeave, StaffRotaWeek } from "@/lib/staff-self-service/server";

function leaveForDate(leave: StaffApprovedLeave[], date: string): StaffApprovedLeave[] {
  return leave.filter((item) => item.startDate <= date && item.endDate >= date);
}

export function MyRota({ data }: { data: StaffRotaWeek }) {
  const start = parseISO(data.weekStart);
  const dates = Array.from({ length: 7 }, (_, index) => isoDate(addDays(start, index)));
  const previousWeek = isoDate(addDays(start, -7));
  const nextWeek = isoDate(addDays(start, 7));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
          <h1 className="mt-1 text-3xl font-black text-purple-950">My rota</h1>
          <p className="mt-2 text-slate-600">Your published shifts for {formatDateUk(data.weekStart)} to {formatDateUk(data.weekEnd)}.</p>
        </div>
        {data.publishedAt ? <StatusPill tone="green">Published {formatDateUk(data.publishedAt)} at {formatTimeUk(data.publishedAt)}</StatusPill> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href={`/my-rota?week=${previousWeek}`}>
          <ChevronLeft className="h-4 w-4" /> Previous week
        </Link>
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href={`/my-rota?week=${nextWeek}`}>
          Next week <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {!data.publishedAt ? (
        <EmptyState title="No published rota for this week" body="Your manager has not published this week yet. Draft shifts are not shown." />
      ) : (
        <div className="grid gap-4">
          {dates.map((date) => {
            const shifts = data.shifts.filter((shift) => shift.shiftDate === date);
            const approvedLeave = leaveForDate(data.leave, date);
            return (
              <Panel key={date}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-500">{format(parseISO(date), "EEEE")}</p>
                    <h2 className="text-xl font-black text-purple-950">{formatDateUk(date)}</h2>
                  </div>
                  {approvedLeave.length ? <StatusPill tone="purple">Approved leave</StatusPill> : null}
                </div>
                {approvedLeave.map((item) => (
                  <p key={item.id} className="mt-3 rounded-lg bg-purple-50 p-3 text-sm font-bold text-purple-800">
                    Approved leave{item.dayPart === "partial_day" && item.startTime && item.endTime ? `, ${item.startTime} to ${item.endTime}` : ""}
                  </p>
                ))}
                <div className="mt-4 grid gap-3">
                  {shifts.length ? shifts.map((shift) => (
                    <div key={shift.id} className="rounded-lg border border-purple-100 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-black text-purple-950">{shift.startTime} to {shift.endTime}</p>
                          <p className="mt-1 text-sm text-slate-600">
                            Break: {shift.breakUnspecified ? "Not specified" : `${shift.breakMinutes} minutes`}
                          </p>
                          {shift.roomOrArea ? <p className="mt-2 flex items-center gap-2 text-sm font-bold text-purple-800"><MapPin className="h-4 w-4" />{shift.roomOrArea}</p> : null}
                          {shift.roleOnShift ? <p className="mt-1 text-sm text-slate-600">Role: {shift.roleOnShift}</p> : null}
                        </div>
                        <StatusPill tone={shift.status === "completed" ? "grey" : "green"}>{shift.status === "completed" ? "Completed" : "Published"}</StatusPill>
                      </div>
                    </div>
                  )) : (
                    <div className="flex items-center gap-3 text-sm text-slate-600"><CalendarDays className="h-5 w-5 text-purple-500" />No shift published for this day.</div>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
