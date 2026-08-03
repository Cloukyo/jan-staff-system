"use client";

import { CheckCircle2, Clock3 } from "lucide-react";
import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import { PinKeypad } from "@/components/kiosk/pin-keypad";
import { ServiceWorkerRegistration } from "@/components/kiosk/service-worker-registration";
import { OfflineStatus } from "@/components/kiosk/offline-status";
import { useOfflineKiosk } from "@/components/kiosk/use-offline-kiosk";
import { BrandMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/primitives";
import {
  changeTemporaryKioskPinAction,
  performKioskAttendanceAction,
  verifyKioskPinAction,
} from "@/lib/kiosk/actions";
import { exitKioskModeAction } from "@/lib/kiosk/device-actions";
import type { KioskRosterEntry } from "@/lib/kiosk/types";
import { initialKioskFlowState, kioskFlowReducer } from "@/lib/kiosk/flow";
import { kioskActionPresentation } from "@/lib/kiosk/presentation";
import { formatDateUk, formatHours } from "@/lib/dates/format";
import {
  enrolVerifiedOfflinePin,
  queueProvisionalAttendanceAction,
  verifyStoredOfflinePin,
} from "@/lib/kiosk/offline/provisioning";
import { buildProvisionalState } from "@/lib/kiosk/offline/projection";

export function ProductionKiosk({ initialRoster }: { initialRoster: KioskRosterEntry[] }) {
  const [roster, setRoster] = useState(initialRoster);
  const [selected, setSelected] = useState<KioskRosterEntry | null>(null);
  const [flow, dispatch] = useReducer(kioskFlowReducer, initialKioskFlowState);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [changeStep, setChangeStep] = useState<"new" | "confirm">("new");
  const [message, setMessage] = useState("");
  const [localSuccess, setLocalSuccess] = useState(false);
  const [weeklyHours, setWeeklyHours] = useState<{
    weekStartDate: string;
    weekEndDate: string;
    completedMinutes: number;
    openShiftInProgress: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const submissionKey = useRef<string | null>(null);
  const verifiedPin = useRef("");
  const verifiedOffline = useRef(false);
  const offline = useOfflineKiosk();
  const rosterStatus = new Map(roster.map((person) => [person.staffId, person.currentStatus]));
  const displayRoster = offline.runtime.package
    ? offline.runtime.package.roster.map((person) => ({
      staffId: person.staffId,
      displayName: person.displayName,
      fullName: person.displayName,
      employmentRole: person.employmentRole,
      currentStatus: rosterStatus.get(person.staffId)
        ?? (person.trustedState.state === "clocked_in" ? "clocked_in" : "clocked_out"),
      pinReady: true,
    })) satisfies KioskRosterEntry[]
    : roster;

  function reset() {
    setSelected(null);
    dispatch({ type: "cancel" });
    submissionKey.current = null;
    verifiedPin.current = "";
    verifiedOffline.current = false;
    setNewPin("");
    setConfirmPin("");
    setChangeStep("new");
    setMessage("");
    setLocalSuccess(false);
    setWeeklyHours(null);
  }

  function verify() {
    if (!selected) return;
    startTransition(async () => {
      const enteredPin = flow.pin;
      dispatch({ type: "pin_changed", pin: "" });
      if (offline.connection === "offline") {
        if (!offline.offlineUsable) {
          setMessage("Offline clocking is unavailable until this device reconnects.");
          dispatch({ type: "invalid" });
          return;
        }
        const offlineResult = await verifyStoredOfflinePin({
          staffId: selected.staffId,
          pin: enteredPin,
          now: new Date().toISOString(),
        });
        if (offlineResult.status !== "verified") {
          setMessage(offlineResult.status === "unavailable"
            ? "Offline PIN is not ready for this person. Reconnect and use the PIN once online."
            : offlineResult.status === "locked"
              ? "Offline PIN is locked. Reconnect and ask a manager for help."
              : "PIN not recognised.");
          dispatch({ type: "invalid" });
          return;
        }
        const attendanceState = await buildProvisionalState(selected.staffId);
        verifiedOffline.current = true;
        setSelected({ ...selected, currentStatus: attendanceState.state === "clocked_in" ? "clocked_in" : "clocked_out" });
        setWeeklyHours(null);
        setMessage("Offline PIN accepted. Confirm the action to save it on this device.");
        dispatch({ type: "verified", attendanceState });
        return;
      }
      let result;
      try {
        result = await verifyKioskPinAction(selected.staffId, enteredPin);
      } catch {
        setMessage("The server could not be reached. Wait for the Offline status before trying again.");
        dispatch({ type: "invalid" });
        return;
      }
      setMessage(result.message);
      if (result.ok && result.code === "change_required") {
        verifiedPin.current = enteredPin;
        if (result.currentStatus) setSelected({ ...selected, currentStatus: result.currentStatus });
        if (result.weeklyHours) setWeeklyHours(result.weeklyHours);
        dispatch({ type: "change_required" });
        return;
      }
      if (result.ok && result.attendanceState) {
        verifiedPin.current = enteredPin;
        verifiedOffline.current = false;
        await enrolVerifiedOfflinePin({
          staffId: selected.staffId,
          pin: enteredPin,
          now: new Date().toISOString(),
        });
        const currentStatus = result.attendanceState.state === "clocked_in"
          ? "clocked_in"
          : "clocked_out";
        setSelected({ ...selected, currentStatus });
        setWeeklyHours(result.weeklyHours ?? null);
        dispatch({ type: "verified", attendanceState: result.attendanceState });
        return;
      }
      dispatch({ type: "invalid" });
    });
  }

  function changePin() {
    if (!selected) return;
    startTransition(async () => {
      const result = await changeTemporaryKioskPinAction({
        staffId: selected.staffId,
        temporaryPin: verifiedPin.current,
        newPin,
        confirmation: confirmPin,
      });
      setMessage(result.message);
      if (!result.ok) return;
      const replacementPin = newPin;
      verifiedPin.current = "";
      setNewPin("");
      setConfirmPin("");
      setSelected({ ...selected, currentStatus: result.currentStatus ?? selected.currentStatus, pinReady: true });
      const verification = await verifyKioskPinAction(selected.staffId, replacementPin);
      setMessage(verification.message);
      if (!verification.ok || !verification.attendanceState) {
        dispatch({ type: "invalid" });
        return;
      }
      verifiedPin.current = replacementPin;
      await enrolVerifiedOfflinePin({
        staffId: selected.staffId,
        pin: replacementPin,
        now: new Date().toISOString(),
      });
      dispatch({ type: "verified", attendanceState: verification.attendanceState });
      setWeeklyHours(verification.weeklyHours ?? null);
    });
  }

  function record() {
    if (!selected || !flow.attendanceState) return;
    if (!verifiedOffline.current && !verifiedPin.current) {
      dispatch({ type: "invalid" });
      setMessage("Enter your PIN again to continue with the latest attendance status.");
      return;
    }
    const action = flow.attendanceState.allowedActions[0];
    if (!action || submissionKey.current) return;
    const before = flow.attendanceState;
    const key = crypto.randomUUID();
    submissionKey.current = key;
    dispatch({ type: "submit", idempotencyKey: key });
    startTransition(async () => {
      if (verifiedOffline.current) {
        try {
          const recordedAt = new Date().toISOString();
          const queued = await queueProvisionalAttendanceAction({
            staffId: selected.staffId,
            action,
            expectedRevision: before.revision,
            occurredAt: recordedAt,
            unresolvedOlderException: before.unresolvedExceptions.some(
              (issue) => issue.operationalDate < before.operationalDate,
            ),
          });
          submissionKey.current = null;
          verifiedOffline.current = false;
          await offline.queueChanged();
          const provisional = await buildProvisionalState(selected.staffId);
          const currentStatus = provisional.state === "clocked_in" ? "clocked_in" : "clocked_out";
          setRoster((current) => current.map((person) => person.staffId === selected.staffId ? { ...person, currentStatus } : person));
          const actionName = action === "clock_out" ? "Clock-out" : "Clock-in";
          setMessage(`${actionName} saved on this device at ${new Date(queued.occurredAtDevice).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}. Pending synchronisation.`);
          setLocalSuccess(true);
          dispatch({ type: "succeeded", recordedAt, completedMinutes: null });
        } catch (error) {
          submissionKey.current = null;
          setMessage(error instanceof Error ? error.message : "The action could not be saved on this device.");
          dispatch({ type: "invalid" });
        }
        return;
      }
      const result = await performKioskAttendanceAction({
        staffId: selected.staffId,
        pin: verifiedPin.current,
        action,
        expectedRevision: before.revision,
        idempotencyKey: key,
      });
      submissionKey.current = null;
      verifiedPin.current = "";
      setMessage(result.message);
      setLocalSuccess(false);
      if (result.code === "state_conflict" && result.attendanceState) {
        dispatch({ type: "conflict", latest: result.attendanceState });
        return;
      }
      if (!result.ok || !result.recordedAt) {
        dispatch({ type: "invalid" });
        return;
      }
      const currentStatus = result.attendanceState?.state === "clocked_in"
        ? "clocked_in"
        : "clocked_out";
      setRoster((current) => current.map((person) => person.staffId === selected.staffId ? { ...person, currentStatus } : person));
      const completedMinutes = action === "clock_out" && before.currentEvent
        ? Math.max(0, Math.floor((new Date(result.recordedAt).getTime()
          - new Date(before.currentEvent.eventTimestamp).getTime()) / 60_000))
        : null;
      setMessage(action === "clock_out" ? "Clocked out" : "Clocked in");
      dispatch({ type: "succeeded", recordedAt: result.recordedAt, completedMinutes });
      window.setTimeout(() => {
        dispatch({ type: "timeout" });
        reset();
      }, 4000);
    });
  }

  const presentation = flow.attendanceState
    ? kioskActionPresentation(flow.attendanceState, new Date().toISOString())
    : null;

  return (
    <main className="min-h-screen bg-purple-950 p-4 text-white">
      <ServiceWorkerRegistration />
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col rounded-2xl bg-lavender p-5 text-purple-950 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <div className="text-right">
            <p className="text-sm font-bold text-green-700">Registered Staff Clock device</p>
            <LiveTime />
          </div>
        </div>
        <OfflineStatus connection={offline.connection} runtime={offline.runtime} onSync={() => void offline.syncNow()} />
        <form action={exitKioskModeAction} className="mt-3 self-end">
          <button className="min-h-11 text-sm font-bold text-purple-700 underline" type="submit">Remove Staff Clock access from this browser</button>
        </form>

        {flow.mode === "select" ? (
          <>
            <h1 className="mt-8 text-center text-4xl font-black">Staff Clock</h1>
            <p className="mt-3 text-center font-semibold text-slate-600">Choose your name to clock in or clock out.</p>
            {!displayRoster.length ? <p className="mt-8 text-center font-bold text-red-700">No active Staff Clock users could be loaded. Please ask a manager for help.</p> : null}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displayRoster.map((person) => (
                <button
                  key={person.staffId}
                  className="min-h-28 rounded-lg bg-white p-5 text-left shadow-soft ring-1 ring-purple-100 transition hover:ring-purple-500 focus:outline-purple-700"
                  onClick={() => {
                    setSelected(person);
                    dispatch({ type: "choose" });
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

        {flow.mode === "change" && selected ? (
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

        {flow.mode === "pin" && selected ? (
          <KioskPanel title={`Enter PIN for ${selected.displayName}`} message={message}>
            <div className="mx-auto max-w-sm">
              <PinKeypad value={flow.pin} onChange={(value) => dispatch({ type: "pin_changed", pin: value })} label="Enter your PIN" />
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={reset}>Cancel</Button>
                <Button disabled={pending || flow.pin.length < 4 || !selected.pinReady} onClick={verify}>{pending ? "Checking" : "Continue"}</Button>
              </div>
            </div>
          </KioskPanel>
        ) : null}

        {flow.mode === "confirm" && selected && presentation ? (
          <KioskPanel title={`${presentation.heading}, ${selected.displayName}`} message={presentation.body}>
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
              {presentation.primaryLabel ? (
                <button disabled={pending || flow.pending} className="flex min-h-32 w-full items-center justify-center gap-3 rounded-lg bg-green-700 p-6 text-2xl font-black text-white disabled:opacity-60" onClick={record}>
                  <Clock3 className="h-8 w-8" /> {pending || flow.pending ? "Recording" : presentation.primaryLabel}
                </button>
              ) : null}
              <Button variant="secondary" className="mt-5 w-full" onClick={reset}>Cancel</Button>
            </div>
          </KioskPanel>
        ) : null}

        {flow.mode === "success" ? (
          <KioskPanel title={localSuccess ? "Saved on this device" : "Recorded"} message={localSuccess ? message : `${message}${flow.recordedAt ? ` at ${new Date(flow.recordedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}` : ""}.`}>
            <CheckCircle2 className="mx-auto h-24 w-24 text-green-600" />
            {flow.completedMinutes !== null ? <p className="mt-4 text-center text-lg font-bold">Shift duration: {formatHours(flow.completedMinutes)}</p> : null}
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
