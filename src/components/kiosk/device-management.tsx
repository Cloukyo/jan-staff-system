"use client";

import { activateKioskDeviceAction, revokeKioskDeviceAction } from "@/lib/kiosk/device-actions";
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
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Device</th><th className="p-2">Status</th><th className="p-2">Last used</th><th className="p-2">Expires</th><th className="p-2">Action</th></tr></thead><tbody>
        {devices.map((device) => <tr key={device.id} className="border-t border-purple-100"><td className="p-2 font-bold">{device.deviceName}</td><td className="p-2"><StatusPill tone={device.active ? "green" : "grey"}>{device.active ? "Active" : "Revoked"}</StatusPill></td><td className="p-2">{device.lastUsedAt ? `${formatDateUk(device.lastUsedAt)} ${formatTimeUk(device.lastUsedAt)}` : "Never"}</td><td className="p-2">{formatDateUk(device.expiresAt)}</td><td className="p-2">{device.active ? <PayrollActionForm action={revokeKioskDeviceAction} submitLabel="Revoke"><input type="hidden" name="deviceId" value={device.id} /></PayrollActionForm> : "-"}</td></tr>)}
      </tbody></table></div>
    </Panel>
  </div>;
}
