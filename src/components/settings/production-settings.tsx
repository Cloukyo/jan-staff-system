import Link from "next/link";
import { Panel, StatusPill } from "@/components/ui/primitives";

export function ProductionSettingsScreen() {
  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-bold text-green-700">Production configuration</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Settings</h1>
        <p className="mt-2 text-slate-600">Only settings that persist in production are shown here.</p>
      </div>
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
      <Panel className="border-purple-200 bg-purple-50">
        <h2 className="text-xl font-black text-purple-950">Nursery configuration</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">Opening hours, rooms and other nursery-wide options do not yet have a persisted production schema. They are intentionally hidden rather than presenting controls that would not save.</p>
      </Panel>
    </div>
  );
}
