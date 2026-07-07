"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { saveProductionNurserySettingsAction, type SettingsActionResult } from "@/lib/settings/actions";
import type { ProductionNurserySettings } from "@/lib/settings/server";

const initialState: SettingsActionResult = { ok: false, message: "" };
const weekDays = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

export function ProductionSettingsScreen({ settings }: { settings: ProductionNurserySettings }) {
  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-bold text-green-700">Production configuration</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Settings</h1>
        <p className="mt-2 text-slate-600">Only settings that persist in production are shown here.</p>
      </div>
      <ProductionSettingsForm settings={settings} />
      <div className="grid gap-5 md:grid-cols-2">
        <Panel>
          <div className="flex items-start justify-between gap-3"><h2 className="text-xl font-black text-purple-950">Rota</h2><StatusPill tone="green">Production</StatusPill></div>
          <p className="mt-2 text-sm text-slate-600">Rota weeks begin on Monday and use Europe/London time. Manage reusable patterns from Rota templates.</p>
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href="/rota/templates">Open rota templates</Link>
        </Panel>
        <Panel>
          <div className="flex items-start justify-between gap-3"><h2 className="text-xl font-black text-purple-950">Kiosk Setup</h2><StatusPill tone="green">Production</StatusPill></div>
          <p className="mt-2 text-sm text-slate-600">Register Staff Clock devices and manage employee PIN readiness.</p>
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href="/settings/kiosk">Open Kiosk Setup</Link>
        </Panel>
      </div>
    </div>
  );
}

function ProductionSettingsForm({ settings }: { settings: ProductionNurserySettings }) {
  const [state, action, pending] = useActionState(saveProductionNurserySettingsAction, initialState);
  return (
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Nursery configuration</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">These settings are saved in production and used by Staff Clock and attendance summaries.</p>
      <form action={action} className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Work week starts on">
          <select className={inputClassName()} name="workWeekStartsOn" defaultValue={settings.workWeekStartsOn}>
            {weekDays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
          </select>
        </Field>
        <button className="min-h-11 rounded-lg bg-purple-700 px-5 font-bold text-white disabled:opacity-60" disabled={pending} type="submit">
          {pending ? "Saving" : "Save settings"}
        </button>
      </form>
      {state.message ? <p className={`mt-3 text-sm font-bold ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p> : null}
    </Panel>
  );
}
