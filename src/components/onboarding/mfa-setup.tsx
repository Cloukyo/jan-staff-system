"use client";

import Image from "next/image";
import { useActionState } from "react";
import { Button, Field, inputClassName } from "@/components/ui/primitives";
import {
  startMfaEnrollmentAction,
  verifyMfaAction,
  type MfaActionState,
} from "@/lib/auth/mfa-actions";

export function MfaSetup({ nextPath, hasVerifiedFactor }: { nextPath: string; hasVerifiedFactor: boolean }) {
  const initialState: MfaActionState = { stage: "ready", factorId: null, qrCode: null, secret: null, message: "" };
  const [enrolment, enrolAction, enrolPending] = useActionState(startMfaEnrollmentAction, initialState);
  const [verification, verifyAction, verifyPending] = useActionState(verifyMfaAction, enrolment);
  const state = enrolment.stage === "enrolment" ? enrolment : verification;
  return (
    <div className="onboarding-mfa-flow">
      {!hasVerifiedFactor && enrolment.stage !== "enrolment" ? <><p>Use an authenticator app to add a protected second step to your owner account.</p><form action={enrolAction}><Button type="submit" disabled={enrolPending}>{enrolPending ? "Starting setup..." : "Set up authenticator"}</Button></form></> : null}
      {enrolment.stage === "enrolment" && enrolment.qrCode && enrolment.secret ? <div className="onboarding-qr"><Image src={enrolment.qrCode} width={220} height={220} alt="QR code for authenticator setup" unoptimized /><p>Scan this QR code, or enter this setup key manually:</p><code>{enrolment.secret}</code></div> : null}
      {hasVerifiedFactor || enrolment.stage === "enrolment" ? <form action={verifyAction}><input type="hidden" name="nextPath" value={nextPath} /><input type="hidden" name="factorId" value={enrolment.factorId ?? ""} /><Field label="Six-digit authenticator code"><input className={inputClassName()} name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required /></Field><Button type="submit" disabled={verifyPending}>{verifyPending ? "Checking code..." : "Verify and continue"}</Button></form> : null}
      {state.message ? <p className="onboarding-auth-message" role="alert">{state.message}</p> : null}
    </div>
  );
}
