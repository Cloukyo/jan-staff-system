"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/primitives";
import { acceptLegalDocumentsAction, type OnboardingFormState } from "@/lib/onboarding/actions";
import { OnboardingNotice } from "./onboarding-shell";

const initialOnboardingFormState: OnboardingFormState = { ok: false, code: "", message: "", fieldErrors: {}, values: {} };

export function LegalAcceptanceForm({
  sessionRevision,
  idempotencyKey,
  documents,
}: {
  sessionRevision: string;
  idempotencyKey: string;
  documents: Array<{ documentType: string; documentVersion: string; locale: string }>;
}) {
  const [state, action, pending] = useActionState(acceptLegalDocumentsAction, initialOnboardingFormState);
  return (
    <form action={action} className="onboarding-action-form">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedSessionRevision" value={sessionRevision} />
      {documents.map((document) => <input key={document.documentType} type="hidden" name="documentAcceptance" value={`${document.documentType}|${document.documentVersion}|${document.locale}`} />)}
      <label className="onboarding-consent">
        <input type="checkbox" name="accepted" value="yes" />
        <span>I confirm that I have read and accept all three documents listed above.</span>
      </label>
      {state.message ? <OnboardingNotice tone="error"><strong>Nothing was saved.</strong> {state.message}</OnboardingNotice> : null}
      <div className="onboarding-form-actions"><Button type="submit" disabled={pending}>{pending ? "Saving acceptance..." : "Accept and continue"}</Button></div>
    </form>
  );
}
