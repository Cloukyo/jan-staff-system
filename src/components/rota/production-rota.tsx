import Link from "next/link";
import { addDays, addWeeks, format, parseISO } from "date-fns";
import { AlertTriangle, Archive, CalendarPlus, ChevronLeft, ChevronRight, Copy, Plus } from "lucide-react";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, isoDate } from "@/lib/dates/format";
import {
  archiveRotaShiftAction,
  clearRotaDayAction,
  copyPreviousRotaWeekAction,
  copyRotaDayAction,
  createRotaWeekAction,
  duplicateRotaShiftAction,
  saveRotaShiftAction,
  setRotaWeekStatusAction,
} from "@/lib/rota/actions";
import type { ProductionRotaDataset, ProductionRotaShift } from "@/lib/rota/types";
import { leaveWarningsForShift, overlapWarningsForShift, shiftDurationMinutes } from "@/lib/rota/validation";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import { TemplateRotaControls } from "@/components/rota/template-rota-controls";
import type { RotaTemplate, RotaTemplateApplyMode, TemplateApplicationPreview } from "@/lib/rota/template-types";

const dayFormat = "EEEE dd/MM";

function hidden(name: string, value: string) {
  return <input type="hidden" name={name} value={value} />;
}

function ShiftFields({ data, shift }: { data: ProductionRotaDataset; shift?: ProductionRotaShift }) {
  const firstActive = data.staff.find((person) => person.active);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Field label="Staff member">
        <select className={inputClassName()} name="staffId" defaultValue={shift?.staffId ?? firstActive?.id} required>
          {data.staff.map((person) => <option key={person.id} value={person.id}>{person.displayName || person.fullName}{person.active ? "" : " (inactive)"}</option>)}
        </select>
      </Field>
      <Field label="Date">
        <input className={inputClassName()} name="shiftDate" type="date" min={data.weekStart} max={isoDate(addDays(parseISO(data.weekStart), 6))} defaultValue={shift?.shiftDate ?? data.weekStart} required />
      </Field>
      <Field label="Start time"><input className={inputClassName()} name="startTime" type="time" step={data.settings.shiftIntervalMinutes * 60} defaultValue={shift?.startTime ?? data.settings.openingTime} required /></Field>
      <Field label="Finish time"><input className={inputClassName()} name="endTime" type="time" step={data.settings.shiftIntervalMinutes * 60} defaultValue={shift?.endTime ?? "16:30"} required /></Field>
      <Field label="Break minutes"><input className={inputClassName()} name="breakMinutes" type="number" min="0" step="5" defaultValue={shift?.breakUnspecified ? "" : shift?.breakMinutes ?? data.settings.defaultBreakMinutes} placeholder={shift?.breakUnspecified ? "Not specified" : undefined} required /></Field>
      <Field label="Status">
        <select className={inputClassName()} name="status" defaultValue={shift?.status ?? "scheduled"}>
          <option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option>
        </select>
      </Field>
      <Field label="Room or area"><input className={inputClassName()} name="roomOrArea" list="rota-rooms" defaultValue={shift?.roomOrArea ?? ""} /></Field>
      <Field label="Role on shift"><input className={inputClassName()} name="roleOnShift" defaultValue={shift?.roleOnShift ?? ""} /></Field>
      <Field label="Notes"><input className={inputClassName()} name="notes" defaultValue={shift?.notes ?? ""} /></Field>
      <Field label="Approved leave override reason"><input className={inputClassName()} name="leaveOverrideReason" defaultValue={shift?.leaveOverrideReason ?? ""} /></Field>
      <Field label="Overlap override reason"><input className={inputClassName()} name="overlapOverrideReason" defaultValue={shift?.overlapOverrideReason ?? ""} /></Field>
      <Field label="Inactive staff override reason"><input className={inputClassName()} name="inactiveStaffOverrideReason" defaultValue={shift?.inactiveStaffOverrideReason ?? ""} /></Field>
    </div>
  );
}

