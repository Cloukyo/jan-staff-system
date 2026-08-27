"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, Field, inputClassName } from "@/components/ui/primitives";
import { createOrganisationAction, type OnboardingFormState } from "@/lib/onboarding/actions";
import { OnboardingNotice } from "./onboarding-shell";

const initialOnboardingFormState: OnboardingFormState = { ok: false, code: "", message: "", fieldErrors: {}, values: {} };

export function OrganisationForm({ sessionRevision, contactEmail, idempotencyKey }: { sessionRevision: string; contactEmail: string; idempotencyKey: string }) {
  const [state, action, pending] = useActionState(createOrganisationAction, initialOnboardingFormState);
  const value = (key: string, fallback = "") => state.values[key] ?? fallback;
  const error = (key: string) => state.fieldErrors[key] ?? state.fieldErrors[`postalAddress.${key}`];
  return (
    <form action={action} className="onboarding-organisation-form" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedSessionRevision" value={sessionRevision} />
      {state.message ? <OnboardingNotice tone="error"><strong>{state.code === "mfa_required" ? "Security check required." : "Nothing was saved."}</strong> {state.message} {state.code === "mfa_required" ? <Link href="/mfa?next=/onboarding/organisation">Continue to MFA</Link> : null}</OnboardingNotice> : null}
      <div className="onboarding-form-section">
        <div><h2>Organisation details</h2><p>Use the registered details for the organisation that will own this account.</p></div>
        <div className="onboarding-field-grid">
          <Field label="Organisation name" error={error("displayName")}><input className={inputClassName()} name="displayName" defaultValue={value("displayName")} autoComplete="organization" required aria-invalid={Boolean(error("displayName"))} /></Field>
          <Field label="Legal name" error={error("legalName")}><input className={inputClassName()} name="legalName" defaultValue={value("legalName")} required aria-invalid={Boolean(error("legalName"))} /></Field>
        </div>
      </div>
      <div className="onboarding-form-section">
        <div><h2>Contact details</h2><p>We will use these details for important account and service messages.</p></div>
        <div className="onboarding-field-grid onboarding-field-grid--two">
          <Field label="Contact email" error={error("contactEmail")}><input className={inputClassName()} name="contactEmail" type="email" defaultValue={value("contactEmail", contactEmail)} autoComplete="email" required aria-invalid={Boolean(error("contactEmail"))} /></Field>
          <Field label="Phone (optional)" error={error("phone")}><input className={inputClassName()} name="phone" type="tel" defaultValue={value("phone")} autoComplete="tel" /></Field>
          <Field label="Country" error={error("country")}><select className={inputClassName()} name="country" defaultValue={value("country", "GB")}><option value="GB">United Kingdom</option><option value="IE">Ireland</option></select></Field>
          <Field label="Time zone" error={error("timezone")}><select className={inputClassName()} name="timezone" defaultValue={value("timezone", "Europe/London")}><option value="Europe/London">Europe/London</option><option value="Europe/Dublin">Europe/Dublin</option></select></Field>
        </div>
      </div>
      <div className="onboarding-form-section">
        <div><h2>Postal address</h2><p>Enter the organisation&apos;s primary correspondence address.</p></div>
        <div className="onboarding-field-grid onboarding-field-grid--two">
          <div className="onboarding-field-span"><Field label="Address line 1" error={error("line1")}><input className={inputClassName()} name="line1" defaultValue={value("line1")} autoComplete="address-line1" required /></Field></div>
          <div className="onboarding-field-span"><Field label="Address line 2 (optional)" error={error("line2")}><input className={inputClassName()} name="line2" defaultValue={value("line2")} autoComplete="address-line2" /></Field></div>
          <Field label="Town or city" error={error("locality")}><input className={inputClassName()} name="locality" defaultValue={value("locality")} autoComplete="address-level2" required /></Field>
          <Field label="County or region (optional)" error={error("region")}><input className={inputClassName()} name="region" defaultValue={value("region")} autoComplete="address-level1" /></Field>
          <Field label="Postcode" error={error("postcode")}><input className={inputClassName()} name="postcode" defaultValue={value("postcode")} autoComplete="postal-code" required /></Field>
        </div>
      </div>
      <div className="onboarding-form-actions"><Button type="submit" disabled={pending}>{pending ? "Creating organisation..." : "Create organisation and continue"}</Button></div>
    </form>
  );
}
