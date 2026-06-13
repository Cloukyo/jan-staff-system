import Link from "next/link";
import { Archive, Copy, Plus } from "lucide-react";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import {
  archiveRotaTemplateAction,
  archiveRotaTemplateShiftAction,
  createRotaTemplateAction,
  duplicateRotaTemplateAction,
  duplicateRotaTemplateShiftAction,
  saveRotaTemplateShiftAction,
  updateRotaTemplateAction,
} from "@/lib/rota/template-actions";
import type { RotaTemplateDataset, RotaTemplateShift } from "@/lib/rota/template-types";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function hidden(name: string, value: string) {
  return <input type="hidden" name={name} value={value} />;
}

function TemplateShiftFields({ data, shift }: { data: RotaTemplateDataset; shift?: RotaTemplateShift }) {
  const firstActive = data.staff.find((person) => person.active);
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Field label="Staff member">
        <select className={inputClassName()} name="staffId" defaultValue={shift?.staffId ?? firstActive?.id} required>
          {data.staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName || person.fullName}{person.active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Weekday">
        <select className={inputClassName()} name="dayOfWeek" defaultValue={shift?.dayOfWeek ?? 1}>
          {days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
        </select>
      </Field>
      <Field label="Start time"><input className={inputClassName()} name="startTime" type="time" defaultValue={shift?.startTime ?? "08:30"} required /></Field>
      <Field label="Finish time"><input className={inputClassName()} name="endTime" type="time" defaultValue={shift?.endTime ?? "16:30"} required /></Field>
      <Field label="Break minutes"><input className={inputClassName()} name="breakMinutes" type="number" min="0" step="5" defaultValue={shift?.breakMinutes ?? 30} required /></Field>
      <Field label="Room or area"><input className={inputClassName()} name="roomOrArea" defaultValue={shift?.roomOrArea ?? ""} /></Field>
      <Field label="Role on shift"><input className={inputClassName()} name="roleOnShift" defaultValue={shift?.roleOnShift ?? ""} /></Field>
      <Field label="Display order"><input className={inputClassName()} name="sortOrder" type="number" defaultValue={shift?.sortOrder ?? 0} /></Field>
      <Field label="Notes"><input className={inputClassName()} name="notes" defaultValue={shift?.notes ?? ""} /></Field>
    </div>
  );
}

function TemplateShiftEditor({ data, shift }: { data: RotaTemplateDataset; shift: RotaTemplateShift }) {
  const staff = data.staff.find((person) => person.id === shift.staffId);
  return (
    <details className="rounded-lg border border-purple-100 bg-white p-3">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-black text-purple-950">{staff?.displayName || staff?.fullName || "Missing staff profile"}</p>
            <p className="text-sm text-slate-600">{days[shift.dayOfWeek - 1]} {shift.startTime} to {shift.endTime}, {shift.breakMinutes} minute break</p>
          </div>
          <StatusPill tone={staff?.active ? "green" : "amber"}>{staff?.active ? "Ready" : "Inactive staff"}</StatusPill>
        </div>
      </summary>
      <div className="mt-4 border-t border-purple-100 pt-4">
        <RotaActionForm action={saveRotaTemplateShiftAction} submitLabel="Save shift" className="grid gap-4">
          {hidden("templateId", shift.templateId)}{hidden("shiftId", shift.id)}
          <TemplateShiftFields data={data} shift={shift} />
        </RotaActionForm>
        <div className="mt-4 grid gap-3 border-t border-purple-100 pt-4 md:grid-cols-2">
          <RotaActionForm action={duplicateRotaTemplateShiftAction} submitLabel="Duplicate shift" variant="secondary" className="grid gap-3">
            {hidden("shiftId", shift.id)}
            <Field label="Duplicate to weekday">
              <select className={inputClassName()} name="dayOfWeek" defaultValue={Math.min(shift.dayOfWeek + 1, 7)}>
                {days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
              </select>
            </Field>
          </RotaActionForm>
          <RotaActionForm action={archiveRotaTemplateShiftAction} submitLabel="Archive shift" variant="danger" className="self-end" confirmMessage="Archive this template shift?">
            {hidden("shiftId", shift.id)}
          </RotaActionForm>
        </div>
      </div>
    </details>
  );
}

export function TemplateManager({ data }: { data: RotaTemplateDataset }) {
  const selected = data.selected;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
          <h1 className="mt-1 text-3xl font-black text-purple-950">Rota templates</h1>
          <p className="mt-2 text-slate-600">Build reusable weekly patterns without changing live or historic rotas.</p>
        </div>
        <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 px-4 text-sm font-bold text-purple-900" href="/rota">Back to rota</Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[20rem_1fr]">
        <div className="grid content-start gap-5">
          <Panel>
            <h2 className="flex items-center gap-2 text-xl font-black text-purple-950"><Plus className="h-5 w-5" /> New template</h2>
            <RotaActionForm action={createRotaTemplateAction} submitLabel="Create blank template" className="mt-4 grid gap-3">
              <Field label="Template name"><input className={inputClassName()} name="name" required /></Field>
              <Field label="Description"><textarea className={inputClassName("min-h-20")} name="description" /></Field>
            </RotaActionForm>
          </Panel>
          <Panel>
            <h2 className="text-xl font-black text-purple-950">Templates</h2>
            <div className="mt-3 grid gap-2">
              {data.templates.map((template) => (
                <Link key={template.id} href={`/rota/templates?template=${template.id}`} className={`rounded-lg border p-3 ${selected?.id === template.id ? "border-purple-600 bg-purple-50" : "border-purple-100"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-purple-950">{template.name}</span>
                    <StatusPill tone={template.status === "active" ? "green" : "grey"}>{template.status}</StatusPill>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{template.sourceType.replaceAll("_", " ")}</p>
                </Link>
              ))}
              {!data.templates.length ? <EmptyState title="No templates" body="Create a blank template to begin." /> : null}
            </div>
          </Panel>
        </div>

        {selected ? (
          <div className="grid content-start gap-5">
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-xl font-black text-purple-950">{selected.name}</h2><p className="text-sm text-slate-600">{selected.description || "No description"}</p></div>
                <StatusPill tone={selected.status === "active" ? "green" : "grey"}>{selected.status}</StatusPill>
              </div>
              {selected.status === "active" ? (
                <>
                  <RotaActionForm action={updateRotaTemplateAction} submitLabel="Save template details" className="mt-4 grid gap-3">
                    {hidden("templateId", selected.id)}
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Name"><input className={inputClassName()} name="name" defaultValue={selected.name} required /></Field>
                      <Field label="Description"><input className={inputClassName()} name="description" defaultValue={selected.description ?? ""} /></Field>
                    </div>
                  </RotaActionForm>
                  <div className="mt-4 grid gap-3 border-t border-purple-100 pt-4 md:grid-cols-2">
                    <RotaActionForm action={duplicateRotaTemplateAction} submitLabel="Duplicate template" variant="secondary" className="grid gap-3">
                      {hidden("templateId", selected.id)}
                      <Field label="New template name"><input className={inputClassName()} name="name" defaultValue={`${selected.name} copy`} required /></Field>
                    </RotaActionForm>
                    <RotaActionForm action={archiveRotaTemplateAction} submitLabel="Archive template" variant="danger" className="self-end" confirmMessage="Archive this template? Existing rota weeks will not be changed.">
                      {hidden("templateId", selected.id)}
                    </RotaActionForm>
                  </div>
                </>
              ) : <p className="mt-4 text-sm font-bold text-slate-600">Archived templates are retained for audit history and cannot be edited or applied.</p>}
            </Panel>

            <Panel>
              <h2 className="text-xl font-black text-purple-950">Weekly coverage preview</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {days.map((day, index) => {
                  const count = data.shifts.filter((shift) => shift.dayOfWeek === index + 1).length;
                  return <div key={day} className="rounded-lg bg-purple-50 p-3 text-center"><p className="text-xs font-bold text-purple-700">{day.slice(0, 3)}</p><p className="mt-1 text-2xl font-black text-purple-950">{count}</p></div>;
                })}
              </div>
            </Panel>

            {selected.status === "active" ? (
              <Panel>
                <h2 className="flex items-center gap-2 text-xl font-black text-purple-950"><Plus className="h-5 w-5" /> Add template shift</h2>
                <RotaActionForm action={saveRotaTemplateShiftAction} submitLabel="Add template shift" className="mt-4 grid gap-4">
                  {hidden("templateId", selected.id)}
                  <TemplateShiftFields data={data} />
                </RotaActionForm>
              </Panel>
            ) : null}

            <Panel>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-black text-purple-950">Template shifts</h2>
                <StatusPill tone="purple">{data.shifts.length} shifts</StatusPill>
              </div>
              <div className="mt-4 grid gap-3">
                {data.shifts.map((shift) => <TemplateShiftEditor key={shift.id} data={data} shift={shift} />)}
                {!data.shifts.length ? <EmptyState title="No template shifts" body="Add staff shifts using weekday positions." /> : null}
              </div>
            </Panel>
          </div>
        ) : null}
      </div>
      <p className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Archive className="h-4 w-4" /> Archiving a template never alters a rota week. <Copy className="ml-2 h-4 w-4" /> Duplicates are independent copies.</p>
    </>
  );
}