function ShiftEditor({ data, shift }: { data: ProductionRotaDataset; shift: ProductionRotaShift }) {
  const staff = data.staff.find((person) => person.id === shift.staffId);
  const leave = leaveWarningsForShift(shift, data.leave);
  const overlaps = overlapWarningsForShift(shift, data.shifts);
  const duration = shiftDurationMinutes(shift.startTime, shift.endTime) - shift.breakMinutes;
  return (
    <details className="rounded-lg border border-purple-100 bg-white p-3">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-black text-purple-950">{staff?.displayName || staff?.fullName || "Unknown staff"}</p>
            <p className="text-sm text-slate-600">{shift.startTime} to {shift.endTime} · {shift.breakUnspecified ? "break not specified" : `${shift.breakMinutes} min break · ${Math.max(0, duration)} working min`}</p>
            {shift.roomOrArea ? <p className="text-sm font-semibold text-purple-800">{shift.roomOrArea}{shift.roleOnShift ? ` · ${shift.roleOnShift}` : ""}</p> : null}
          </div>
          <StatusPill tone={shift.status === "scheduled" ? "green" : shift.status === "cancelled" ? "red" : "grey"}>{shift.status}</StatusPill>
        </div>
        {leave.map((warning) => <p key={warning.id} className={`mt-2 flex items-center gap-1 text-xs font-bold ${warning.status === "approved" ? "text-red-700" : "text-amber-700"}`}><AlertTriangle className="h-4 w-4" /> {warning.status === "approved" ? "Approved leave conflict" : "Pending leave warning"}</p>)}
        {overlaps.length ? <p className="mt-2 flex items-center gap-1 text-xs font-bold text-red-700"><AlertTriangle className="h-4 w-4" /> Overlaps another active shift</p> : null}
      </summary>
      <div className="mt-4 border-t border-purple-100 pt-4">
        <RotaActionForm action={saveRotaShiftAction} submitLabel="Save shift" className="grid gap-4">
          {hidden("shiftId", shift.id)}{hidden("rotaWeekId", shift.rotaWeekId)}
          <ShiftFields data={data} shift={shift} />
          <div className="flex flex-wrap gap-2"><button type="reset" className="min-h-11 rounded-xl border border-purple-200 px-4 text-sm font-bold text-purple-900">Cancel changes</button></div>
        </RotaActionForm>
        <div className="mt-4 grid gap-3 border-t border-purple-100 pt-4 md:grid-cols-2">
          <RotaActionForm action={duplicateRotaShiftAction} submitLabel="Duplicate shift" variant="secondary" className="flex flex-wrap items-end gap-2">
            {hidden("shiftId", shift.id)}
            <Field label="Duplicate to"><input className={inputClassName()} name="targetDate" type="date" min={data.weekStart} max={isoDate(addDays(parseISO(data.weekStart), 6))} required /></Field>
          </RotaActionForm>
          <RotaActionForm action={archiveRotaShiftAction} submitLabel="Archive shift" variant="danger" className="self-end" confirmMessage="Archive this shift? It will no longer appear in the active rota.">
            {hidden("shiftId", shift.id)}
          </RotaActionForm>
        </div>
      </div>
    </details>
  );
}

