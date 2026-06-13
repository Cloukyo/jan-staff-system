"use client";

import { useActionState } from "react";
import { addClockCorrectionAction } from "@/lib/kiosk/actions";
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
