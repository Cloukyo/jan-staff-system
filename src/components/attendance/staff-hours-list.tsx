import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ExternalLink, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button, EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatHours } from "@/lib/dates/format";
import type { StaffHoursList } from "@/lib/attendance/staff-hours";

function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function hoursHref(from: string, to: string, staffId?: string): string {
  const search = new URLSearchParams({ view: "hours", hoursFrom: from, hoursTo: to });
  if (staffId) search.set("staffId", staffId);
  return `/attendance?${search.toString()}`;
}

export function StaffHoursList({ data }: { data: StaffHoursList }) {
  const previousFrom = shiftIsoDate(data.from, -7);
  const previousTo = shiftIsoDate(data.to, -7);
  const nextFrom = shiftIsoDate(data.from, 7);
  const nextTo = shiftIsoDate(data.to, 7);

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-purple-950">Staff hours</h2>
          <p className="mt-1 text-sm text-slate-600">Completed time is based on effective clock events. Open shifts are not included.</p>
        </div>
        <Link
          href={hoursHref(data.currentWeekStart, data.currentWeekEnd)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50"
        >
          <CalendarDays className="h-5 w-5" aria-hidden />
          Current work week
        </Link>
      </div>

      <form className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]" method="get">
        <input type="hidden" name="view" value="hours" />
        <Field label="From"><input className={inputClassName()} name="hoursFrom" type="date" defaultValue={data.from} required /></Field>
        <Field label="To"><input className={inputClassName()} name="hoursTo" type="date" defaultValue={data.to} required /></Field>
        <Button className="self-end" type="submit">Update dates</Button>
      </form>

      <div className="mt-5 flex items-center justify-between gap-3 border-y border-purple-100 py-3">
        <Link href={hoursHref(previousFrom, previousTo)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50" aria-label="Previous week">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <p className="text-center text-sm font-bold text-purple-950">{formatDateUk(data.from)} to {formatDateUk(data.to)}</p>
        <Link href={hoursHref(nextFrom, nextTo)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50" aria-label="Next week">
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      </div>

      {data.rows.length ? (
        <div className="mt-2 divide-y divide-purple-100">
          {data.rows.map((row) => (
            <div key={row.staffId} className="grid min-h-16 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_11rem_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-bold text-purple-950">{row.fullName}</p>
                <p className="text-sm text-slate-600">{row.displayName}</p>
              </div>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Clock3 className="h-4 w-4 text-purple-700" aria-hidden />{formatHours(row.completedMinutes)}</p>
              <div className="flex flex-wrap gap-2">
                {row.hasOpenShift ? <StatusPill tone="amber">Open shift not included</StatusPill> : null}
                {row.daysNeedingAttention ? <StatusPill tone="red"><TriangleAlert className="mr-1 h-3.5 w-3.5" aria-hidden />{row.daysNeedingAttention} issue{row.daysNeedingAttention === 1 ? "" : "s"}</StatusPill> : null}
                {!row.hasOpenShift && !row.daysNeedingAttention ? <StatusPill tone="green">No issues</StatusPill> : null}
              </div>
              <Link href={hoursHref(data.from, data.to, row.staffId)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50">
                Open hours
                <ExternalLink className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          ))}
        </div>
      ) : <div className="mt-5"><EmptyState title="No active staff" body="There are no active staff members in this date range." /></div>}
    </Panel>
  );
}
