"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { activateKioskDeviceAction, revokeKioskDeviceAction } from "@/lib/kiosk/device-actions";
import type { KioskDeviceRow } from "@/lib/kiosk/server";
import { PayrollActionForm } from "@/components/payroll/payroll-action-form";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";
import { refreshStaffClockAction } from "@/lib/kiosk/actions";
import type { KioskActionResult } from "@/lib/kiosk/types";

const initialRefreshState: KioskActionResult = {
  ok: false,
  code: "idle",
  message: "",
};

async function runStaffClockRefresh(
  _state: KioskActionResult,
): Promise<KioskActionResult> {
  void _state;
  return refreshStaffClockAction();
}

export function RefreshStaffClockControl() {
  const [state, action, pending] = useActionState(
    runStaffClockRefresh,
    initialRefreshState,
  );

  return (
    <form action={action}>
      <button
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        <RefreshCw aria-hidden className="h-5 w-5" />
        {pending ? "Refreshing..." : "Refresh Staff Clock"}
      </button>
      {state.message && (
        <p
          aria-live="polite"
          className={`mt-3 text-sm font-bold ${state.ok ? "text-green-700" : "text-red-700"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function KioskDeviceManagement({ devices }: { devices: KioskDeviceRow[] }) {
  return <div className="grid gap-5">
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-purple-950">Staff Clock information</h2>
          <p className="mt-2 text-sm text-slate-600">
            Refresh after changing an employee&apos;s name or clocking-in access.
          </p>
        </div>
        <RefreshStaffClockControl />
      </div>
    </Panel>
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Register this browser</h2>
      <p className="mt-2 text-sm text-slate-600">Registration signs the manager out of this browser and restricts it to Staff Clock until the device is removed or revoked.</p>
      <PayrollActionForm action={activateKioskDeviceAction} submitLabel="Register this browser">
        <Field label="Device name"><input className={inputClassName()} name="deviceName" placeholder="Vicarage Road Front Tablet" required minLength={3} maxLength={100} /></Field>
      </PayrollActionForm>
    </Panel>
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Registered devices</h2>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Device</th><th className="p-2">Status</th><th className="p-2">Last used</th><th className="p-2">Expires</th><th className="p-2">Action</th></tr></thead><tbody>
        {devices.map((device) => <tr key={device.id} className="border-t border-purple-100"><td className="p-2 font-bold">{device.deviceName}</td><td className="p-2"><StatusPill tone={device.active ? "green" : "grey"}>{device.active ? "Active" : "Revoked"}</StatusPill></td><td className="p-2">{device.lastUsedAt ? `${formatDateUk(device.lastUsedAt)} ${formatTimeUk(device.lastUsedAt)}` : "Never"}</td><td className="p-2">{formatDateUk(device.expiresAt)}</td><td className="p-2">{device.active ? <PayrollActionForm action={revokeKioskDeviceAction} submitLabel="Revoke device"><input type="hidden" name="deviceId" value={device.id} /></PayrollActionForm> : "-"}</td></tr>)}
      </tbody></table></div>
    </Panel>
  </div>;
}
