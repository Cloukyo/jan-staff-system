"use client";

import { useActionState, useMemo } from "react";
import { MonitorCheck, ShieldCheck, Wifi } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { claimCommercialKioskAction, type KioskSetupActionState } from "@/lib/onboarding/kiosk-actions";

const initial: KioskSetupActionState = { ok: false, code: "", message: "" };
function nonce() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

export function CommercialKioskRegistration({ registrationId = "", registrationCode = "" }: { registrationId?: string; registrationCode?: string }) {
  const [state, action, pending] = useActionState(claimCommercialKioskAction, initial);
  const claimantNonce = useMemo(() => nonce(), []);
  const preservedCode = state.enteredRegistrationCode ?? registrationCode;
  return <main className="kiosk-register-shell"><div className="kiosk-register-card"><div className="kiosk-register-mark"><MonitorCheck aria-hidden/></div><div className="kiosk-register-heading"><h1>Register this clocking device</h1><p>Enter the one-time code shown on the manager&apos;s setup screen.</p></div><form action={action} className="kiosk-register-form"><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="claimantNonce" value={claimantNonce}/><label>One-time registration code<input key={preservedCode} name="registrationSecret" defaultValue={preservedCode} autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} maxLength={19} placeholder="ABCD EFGH JKLM NPQR" aria-invalid={state.message ? true : undefined} aria-describedby={state.message ? "kiosk-registration-error" : undefined} required/></label>{state.message ? <div id="kiosk-registration-error" className="kiosk-register-error" role="alert">{state.message}</div> : null}<Button disabled={pending}>{pending ? "Connecting securely..." : "Connect this device"}</Button></form><div className="kiosk-register-trust"><div><Wifi aria-hidden/><span>Keep this tablet connected to Wi-Fi</span></div><div><ShieldCheck aria-hidden/><span>The code expires quickly and works once</span></div></div></div></main>;
}

export function CommercialPreLiveKiosk({ siteName, staffCount, connected = true }: { siteName: string; staffCount: number; connected?: boolean }) {
  return <main className="kiosk-prelive-shell"><header><div className="kiosk-prelive-brand"><MonitorCheck aria-hidden/><span>Staff Clock</span></div><span className={connected ? "kiosk-prelive-online" : "kiosk-prelive-offline"}><Wifi aria-hidden/>{connected ? "Online" : "Connection problem"}</span></header><section><div className="kiosk-prelive-success"><ShieldCheck aria-hidden/></div><span>Pre-live</span><h1>Setup complete</h1><p>This device is connected to <strong>{siteName}</strong> and can see {staffCount} {staffCount === 1 ? "person" : "people"} ready for attendance.</p><div className="kiosk-prelive-message"><strong>Waiting for Go Live</strong><p>Clock-in and clock-out stay unavailable until an authorised manager completes final setup.</p></div></section><footer>Online attendance only · Offline clocking is disabled</footer></main>;
}