export function ProductionRota({
  data,
  templates,
  templatePreview,
  selectedTemplateId,
  selectedTemplateMode,
  templateRequestKey,
}: {
  data: ProductionRotaDataset;
  templates: RotaTemplate[];
  templatePreview: TemplateApplicationPreview | null;
  selectedTemplateId?: string;
  selectedTemplateMode: RotaTemplateApplyMode;
  templateRequestKey: string;
}) {
  const start = parseISO(data.weekStart);
  const dates = Array.from({ length: 7 }, (_, index) => isoDate(addDays(start, index)));
  const previousWeek = isoDate(addWeeks(start, -1));
  const nextWeek = isoDate(addWeeks(start, 1));
  const activeStaffCount = data.staff.filter((person) => person.active).length;
  return (
    <>
      <datalist id="rota-rooms">{data.settings.availableRooms.map((room) => <option key={room} value={room} />)}</datalist>
      <div className="mb-6">
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-3xl font-black text-purple-950">Weekly rota</h1><p className="mt-2 text-slate-600">Planned shifts shared across authorised devices.</p></div>
          {data.week ? <StatusPill tone={data.week.status === "published" ? "green" : "amber"}>{data.week.status}</StatusPill> : null}
        </div>
      </div>

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex gap-2">
            <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 px-3 text-purple-900" href={`/rota?week=${previousWeek}`} aria-label="Previous week"><ChevronLeft className="h-5 w-5" /></Link>
            <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 px-4 text-sm font-bold text-purple-900" href="/rota">This week</Link>
            <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 px-3 text-purple-900" href={`/rota?week=${nextWeek}`} aria-label="Next week"><ChevronRight className="h-5 w-5" /></Link>
          </div>
          <form className="flex flex-wrap items-end gap-2">
            <Field label="Go to week"><input className={inputClassName()} name="week" type="date" defaultValue={data.weekStart} /></Field>
            <button className="min-h-11 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" type="submit">Go</button>
          </form>
          <p className="font-black text-purple-950">Week commencing {formatDateUk(data.weekStart)}</p>
        </div>
      </Panel>

      {!data.week ? (
        <Panel className="mt-5">
          <EmptyState title="No rota for this week" body={`${activeStaffCount} active staff profiles are available. Create a draft to start scheduling.`} />
          <RotaActionForm action={createRotaWeekAction} submitLabel="Create draft rota" className="mt-5 grid gap-4">
            {hidden("weekStart", data.weekStart)}
            <div className="grid gap-3 md:grid-cols-2"><Field label="Title"><input className={inputClassName()} name="title" placeholder="Optional" /></Field><Field label="Notes"><input className={inputClassName()} name="notes" placeholder="Optional manager note" /></Field></div>
          </RotaActionForm>
          <RotaActionForm action={copyPreviousRotaWeekAction} submitLabel="Copy previous week" variant="secondary" className="mt-4">
            {hidden("weekStart", data.weekStart)}
          </RotaActionForm>
        </Panel>
      ) : (
        <>
          <Panel className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-xl font-black text-purple-950">{data.week.title || "Rota controls"}</h2><p className="text-sm text-slate-600">{data.week.notes || "Changes are recorded against the signed-in manager."}</p></div>
              <div className="flex flex-wrap gap-2">
                {data.week.status === "draft" ? <RotaActionForm action={setRotaWeekStatusAction} submitLabel="Publish rota" className="inline" confirmMessage="Publish this rota for staff viewing?">{hidden("weekId", data.week.id)}{hidden("status", "published")}</RotaActionForm> : <RotaActionForm action={setRotaWeekStatusAction} submitLabel="Return to draft" variant="secondary" className="inline" confirmMessage="Return this published rota to draft?">{hidden("weekId", data.week.id)}{hidden("status", "draft")}</RotaActionForm>}
                <RotaActionForm action={setRotaWeekStatusAction} submitLabel="Archive week" variant="danger" className="inline" confirmMessage="Archive this rota week?">{hidden("weekId", data.week.id)}{hidden("status", "archived")}</RotaActionForm>
              </div>
            </div>
            {data.week.status === "draft" ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <RotaActionForm action={copyRotaDayAction} submitLabel="Copy day" variant="secondary" className="grid gap-3">
                  {hidden("weekId", data.week.id)}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Source day"><select className={inputClassName()} name="sourceDate">{dates.map((date) => <option key={date} value={date}>{format(parseISO(date), dayFormat)}</option>)}</select></Field>
                    <Field label="Target day"><select className={inputClassName()} name="targetDate" defaultValue={dates[1]}>{dates.map((date) => <option key={date} value={date}>{format(parseISO(date), dayFormat)}</option>)}</select></Field>
                  </div>
                </RotaActionForm>
                <RotaActionForm action={clearRotaDayAction} submitLabel="Clear selected day" variant="danger" className="grid gap-3" confirmMessage="Archive every draft shift on this day?">
                  {hidden("weekId", data.week.id)}
                  <Field label="Day to clear"><select className={inputClassName()} name="shiftDate">{dates.map((date) => <option key={date} value={date}>{format(parseISO(date), dayFormat)}</option>)}</select></Field>
                </RotaActionForm>
              </div>
            ) : null}
          </Panel>
          <TemplateRotaControls
            data={data}
            templates={templates}
            preview={templatePreview}
            selectedTemplateId={selectedTemplateId}
            selectedMode={selectedTemplateMode}
            requestKey={templateRequestKey}
          />

          <Panel className="mt-5">
            <h2 className="flex items-center gap-2 text-xl font-black text-purple-950"><CalendarPlus className="h-5 w-5" /> Add shift</h2>
            <RotaActionForm action={saveRotaShiftAction} submitLabel="Add shift" className="mt-4 grid gap-4">
              {hidden("rotaWeekId", data.week.id)}
              <ShiftFields data={data} />
              <div className="flex flex-wrap gap-2"><button type="reset" className="min-h-11 rounded-xl border border-purple-200 px-4 text-sm font-bold text-purple-900">Clear form</button></div>
            </RotaActionForm>
          </Panel>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {dates.map((date) => {
              const shifts = data.shifts.filter((shift) => shift.shiftDate === date);
              return (
                <Panel key={date}>
                  <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-black text-purple-950">{format(parseISO(date), dayFormat)}</h2><StatusPill tone="purple">{shifts.length} shifts</StatusPill></div>
                  <div className="grid gap-3">{shifts.length ? shifts.map((shift) => <ShiftEditor key={shift.id} data={data} shift={shift} />) : <EmptyState title="No shifts" body="This day is ready for scheduling." />}</div>
                </Panel>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Archive className="h-4 w-4" /> Archived shifts stay in the audit history. <Copy className="ml-2 h-4 w-4" /> Copy operations skip identical shifts when retried. <Plus className="ml-2 h-4 w-4" /> Overnight shifts are not supported.</p>
    </>
  );
}
