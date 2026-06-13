"use client";

import { useActionState } from "react";
import { addClockCorrectionAction, saveKioskSettingsAction, setKioskPinAction } from "@/lib/kiosk/actions";
import type { KioskActionResult } from "@/lib/kiosk/types";
import type { ManagerClockEvent, ManagerKioskRow } from "@/lib/kiosk/server";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, formatTimeUk } from "@/lib/dates/format";

const initial: KioskActionResult = { ok: false, code: "idle", message: "" };

export function ProductionAttendance({ staff, events }: { staff: ManagerKioskRow[]; events: ManagerClockEvent[] }) {
  const clockedIn = staff.filter((person) => person.currentStatus === "clocked_in");
  return (
    <div className="grid gap-5">
      <Panel>
        <h2 className="text-xl font-black text-purple-950">Currently clocked in</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {clockedIn.length ? clockedIn.map((person) => <StatusPill key={person.staffId} tone="green">{person.displayName}</StatusPill>) : <p className="text-sm text-slate-600">No staff are currently clocked in.</p>}
        </div>
      </Panel>

      <Panel>
        <h2 className="text-xl font-black text-purple-950">Kiosk access and PINs</h2>
        <div className="mt-4 grid gap-4">
          {staff.map((person) => <StaffKioskControl key={person.staffId} person={person} />)}
        </div>
      </Panel>

      <Panel>
        <h2 className="text-xl font-black text-purple-950">Add missed clock event</h2>
        <p className="mt-2 text-sm text-slate-600">Corrections are added as separate events. Original kiosk records are never overwritten.</p>
        <CorrectionForm>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Field label="Staff"><select className={inputClassName()} name="staffId" required>{staff.map((person) => <option key={person.staffId} value={person.staffId}>{person.fullName}</option>)}</select></Field>
            <Field label="Event"><select className={inputClassName()} name="eventType"><option value="clock_in">Clock in</option><option value="clock_out">Clock out</option></select></Field>
            <Field label="Date and time"><input className={inputClassName()} name="eventTimestamp" type="datetime-local" required /></Field>
            <Field label="Correction reason"><input className={inputClassName()} name="reason" minLength={5} required /></Field>
          </div>
        </CorrectionForm>
      </Panel>

      <Panel>
        <h2 className="text-xl font-black text-purple-950">Recent clock history</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-purple-100"><th className="p-2">Staff</th><th className="p-2">Event</th><th className="p-2">Time</th><th className="p-2">Source</th><th className="p-2">Reason</th></tr></thead>
            <tbody>{events.map((event) => {
              const person = staff.find((item) => item.staffId === event.staffId);
              return <tr key={event.id} className="border-b border-purple-50"><td className="p-2 font-bold">{person?.fullName ?? "Unknown staff"}</td><td className="p-2">{event.eventType === "clock_in" ? "Clock in" : "Clock out"}</td><td className="p-2">{formatDateUk(event.eventTimestamp)} {formatTimeUk(event.eventTimestamp)}</td><td className="p-2">{event.managerCorrection ? "Manager correction" : "Kiosk"}</td><td className="p-2">{event.correctionReason ?? ""}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function CorrectionForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState(addClockCorrectionAction, initial);
  return (
    <form action={action}>
      {children}
      <button className="mt-4 min-h-11 rounded-lg bg-purple-700 px-4 font-bold text-white disabled:opacity-60" disabled={pending} type="submit">{pending ? "Saving" : "Add correction"}</button>
      {state.message && <p className={`mt-3 text-sm font-bold ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}

function StaffKioskControl({ person }: { person: ManagerKioskRow }) {
  const [settingsState, settingsAction] = useActionState(saveKioskSettingsAction, initial);
  const [pinState, pinAction] = useActionState(setKioskPinAction, initial);
  return (
    <div className="rounded-lg border border-purple-100 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-black text-purple-950">{person.fullName}</h3>
          <p className="text-sm text-slate-600">{person.employmentRole} · {person.currentStatus === "clocked_in" ? "Clocked in" : "Clocked out"}</p>
          <p className="mt-1 text-xs text-slate-500">
            PIN updated: {person.pinUpdatedAt ? formatDateUk(person.pinUpdatedAt) : "Never"} · Failed attempts: {person.failedAttemptCount}
            {person.lockedUntil ? ` · Locked until ${formatTimeUk(person.lockedUntil)}` : ""}
          </p>
        </div>
        <StatusPill tone={person.pinReady ? "green" : "amber"}>
          {person.pinReady ? "PIN ready" : person.pinUpdatedAt ? "PIN change required" : "PIN setup needed"}
        </StatusPill>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <form action={settingsAction} className="flex flex-wrap items-center gap-4">
          <input type="hidden" name="staffId" value={person.staffId} />
          <label className="font-bold"><input type="checkbox" name="kioskEnabled" defaultChecked={person.kioskEnabled} /> Kiosk enabled</label>
          <label className="font-bold"><input type="checkbox" name="pinResetRequired" defaultChecked={person.pinResetRequired} /> Require PIN change at next use</label>
          <button className="min-h-11 rounded-lg bg-purple-100 px-4 font-bold text-purple-900" type="submit">Save access</button>
          {settingsState.message && <p className={settingsState.ok ? "text-green-700" : "text-red-700"}>{settingsState.message}</p>}
        </form>
        <form action={pinAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="staffId" value={person.staffId} />
          <Field label="Temporary PIN"><input className={inputClassName()} name="pin" inputMode="numeric" type="password" minLength={4} maxLength={6} autoComplete="new-password" required /></Field>
          <label className="flex min-h-11 items-center gap-2 font-bold">
            <input type="checkbox" name="requireChange" defaultChecked />
            Require staff member to choose a new PIN
          </label>
          <button className="min-h-11 rounded-lg bg-purple-700 px-4 font-bold text-white" type="submit">Set PIN</button>
          {pinState.message && <p className={pinState.ok ? "text-green-700" : "text-red-700"}>{pinState.message}</p>}
        </form>
      </div>
    </div>
  );
}
