"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import { Button, Field, inputClassName } from "@/components/ui/primitives";
import {
  archiveRotaTemplateShiftAction,
  clearRotaTemplateStaffDayAction,
  copyRotaTemplateStaffPatternAction,
  duplicateRotaTemplateShiftAction,
  saveRotaTemplateShiftAction,
} from "@/lib/rota/template-actions";
import type { RotaTemplateDataset, RotaTemplateShift } from "@/lib/rota/template-types";
import type { ProductionRotaStaff } from "@/lib/rota/types";
import { formatScheduledHours } from "@/lib/rota/grid";
import { shiftDurationMinutes } from "@/lib/rota/validation";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type EditorState = {
  staff: ProductionRotaStaff;
  dayOfWeek: number;
  shift?: RotaTemplateShift;
};

function hidden(name: string, value: string) {
  return <input type="hidden" name={name} value={value} />;
}

function TemplateEditorDrawer({ data, editor, onClose }: { data: RotaTemplateDataset; editor: EditorState; onClose: () => void }) {
  const shift = editor.shift;
  if (!data.selected) return null;
  return (
    <div className="fixed inset-0 z-50 bg-purple-950/35" role="presentation" onMouseDown={onClose}>
      <section className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="template-shift-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-purple-100 bg-white px-5 py-4">
          <div>
            <p className="text-sm font-bold text-purple-700">{shift ? "Edit template shift" : "Add template shift"}</p>
            <h2 id="template-shift-title" className="mt-1 text-xl font-black text-purple-950">{editor.staff.fullName}</h2>
            <p className="mt-1 text-sm text-slate-600">{days[editor.dayOfWeek - 1]}</p>
          </div>
          <Button type="button" variant="ghost" aria-label="Close template shift editor" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>
        <RotaActionForm action={saveRotaTemplateShiftAction} submitLabel={shift ? "Save changes" : "Add shift"} className="grid gap-5 p-5" onSuccess={onClose}>
          {hidden("templateId", data.selected.id)}
          {shift ? hidden("shiftId", shift.id) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Staff member">
              <select className={inputClassName()} name="staffId" defaultValue={editor.staff.id} required>
                {data.staff.map((person) => <option key={person.id} value={person.id}>{person.fullName}{person.active ? "" : " (inactive)"}</option>)}
              </select>
            </Field>
            <Field label="Weekday">
              <select className={inputClassName()} name="dayOfWeek" defaultValue={editor.dayOfWeek}>
                {days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
              </select>
            </Field>
            <Field label="Start time"><input className={inputClassName()} name="startTime" type="time" defaultValue={shift?.startTime ?? "08:30"} required /></Field>
            <Field label="Finish time"><input className={inputClassName()} name="endTime" type="time" defaultValue={shift?.endTime ?? "16:30"} required /></Field>
            <Field label="Break duration"><input className={inputClassName()} name="breakMinutes" type="number" min="0" step="5" defaultValue={shift?.breakMinutes ?? ""} placeholder="Not specified" /></Field>
            <Field label="Room or area"><input className={inputClassName()} name="roomOrArea" defaultValue={shift?.roomOrArea ?? ""} /></Field>
            <Field label="Role on shift"><input className={inputClassName()} name="roleOnShift" defaultValue={shift?.roleOnShift ?? ""} /></Field>
            <Field label="Display order"><input className={inputClassName()} name="sortOrder" type="number" defaultValue={shift?.sortOrder ?? 0} /></Field>
          </div>
          <Field label="Notes"><textarea className={inputClassName("min-h-24")} name="notes" defaultValue={shift?.notes ?? ""} /></Field>
          <div className="flex flex-wrap justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
        </RotaActionForm>
        {shift ? (
          <div className="grid gap-4 border-t border-purple-100 p-5 sm:grid-cols-2">
            <RotaActionForm action={duplicateRotaTemplateShiftAction} submitLabel="Copy shift" variant="secondary" className="grid gap-3">
              {hidden("shiftId", shift.id)}
              <Field label="Copy to day">
                <select className={inputClassName()} name="dayOfWeek" defaultValue={Math.min(shift.dayOfWeek + 1, 7)}>
                  {days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
                </select>
              </Field>
            </RotaActionForm>
            <RotaActionForm action={archiveRotaTemplateShiftAction} submitLabel="Archive shift" variant="danger" className="self-end" confirmMessage="Archive this template shift?" onSuccess={onClose}>
              {hidden("shiftId", shift.id)}
            </RotaActionForm>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function TemplateWeekGrid({ data }: { data: RotaTemplateDataset }) {
  const [showWeekend, setShowWeekend] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [patternStaff, setPatternStaff] = useState(data.staff.find((person) => person.active)?.id ?? "");
  const visibleDays = showWeekend ? days : days.slice(0, 5);
  const relevantStaff = useMemo(() => {
    const referenced = new Set(data.shifts.map((shift) => shift.staffId));
    return data.staff.filter((person) => person.active || referenced.has(person.id));
  }, [data.shifts, data.staff]);
  if (!data.selected) return null;
  const shiftsFor = (staffId: string, dayOfWeek: number) => data.shifts.filter((shift) => shift.staffId === staffId && shift.dayOfWeek === dayOfWeek);

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-soft" aria-label="Template weekly grid">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-purple-100 px-4 py-3">
          <div><h2 className="text-xl font-black text-purple-950">Weekly pattern</h2><p className="mt-1 text-sm text-slate-600">Select any cell to add or edit a reusable shift.</p></div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-purple-950">
            <input className="h-5 w-5 accent-purple-700" type="checkbox" checked={showWeekend} onChange={(event) => setShowWeekend(event.target.checked)} /> Show weekend
          </label>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className={`w-full border-separate border-spacing-0 text-sm ${showWeekend ? "min-w-[1280px]" : "min-w-[960px]"}`}>
            <thead><tr>
              <th scope="col" className="sticky left-0 top-0 z-30 w-52 border-b border-r border-purple-100 bg-purple-50 px-4 py-3 text-left font-black text-purple-950">Staff member</th>
              {visibleDays.map((day) => <th key={day} scope="col" className="sticky top-0 z-20 min-w-36 border-b border-r border-purple-100 bg-purple-50 px-3 py-3 text-left font-black text-purple-950">{day}</th>)}
              <th scope="col" className="sticky top-0 z-20 w-28 border-b border-purple-100 bg-purple-50 px-3 py-3 text-left font-black text-purple-950">Weekly hours</th>
            </tr></thead>
            <tbody>
              {relevantStaff.map((person) => {
                const weeklyMinutes = data.shifts.filter((shift) => shift.staffId === person.id && shift.dayOfWeek <= visibleDays.length)
                  .reduce((sum, shift) => sum + Math.max(0, shiftDurationMinutes(shift.startTime, shift.endTime) - (shift.breakMinutes ?? 0)), 0);
                const unknown = data.shifts.some((shift) => shift.staffId === person.id && shift.dayOfWeek <= visibleDays.length && shift.breakMinutes === null);
                return <tr key={person.id}>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-purple-100 bg-white px-4 py-3 text-left align-top">
                    <span className="block font-black text-purple-950">{person.fullName}</span>
                    <span className="mt-1 block text-xs font-semibold text-slate-500">{person.employmentRole}</span>
                    {!person.active ? <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-800"><AlertTriangle className="h-4 w-4" /> Inactive staff</span> : null}
                  </th>
                  {visibleDays.map((_, index) => {
                    const dayOfWeek = index + 1;
                    const shifts = shiftsFor(person.id, dayOfWeek);
                    return <td key={dayOfWeek} className="border-b border-r border-purple-100 p-2 align-top">
                      <div className="grid gap-2">
                        {shifts.map((shift) => <button key={shift.id} type="button" className={`min-h-24 rounded-xl border p-3 text-left transition hover:border-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-700 ${person.active ? "border-purple-200 bg-white" : "border-amber-200 bg-amber-50"}`} onClick={() => setEditor({ staff: person, dayOfWeek, shift })}>
                          <span className="flex items-center justify-between gap-2 whitespace-nowrap text-sm font-black text-purple-950">{shift.startTime}–{shift.endTime}<Pencil className="h-4 w-4 shrink-0 text-purple-400" /></span>
                          <span className="mt-1 block text-xs font-semibold text-slate-600">{shift.breakMinutes === null ? "Break not specified" : `${shift.breakMinutes} min break`}</span>
                          {shift.roomOrArea ? <span className="mt-2 block text-sm font-bold text-purple-800">{shift.roomOrArea}</span> : null}
                        </button>)}
                        <button type="button" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-purple-200 px-3 text-sm font-bold text-purple-700 hover:border-purple-500 hover:bg-purple-50" onClick={() => setEditor({ staff: person, dayOfWeek })}>
                          <Plus className="h-4 w-4" /> Add shift
                        </button>
                      </div>
                    </td>;
                  })}
                  <td className="border-b border-purple-100 px-3 py-3 align-top"><p className="font-black text-purple-950">{formatScheduledHours(weeklyMinutes)}</p>{unknown ? <p className="mt-1 text-xs font-bold text-amber-800">Break total incomplete</p> : null}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="md:hidden">
          <div className="flex items-center justify-between border-b border-purple-100 bg-purple-50 px-3 py-3">
            <Button type="button" variant="secondary" aria-label="Previous day" onClick={() => setSelectedDay((day) => Math.max(0, day - 1))} disabled={selectedDay === 0}><ChevronLeft className="h-5 w-5" /></Button>
            <p className="font-black text-purple-950">{visibleDays[selectedDay]}</p>
            <Button type="button" variant="secondary" aria-label="Next day" onClick={() => setSelectedDay((day) => Math.min(visibleDays.length - 1, day + 1))} disabled={selectedDay === visibleDays.length - 1}><ChevronRight className="h-5 w-5" /></Button>
          </div>
          <div className="divide-y divide-purple-100">
            {relevantStaff.map((person) => {
              const shifts = shiftsFor(person.id, selectedDay + 1);
              return <div key={person.id} className="p-4">
                <p className="font-black text-purple-950">{person.fullName}</p><p className="text-sm text-slate-500">{person.employmentRole}</p>
                <div className="mt-3 grid gap-2">{shifts.map((shift) => <Button key={shift.id} type="button" variant="secondary" className="w-full justify-between" onClick={() => setEditor({ staff: person, dayOfWeek: selectedDay + 1, shift })}>{shift.startTime}–{shift.endTime}<Pencil className="h-4 w-4" /></Button>)}<Button type="button" variant="secondary" className="w-full" onClick={() => setEditor({ staff: person, dayOfWeek: selectedDay + 1 })}><Plus className="h-4 w-4" /> Add shift</Button></div>
              </div>;
            })}
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-purple-100 bg-white p-5 shadow-soft" aria-labelledby="pattern-tools-title">
        <h2 id="pattern-tools-title" className="flex items-center gap-2 text-lg font-black text-purple-950"><Copy className="h-5 w-5" /> Copy employee pattern</h2>
        <RotaActionForm action={copyRotaTemplateStaffPatternAction} submitLabel="Copy pattern" variant="secondary" className="mt-4 grid gap-4 lg:grid-cols-[1fr_12rem_2fr_auto] lg:items-end">
          {hidden("templateId", data.selected.id)}
          <Field label="Staff member"><select className={inputClassName()} name="staffId" value={patternStaff} onChange={(event) => setPatternStaff(event.target.value)}>{relevantStaff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></Field>
          <Field label="Source day"><select className={inputClassName()} name="sourceDay">{visibleDays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></Field>
          <fieldset><legend className="mb-1 text-sm font-semibold text-purple-950">Copy to selected days</legend><div className="flex flex-wrap gap-3">{visibleDays.map((day, index) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-xl border border-purple-200 px-3 text-sm font-bold text-purple-900"><input type="checkbox" name="targetDays" value={index + 1} /> {day.slice(0, 3)}</label>)}</div></fieldset>
        </RotaActionForm>
        <RotaActionForm action={clearRotaTemplateStaffDayAction} submitLabel="Clear employee day" variant="danger" className="mt-4 flex flex-wrap items-end gap-3 border-t border-purple-100 pt-4" confirmMessage="Archive all template shifts for this employee on the selected day?">
          {hidden("templateId", data.selected.id)}
          <Field label="Staff member"><select className={inputClassName()} name="staffId" defaultValue={patternStaff}>{relevantStaff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></Field>
          <Field label="Day"><select className={inputClassName()} name="dayOfWeek">{visibleDays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></Field>
        </RotaActionForm>
      </section>
      {editor ? <TemplateEditorDrawer data={data} editor={editor} onClose={() => setEditor(null)} /> : null}
    </>
  );
}
