"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, inputClassName } from "@/components/ui/primitives";
import { createFirstSiteAction, type OnboardingFormState } from "@/lib/onboarding/actions";
import { OnboardingNotice } from "./onboarding-shell";

const initialState: OnboardingFormState = { ok: false, code: "", message: "", fieldErrors: {}, values: {} };
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function FirstSiteForm({ sessionRevision, idempotencyKey, draft }: {
  sessionRevision: string;
  idempotencyKey: string;
  draft: Record<string, unknown>;
}) {
  const [state, action, pending] = useActionState(createFirstSiteAction, initialState);
  const draftAddress = (draft.postalAddress ?? {}) as Record<string, unknown>;
  const draftHours = Array.isArray(draft.openingHours) ? draft.openingHours as Array<{ intervals?: Array<{ opensAt?: string; closesAt?: string }> }> : [];
  const value = (key: string, fallback = "") => state.values[key] ?? String(draft[key] ?? fallback);
  const addressValue = (key: string) => state.values[key] ?? String(draftAddress[key] ?? "");
  const error = (key: string) => state.fieldErrors[key] ?? state.fieldErrors[`postalAddress.${key}`];

  return (
    <form action={action} className="onboarding-organisation-form onboarding-site-form" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedSessionRevision" value={sessionRevision} />
      {state.message ? <OnboardingNotice tone="error"><strong>Nothing was saved.</strong> {state.message} {state.code === "mfa_required" ? <Link href="/mfa?next=/onboarding/site">Continue to MFA</Link> : null}</OnboardingNotice> : null}

      <div className="onboarding-form-section">
        <div><h2>Site details</h2><p>Use the operational name and contact details people will recognise.</p></div>
        <div className="onboarding-field-grid onboarding-field-grid--two">
          <Field label="Site name" error={error("siteName")}><input className={inputClassName()} name="siteName" defaultValue={value("siteName")} autoComplete="organization" required /></Field>
          <Field label="Display name (optional)" error={error("displayName")}><input className={inputClassName()} name="displayName" defaultValue={value("displayName")} /></Field>
          <Field label="Contact phone" error={error("contactPhone")}><input className={inputClassName()} name="contactPhone" type="tel" defaultValue={value("contactPhone")} autoComplete="tel" required /></Field>
          <Field label="Site email (optional)" error={error("siteEmail")}><input className={inputClassName()} name="siteEmail" type="email" defaultValue={value("siteEmail")} autoComplete="email" /></Field>
        </div>
      </div>

      <div className="onboarding-form-section">
        <div><h2>Site address</h2><p>This locates the premises and supports future site-specific operations.</p></div>
        <input type="hidden" name="country" value="GB" /><input type="hidden" name="timezone" value="Europe/London" />
        <div className="onboarding-field-grid onboarding-field-grid--two">
          <div className="onboarding-field-span"><Field label="Address line 1" error={error("line1")}><input className={inputClassName()} name="line1" defaultValue={addressValue("line1")} autoComplete="address-line1" required /></Field></div>
          <div className="onboarding-field-span"><Field label="Address line 2 (optional)" error={error("line2")}><input className={inputClassName()} name="line2" defaultValue={addressValue("line2")} autoComplete="address-line2" /></Field></div>
          <Field label="Town or city" error={error("locality")}><input className={inputClassName()} name="locality" defaultValue={addressValue("locality")} autoComplete="address-level2" required /></Field>
          <Field label="County or region (optional)" error={error("region")}><input className={inputClassName()} name="region" defaultValue={addressValue("region")} autoComplete="address-level1" /></Field>
          <Field label="Postcode" error={error("postcode")}><input className={inputClassName()} name="postcode" defaultValue={addressValue("postcode")} autoComplete="postal-code" required /></Field>
          <Field label="Time zone"><select className={inputClassName()} value="Europe/London" disabled aria-describedby="site-timezone-help"><option>Europe/London</option></select><small id="site-timezone-help">Inherited from the organisation for the UK launch.</small></Field>
        </div>
      </div>

      <div className="onboarding-form-section">
        <div><h2>Regular opening hours</h2><p>Set the usual hours for each day. You can manage closures and exceptional dates later.</p></div>
        <div className="onboarding-hours" role="group" aria-label="Regular opening hours">
          {days.map((label, index) => {
            const key = label.toLowerCase();
            const saved = draftHours[index]?.intervals?.[0];
            const weekend = index > 4;
            const openError = state.fieldErrors[`openingHours.${index}.intervals.0.opensAt`];
            const closeError = state.fieldErrors[`openingHours.${index}.intervals.0.closesAt`]
              ?? state.fieldErrors[`openingHours.${index}.intervals`];
            return <div className="onboarding-hours__day" key={label}>
              <strong>{label}</strong>
              <label className="onboarding-hours__closed"><input type="checkbox" name={`${key}Closed`} value="yes" defaultChecked={state.code ? state.values[`${key}Closed`] === "yes" : (weekend && !saved)} /> Closed</label>
              <Field label="Opens" error={openError}><input className={inputClassName()} type="time" name={`${key}Open`} defaultValue={state.values[`${key}Open`] ?? saved?.opensAt ?? "08:00"} aria-invalid={Boolean(openError)} /></Field>
              <Field label="Closes" error={closeError}><input className={inputClassName()} type="time" name={`${key}Close`} defaultValue={state.values[`${key}Close`] ?? saved?.closesAt ?? "18:00"} aria-invalid={Boolean(closeError)} /></Field>
            </div>;
          })}
        </div>
      </div>

      <div className="onboarding-form-section">
        <div><h2>Operational defaults</h2><p>These defaults support consistent weekly and cross-midnight operations.</p></div>
        <div className="onboarding-field-grid onboarding-field-grid--two">
          <Field label="Work week starts"><select className={inputClassName()} name="workWeekStarts" defaultValue={value("workWeekStarts", "1")}><option value="1">Monday</option><option value="7">Sunday</option></select></Field>
          <Field label="Operational day boundary"><input className={inputClassName()} type="time" min="00:00" max="06:00" name="operationalDayBoundary" defaultValue={value("operationalDayBoundary", "04:00")} required /><small>Used to group legitimate activity shortly after midnight with the intended operational day.</small></Field>
        </div>
      </div>

      <div className="onboarding-form-actions onboarding-form-actions--split">
        <Button type="submit" name="intent" value="save_exit" variant="secondary" disabled={pending}>Save and exit</Button>
        <Button type="submit" name="intent" value="continue" disabled={pending}>{pending ? "Creating site..." : "Create site and continue"}</Button>
      </div>
    </form>
  );
}
