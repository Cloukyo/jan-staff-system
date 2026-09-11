import { addDays, eachDayOfInterval, parseISO } from "date-fns";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin } from "lucide-react";
import { EmptyState, Panel, StatusPill } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk, isoDate, isoDateInLondon } from "@/lib/dates/format";
import { personalRotaSummary, shiftTimeLabel } from "@/lib/staff-self-service/presentation";
import type { StaffApprovedLeave, StaffRotaShift, StaffRotaWeek } from "@/lib/staff-self-service/server";

export function MyRota({ data }: { data: StaffRotaWeek }) {
  const today = isoDateInLondon();
  const summary = personalRotaSummary(data, today);
  const previousWeek = isoDate(addDays(parseISO(data.weekStart), -7));
  const nextWeek = isoDate(addDays(parseISO(data.weekStart), 7));
  const days = eachDayOfInterval({ start: parseISO(data.weekStart), end: parseISO(data.weekEnd) });
  return (
    <div className="grid gap-5">
      <header><p className="text-sm font-bold text-purple-700">My schedule</p><h1 className="mt-1 text-3xl font-black text-purple-950">My rota</h1><p className="mt-2 text-slate-600">See when you are working and any approved leave.</p></header>
      <nav className="flex items-center justify-between gap-3" aria-label="Rota week">
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 font-bold text-purple-900 ring-1 ring-purple-200" href={`/my-rota?week=${previousWeek}`}><ChevronLeft className="h-4 w-4" /> Previous</Link>
        <div className="text-center"><p className="font-black text-purple-950">{formatDateUk(data.weekStart)} to {formatDateUk(data.weekEnd)}</p>{data.publishedAt ? <p className="mt-1 text-xs font-semibold text-slate-500">Last updated {formatDateUk(data.publishedAt)} at {formatTimeUk(data.publishedAt)}</p> : null}</div>
        <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 font-bold text-purple-900 ring-1 ring-purple-200" href={`/my-rota?week=${nextWeek}`}>Next <ChevronRight className="h-4 w-4" /></Link>
      </nav>
      <section className="grid gap-4 lg:grid-cols-2" aria-label="Schedule highlights">
        <Panel className="border-purple-200 bg-purple-50"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-purple-950">Today</h2><StatusPill tone={summary.today.length ? "green" : "grey"}>{summary.today.length ? `${summary.today.length} shift${summary.today.length === 1 ? "" : "s"}` : "No shift"}</StatusPill></div><div className="mt-4 grid gap-3">{summary.today.length ? summary.today.map((shift) => <PersonalShift key={shift.id} shift={shift} prominent />) : <p className="font-semibold text-slate-600">You are not scheduled to work today.</p>}</div></Panel>
        <Panel><h2 className="text-xl font-black text-purple-950">Next shift</h2><div className="mt-4">{summary.next ? <PersonalShift shift={summary.next} showDate prominent /> : <p className="font-semibold text-slate-600">No later shifts are scheduled in this week.</p>}</div></Panel>
      </section>
      <section aria-labelledby="week-schedule-heading">
        <div className="mb-3 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-purple-700" /><h2 id="week-schedule-heading" className="text-xl font-black text-purple-950">This week</h2></div>
        {!data.shifts.length && !data.leave.length ? <EmptyState title="Nothing scheduled this week" body="There are no published shifts or approved leave for this week." /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{days.map((day) => { const date = isoDate(day); return <ScheduleDay key={date} date={date} today={date === today} shifts={data.shifts.filter((shift) => shift.shiftDate === date)} leave={data.leave.filter((item) => date >= item.startDate && date <= item.endDate)} />; })}</div>}
      </section>
    </div>
  );
}

function ScheduleDay({ date, today, shifts, leave }: { date: string; today: boolean; shifts: StaffRotaShift[]; leave: StaffApprovedLeave[] }) {
  return <Panel className={today ? "border-purple-300 ring-2 ring-purple-100" : ""}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-wide text-slate-500">{parseISO(date).toLocaleDateString("en-GB", { weekday: "long" })}</p><p className="font-black text-purple-950">{formatDateUk(date)}</p></div>{today ? <StatusPill tone="purple">Today</StatusPill> : null}</div><div className="mt-4 grid gap-3">{shifts.map((shift) => <PersonalShift key={shift.id} shift={shift} />)}{leave.map((item) => <div key={item.id} className="rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-900">Approved leave{item.dayPart === "partial_day" && item.startTime && item.endTime ? `, ${item.startTime} to ${item.endTime}` : ""}</div>)}{!shifts.length && !leave.length ? <p className="text-sm font-semibold text-slate-500">Not working</p> : null}</div></Panel>;
}

function PersonalShift({ shift, showDate = false, prominent = false }: { shift: StaffRotaShift; showDate?: boolean; prominent?: boolean }) {
  return <div className={`rounded-xl bg-white ring-1 ring-purple-100 ${prominent ? "p-4" : "p-3"}`}>{showDate ? <p className="mb-1 text-sm font-bold text-slate-600">{parseISO(shift.shiftDate).toLocaleDateString("en-GB", { weekday: "long" })}, {formatDateUk(shift.shiftDate)}</p> : null}<p className={`${prominent ? "text-2xl" : "text-lg"} font-black text-purple-950`}>{shiftTimeLabel(shift)}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-slate-600"><span className="inline-flex items-center gap-1"><Clock3 className="h-4 w-4" /> {shift.breakUnspecified ? "Break to be confirmed" : shift.breakMinutes ? `${shift.breakMinutes} minute break` : "No recorded break"}</span>{shift.workArea ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {shift.workArea}</span> : null}</div>{shift.roleOnShift ? <p className="mt-2 text-sm font-semibold text-slate-600">{shift.roleOnShift}</p> : null}{shift.status === "completed" ? <div className="mt-3"><StatusPill tone="green">Completed</StatusPill></div> : null}</div>;
}
