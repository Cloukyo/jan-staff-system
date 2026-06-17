"use client";

import { useActionState } from "react";
import { saveKioskSettingsAction, setKioskPinAction } from "@/lib/kiosk/actions";
import type { KioskActionResult } from "@/lib/kiosk/types";
import type { ManagerKioskRow } from "@/lib/kiosk/server";
import { Field, Panel, StatusPill } from "@/components/ui/primitives";
import { PasswordInput } from "@/components/ui/password-input";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";

const initial: KioskActionResult = { ok: false, code: "idle", message: "" };

export function StaffKioskManagement({ staff }: { staff: ManagerKioskRow[] }) {
  return (
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Staff kiosk access and PINs</h2>
      <p className="mt-2 text-sm text-slate-600">Enable Staff Clock access or set a temporary PIN. Every temporary PIN must be replaced by the employee at their next use.</p>
      <div className="mt-4 grid gap-4">
        {staff.map((person) => <StaffKioskControl key={person.staffId} person={person} />)}
      </div>
    </Panel>
  );
}

function StaffKioskControl({ person }: { person: ManagerKioskRow }) {
  const [settingsState, settingsAction] = useActionState(saveKioskSettingsAction, initial);
  const [pinState, pinAction] = useActionState(setKioskPinAction, initial);
  return (
    <div className="rounded-lg border border-purple-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-black text-purple-950">{person.fullName}</h3>
          <p className="text-sm text-slate-600">{person.employmentRole}</p>
          <p className="mt-1 text-xs text-slate-500">
            PIN updated: {person.pinUpdatedAt ? formatDateUk(person.pinUpdatedAt) : "Never"} | Failed attempts: {person.failedAttemptCount}
            {person.lockedUntil ? ` | Locked until ${formatTimeUk(person.lockedUntil)}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">Last Staff Clock use: {person.lastKioskUseAt ? `${formatDateUk(person.lastKioskUseAt)} ${formatTimeUk(person.lastKioskUseAt)}` : "Never"}</p>
        </div>
        <StatusPill tone={!person.kioskEnabled ? "grey" : person.pinReady ? "green" : "amber"}>
          {!person.kioskEnabled ? "Disabled" : person.pinReady ? "PIN ready" : person.pinUpdatedAt ? "PIN change required" : "PIN setup needed"}
        </StatusPill>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <form action={settingsAction} className="rounded-lg bg-purple-50 p-3">
          <input type="hidden" name="staffId" value={person.staffId} />
          <label className="flex min-h-11 items-center gap-3 font-bold"><input type="checkbox" name="kioskEnabled" defaultChecked={person.kioskEnabled} /> Staff Clock enabled</label>
          <button className="mt-3 min-h-11 rounded-lg bg-white px-4 font-bold text-purple-900 ring-1 ring-purple-200" type="submit">Save access</button>
          {settingsState.message ? <p className={`mt-2 text-sm font-bold ${settingsState.ok ? "text-green-700" : "text-red-700"}`}>{settingsState.message}</p> : null}
        </form>
        <form action={pinAction} className="rounded-lg bg-purple-50 p-3">
          <input type="hidden" name="staffId" value={person.staffId} />
          <Field label={person.pinUpdatedAt ? "New temporary PIN" : "Temporary PIN"}>
            <PasswordInput
              autoComplete="new-password"
              hideLabel="Hide PIN"
              inputMode="numeric"
              maxLength={6}
              minLength={4}
              name="pin"
              revealLabel="Show PIN"
              required
            />
          </Field>
          <p className="mt-3 text-sm font-semibold text-purple-900">The employee will be required to choose a new private PIN before clocking in or out.</p>
          <button className="mt-3 min-h-11 rounded-lg bg-purple-700 px-4 font-bold text-white" type="submit">{person.pinUpdatedAt ? "Reset with temporary PIN" : "Set temporary PIN"}</button>
          {pinState.message ? <p className={`mt-2 text-sm font-bold ${pinState.ok ? "text-green-700" : "text-red-700"}`}>{pinState.message}</p> : null}
        </form>
      </div>
    </div>
  );
}
