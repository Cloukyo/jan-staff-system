import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AttendanceCorrectionRequest } from "@/components/staff-self-service/attendance-correction-request";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatDurationCompact, formatTimeUk } from "@/lib/dates/format";
import type { StaffAttendanceRange } from "@/lib/staff-self-service/server";

export function MyAttendance({ data }: { data: StaffAttendanceRange }) {
  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">My attendance</h1>
        <p className="mt-2 text-slate-600">Your clock history. Original kiosk events cannot be edited here.</p>
      </div>

      <Panel>
        <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]" method="get">
          <Field label="From"><input className={inputClassName()} type="date" name="from" defaultValue={data.from} /></Field>
          <Field label="To"><input className={inputClassName()} type="date" name="to" defaultValue={data.to} /></Field>
          <button className="min-h-11 self-end rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" type="submit">Apply dates</button>
        </form>
      </Panel>

      <AttendanceCorrectionRequest defaultDate={data.to} />

      {data.days.length ? data.days.map((day) => (
        <Panel key={day.date}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-purple-950">{formatDateUk(day.date)}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {day.firstClockIn ? `First clock-in ${formatTimeUk(day.firstClockIn)}` : "No clock-in"}
                {day.finalClockOut ? ` | Final clock-out ${formatTimeUk(day.finalClockOut)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={day.missingClockOut ? "red" : "green"}>{day.missingClockOut ? "Missing clock-out" : formatDurationCompact(day.totalMinutes)}</StatusPill>
              {day.hasManagerCorrection ? <StatusPill tone="purple">Manager correction</StatusPill> : null}
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {day.events.map((event) => (
              <div key={event.id} className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-purple-50 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 font-bold text-purple-950">
                  {event.eventType === "clock_in" ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <AlertTriangle className="h-4 w-4 text-purple-700" />}
                  {event.eventType === "clock_in" ? "Clock in" : "Clock out"}
                </span>
                <span className="text-slate-700">{formatTimeUk(event.eventTimestamp)}{event.managerCorrection ? " | Manager correction" : ""}</span>
              </div>
            ))}
          </div>
        </Panel>
      )) : <EmptyState title="No attendance records" body="There are no clock events in the selected date range." />}
    </div>
  );
}
