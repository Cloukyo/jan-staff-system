"use client";

import {
  activateKioskDeviceAction,
  allowKioskReprovisionAction,
  requireKioskReprovisionAction,
  revokeKioskDeviceAction,
} from "@/lib/kiosk/device-actions";
import type { KioskDeviceRow } from "@/lib/kiosk/server";
import { PayrollActionForm } from "@/components/payroll/payroll-action-form";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";

export function KioskDeviceManagement({ devices }: { devices: KioskDeviceRow[] }) {
  return <div className="grid gap-5">
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Register this browser for Staff Clock</h2>
      <p className="mt-2 text-sm text-slate-600">Registration signs the manager out of this browser and restricts it to Staff Clock until the device is removed or revoked.</p>
      <PayrollActionForm action={activateKioskDeviceAction} submitLabel="Register this device">
        <Field label="Device name"><input className={inputClassName()} name="deviceName" placeholder="Vicarage Road Front Tablet" required minLength={3} maxLength={100} /></Field>
      </PayrollActionForm>
    </Panel>
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Registered Staff Clock devices</h2>
      <p className="mt-2 text-sm text-slate-600">Offline authorisation refreshes from the kiosk while it is online. Managers can preserve evidence, require a clean reprovision or revoke access here.</p>
      <div className="mt-4 grid gap-4">
        {devices.map((device) => <article key={device.id} className="rounded-xl border border-purple-100 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-black text-purple-950">{device.deviceName}</h3><div className="mt-2 flex flex-wrap gap-2"><StatusPill tone={device.active ? "green" : "grey"}>{device.active ? "Active" : "Revoked"}</StatusPill><StatusPill tone={device.offlineEnabled ? "amber" : "grey"}>{device.offlineEnabled ? "Offline pilot enabled" : "Offline disabled"}</StatusPill>{device.reprovisionRequired ? <StatusPill tone="amber">Reprovision required</StatusPill> : null}</div></div>
            {device.unresolvedConflictCount > 0 ? <a className="min-h-11 rounded-xl bg-amber-100 px-4 py-3 font-bold text-amber-950 underline" href="/attendance?status=open&source=offline_sync">View sync conflicts ({device.unresolvedConflictCount})</a> : null}
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <HealthDatum label="Last contact" value={dateTime(device.lastContactAt)} />
            <HealthDatum label="Last roster refresh" value={dateTime(device.lastRosterRefreshAt)} />
            <HealthDatum label="Authorisation expiry" value={dateTime(device.authorisationExpiresAt)} />
            <HealthDatum label="Roster version" value={device.rosterVersion ? device.rosterVersion.slice(0, 12) : "Not provisioned"} />
            <HealthDatum label="App / schema" value={`${device.appVersion ?? "Unknown"} / ${device.schemaVersion}`} />
            <HealthDatum label="Last clock drift" value={device.lastClockDriftSeconds === null ? "Unknown" : `${device.lastClockDriftSeconds} seconds`} />
            <HealthDatum label="Last successful sync" value={dateTime(device.lastSuccessfulSyncAt)} />
            <HealthDatum label="Last sync failure" value={device.lastSyncFailureAt ? `${dateTime(device.lastSyncFailureAt)} (${device.lastSyncFailureCategory ?? "unknown"})` : "None reported"} />
            <HealthDatum label="Pending actions" value={String(device.pendingCount)} />
            <HealthDatum label="Oldest pending action" value={dateTime(device.oldestPendingActionAt)} />
            <HealthDatum label="Last kiosk use" value={dateTime(device.lastUsedAt)} />
            <HealthDatum label="Registration expiry" value={formatDateUk(device.expiresAt)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-3">
            {device.active && !device.reprovisionRequired ? <PayrollActionForm action={requireKioskReprovisionAction} submitLabel="Require reprovisioning"><input type="hidden" name="deviceId" value={device.id} /></PayrollActionForm> : null}
            {device.active && device.reprovisionRequired ? <PayrollActionForm action={allowKioskReprovisionAction} submitLabel="Allow reprovisioning"><input type="hidden" name="deviceId" value={device.id} /></PayrollActionForm> : null}
            {device.active ? <PayrollActionForm action={revokeKioskDeviceAction} submitLabel="Revoke"><input type="hidden" name="deviceId" value={device.id} /></PayrollActionForm> : null}
          </div>
          {device.reprovisionRequired ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-950">Reconnect this kiosk, choose Allow reprovisioning, then use Sync now on the kiosk. Pending evidence remains on the device.</p> : null}
        </article>)}
        {!devices.length ? <p className="text-sm text-slate-600">No Staff Clock devices are registered.</p> : null}
      </div>
      <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950"><p className="font-black">Replacing a kiosk</p><p className="mt-2">Keep the old device powered and disconnected from public use. Never erase or reset the old device while it may contain pending attendance. Reconnect and sync it first, review any conflicts, then revoke it and register the replacement.</p></div>
    </Panel>
  </div>;
}

function dateTime(value: string | null) {
  return value ? `${formatDateUk(value)} ${formatTimeUk(value)}` : "Never";
}

function HealthDatum({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-bold text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{value}</dd></div>;
}
