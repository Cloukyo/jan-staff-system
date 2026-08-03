"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, Panel, inputClassName } from "@/components/ui/primitives";
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
        <h1 className="text-3xl font-black text-purple-950">Nursery settings</h1>
        <p className="mt-2 text-slate-600">Set the nursery work week and open related setup areas.</p>
      </div>
      <ProductionSettingsForm settings={settings} />
      <div className="grid gap-5 md:grid-cols-2">
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Rota templates</h2>
          <p className="mt-2 text-sm text-slate-600">Create and manage reusable weekly rota patterns.</p>
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href="/rota/templates">Open rota templates</Link>
        </Panel>
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Clocking-in devices</h2>
          <p className="mt-2 text-sm text-slate-600">Register nursery devices and refresh the Staff Clock.</p>
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href="/settings/kiosk">Open clocking-in devices</Link>
        </Panel>
      </div>
    </div>
  );
}

function ProductionSettingsForm({ settings }: { settings: ProductionNurserySettings }) {
  const [state, action, pending] = useActionState(saveProductionNurserySettingsAction, initialState);
  return (
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Work week</h2>
      <p className="mt-2 text-sm leading-6 text-slate-700">This setting is used by Staff Clock and attendance summaries.</p>
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
