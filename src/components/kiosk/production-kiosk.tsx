"use client";

import { CheckCircle2, Clock3, LogIn, LogOut } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { PinKeypad } from "@/components/kiosk/pin-keypad";
import { BrandMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/primitives";
import { changeTemporaryKioskPinAction, recordKioskEventAction, verifyKioskPinAction } from "@/lib/kiosk/actions";
import { exitKioskModeAction } from "@/lib/kiosk/device-actions";
import type { KioskRosterEntry } from "@/lib/kiosk/types";
import { formatDateUk, formatHours } from "@/lib/dates/format";

type Mode = "select" | "pin" | "change" | "action" | "success";

export function ProductionKiosk({ initialRoster }: { initialRoster: KioskRosterEntry[] }) {
  const [roster, setRoster] = useState(initialRoster);
  const [selected, setSelected] = useState<KioskRosterEntry | null>(null);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [changeStep, setChangeStep] = useState<"new" | "confirm">("new");
  const [mode, setMode] = useState<Mode>("select");
  const [message, setMessage] = useState("");
  const [weeklyHours, setWeeklyHours] = useState<{
    weekStartDate: string;
    weekEndDate: string;
    completedMinutes: number;
    openShiftInProgress: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setSelected(null);
    setPin("");
    setNewPin("");
    setConfirmPin("");
    setChangeStep("new");
    setMessage("");
    setWeeklyHours(null);
    setMode("select");
  }

  function verify() {
    if (!selected) return;
    startTransition(async () => {
      const result = await verifyKioskPinAction(selected.staffId, pin);
      setMessage(result.message);
      if (result.ok && result.code === "change_required") {
        if (result.currentStatus) setSelected({ ...selected, currentStatus: result.currentStatus });
        if (result.weeklyHours) setWeeklyHours(result.weeklyHours);
        setMode("change");
        return;
      }
      if (result.ok && result.currentStatus) {
        setSelected({ ...selected, currentStatus: result.currentStatus });
        setWeeklyHours(result.weeklyHours ?? null);
        setMode("action");
      }
    });
  }

  function changePin() {
    if (!selected) return;
    startTransition(async () => {
      const result = await changeTemporaryKioskPinAction({
        staffId: selected.staffId,
        temporaryPin: pin,
        newPin,
        confirmation: confirmPin,
      });
      setMessage(result.message);
      if (!result.ok) return;
      setPin(newPin);
      setNewPin("");
      setConfirmPin("");
      setSelected({ ...selected, currentStatus: result.currentStatus ?? selected.currentStatus, pinReady: true });
      setWeeklyHours(result.weeklyHours ?? null);
      setMode("action");
    });
  }

  function record(eventType: "clock_in" | "clock_out") {
    if (!selected) return;
    startTransition(async () => {
      const result = await recordKioskEventAction({ staffId: selected.staffId, pin, eventType });
      setMessage(result.ok ? `${eventType === "clock_in" ? "Clock in" : "Clock out"} recorded for ${selected.displayName}.` : result.message);
      if (!result.ok) return;
      const currentStatus = result.currentStatus ?? (eventType === "clock_in" ? "clocked_in" : "clocked_out");
      setRoster((current) => current.map((person) => person.staffId === selected.staffId ? { ...person, currentStatus } : person));
      setMode("success");
      window.setTimeout(reset, 4000);
    });
  }

  return (
    <main className="min-h-screen bg-purple-950 p-4 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col rounded-2xl bg-lavender p-5 text-purple-950 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <div className="text-right">
            <p className="text-sm font-bold text-green-700">Registered Staff Clock device</p>
            <LiveTime />
          </div>
        </div>
        <form action={exitKioskModeAction} className="mt-3 self-end">
          <button className="min-h-11 text-sm font-bold text-purple-700 underline" type="submit">Remove Staff Clock access from this browser</button>
        </form>

        {mode === "select" ? (
          <>
            <h1 className="mt-8 text-center text-4xl font-black">Staff Clock</h1>
            <p className="mt-3 text-center font-semibold text-slate-600">Choose your name to clock in or clock out.</p>
            {!roster.length ? <p className="mt-8 text-center font-bold text-red-700">No active Staff Clock users could be loaded. Please ask a manager for help.</p> : null}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {roster.map((person) => (
                <button
                  key={person.staffId}
                  className="min-h-28 rounded-lg bg-white p-5 text-left shadow-soft ring-1 ring-purple-100 transition hover:ring-purple-500 focus:outline-purple-700"
                  onClick={() => {
                    setSelected(person);
                    setMode("pin");
                    setMessage(person.pinReady ? "" : "A manager must set your Staff Clock PIN before you can clock in.");
                  }}
                >
                  <span className="text-2xl font-black">{person.displayName}</span>
                  <span className="mt-2 block text-sm font-semibold text-slate-500">{person.employmentRole}</span>
                  <span className={`mt-3 inline-flex items-center gap-2 text-sm font-bold ${person.currentStatus === "clocked_in" ? "text-green-700" : "text-slate-600"}`}>
                    <Clock3 className="h-4 w-4" /> {person.currentStatus === "clocked_in" ? "Clocked in" : "Clocked out"}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {mode === "change" && selected ? (
          <KioskPanel title="Choose your own PIN" message={message}>
            <div className="mx-auto grid max-w-sm gap-4">
              {changeStep === "new"
                ? <PinKeypad value={newPin} onChange={setNewPin} label="Enter a new PIN" />
                : <PinKeypad value={confirmPin} onChange={setConfirmPin} label="Enter the new PIN again" />}
              <p className="text-center text-sm font-semibold text-slate-600">Use four to six digits. Avoid repeated digits, simple sequences and birth years.</p>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={changeStep === "confirm" ? () => { setConfirmPin(""); setChangeStep("new"); } : reset}>{changeStep === "confirm" ? "Back" : "Cancel"}</Button>
                {changeStep === "new"
                  ? <Button disabled={newPin.length < 4} onClick={() => { setConfirmPin(""); setChangeStep("confirm"); }}>Continue</Button>
                  : <Button disabled={pending || confirmPin.length < 4} onClick={changePin}>{pending ? "Saving" : "Save PIN"}</Button>}
              </div>
            </div>
          </KioskPanel>
        ) : null}

        {mode === "pin" && selected ? (
          <KioskPanel title={`Enter PIN for ${selected.displayName}`} message={message}>
            <div className="mx-auto max-w-sm">
              <PinKeypad value={pin} onChange={setPin} label="Enter your PIN" />
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={reset}>Cancel</Button>
                <Button disabled={pending || pin.length < 4 || !selected.pinReady} onClick={verify}>{pending ? "Checking" : "Continue"}</Button>
              </div>
            </div>
          </KioskPanel>
        ) : null}

        {mode === "action" && selected ? (
          <KioskPanel title={`Hello ${selected.displayName}`} message={`You are currently ${selected.currentStatus === "clocked_in" ? "clocked in" : "clocked out"}.`}>
            <div className="mx-auto max-w-xl">
              {weeklyHours ? (
                <div className="mb-5 rounded-lg bg-white p-5 text-center shadow-soft ring-1 ring-purple-100">
                  <p className="text-sm font-bold text-slate-600">Completed hours this work week</p>
                  <p className="mt-1 text-4xl font-black text-purple-950">{formatHours(weeklyHours.completedMinutes)}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-600">
                    {formatDateUk(weeklyHours.weekStartDate)} to {formatDateUk(weeklyHours.weekEndDate)}
                  </p>
                  {weeklyHours.openShiftInProgress ? <p className="mt-2 text-sm font-bold text-amber-700">Current shift in progress is not included yet.</p> : null}
                </div>
              ) : null}
              {selected.currentStatus === "clocked_in" ? (
                <button disabled={pending} className="flex min-h-32 w-full items-center justify-center gap-3 rounded-lg bg-purple-700 p-6 text-2xl font-black text-white disabled:opacity-60" onClick={() => record("clock_out")}><LogOut className="h-8 w-8" /> Clock out</button>
              ) : (
                <button disabled={pending} className="flex min-h-32 w-full items-center justify-center gap-3 rounded-lg bg-green-700 p-6 text-2xl font-black text-white disabled:opacity-60" onClick={() => record("clock_in")}><LogIn className="h-8 w-8" /> Clock in</button>
              )}
              <Button variant="secondary" className="mt-5 w-full" onClick={reset}>Cancel</Button>
            </div>
          </KioskPanel>
        ) : null}

        {mode === "success" ? (
          <KioskPanel title="Recorded" message={message}>
            <CheckCircle2 className="mx-auto h-24 w-24 text-green-600" />
            <Button className="mx-auto mt-6 flex" onClick={reset}>Done</Button>
          </KioskPanel>
        ) : null}
      </div>
    </main>
  );
}

function KioskPanel({ title, message, children }: { title: string; message: string; children: React.ReactNode }) {
  return <div className="mx-auto mt-10 w-full max-w-3xl"><h1 className="text-center text-4xl font-black">{title}</h1><p className="mt-3 min-h-6 text-center font-bold text-purple-700">{message}</p><div className="mt-8">{children}</div></div>;
}

function LiveTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <p className="font-black">{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</p>;
}
