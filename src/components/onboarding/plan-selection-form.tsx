"use client";

import Link from "next/link";
import { Check, Clock3, CreditCard } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/primitives";
import { startFreeTrialAction, type OnboardingFormState } from "@/lib/onboarding/actions";
import type { z } from "zod";
import type { commercialPlanCatalogueEntrySchema } from "@/lib/onboarding/contracts";
import { OnboardingNotice } from "./onboarding-shell";

type Plan = z.infer<typeof commercialPlanCatalogueEntrySchema>;
const initialState: OnboardingFormState = { ok: false, code: "", message: "", fieldErrors: {}, values: {} };

export function PlanSelectionForm({ plans, sessionRevision, idempotencyKey }: {
  plans: Plan[];
  sessionRevision: string;
  idempotencyKey: string;
}) {
  const [state, action, pending] = useActionState(startFreeTrialAction, initialState);
  return (
    <form action={action} className="onboarding-plan-form" aria-describedby="trial-policy-summary">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="expectedSessionRevision" value={sessionRevision} />
      {state.message ? <OnboardingNotice tone="error"><strong>Nothing was saved.</strong> {state.message} {state.code === "mfa_required" ? <Link href="/mfa?next=/onboarding/plan">Continue to MFA</Link> : null}</OnboardingNotice> : null}
      {plans.length > 0 ? <fieldset className="onboarding-plan-options"><legend className="sr-only">Available commercial plans</legend>{plans.map((plan, index) => <label className="onboarding-plan-card" key={`${plan.planKey}:${plan.planVersion}`}>
        <input className="onboarding-plan-card__radio" type="radio" name="planChoice" value={`${plan.planKey}:${plan.planVersion}`} defaultChecked={state.values.planKey ? state.values.planKey === plan.planKey : index === 0} required />
        <input type="hidden" name={`planKey_${plan.planKey}`} value={plan.planKey} />
        <input type="hidden" name={`planVersion_${plan.planKey}`} value={plan.planVersion} />
        <span className="onboarding-plan-card__heading"><span><small>Commercial Preview plan</small><strong>{plan.displayName}</strong></span><span>Plan option</span></span>
        <span className="onboarding-plan-card__summary">{plan.summary}</span>
        <span className="onboarding-plan-card__price">Pricing is not yet commercially finalised</span>
        <ul>{plan.featureHighlights.map((feature) => <li key={feature}><Check aria-hidden /> {feature}</li>)}</ul>
      </label>)}</fieldset> : <OnboardingNotice tone="warning">No trial plan is currently available. Your setup is safe. Contact support or try again later.</OnboardingNotice>}
      <section className="onboarding-trial-policy" id="trial-policy-summary" aria-labelledby="trial-policy-title">
        <div><Clock3 aria-hidden /><span><strong id="trial-policy-title">60 days from Go Live</strong><small>Setup time does not use any trial days.</small></span></div>
        <div><CreditCard aria-hidden /><span><strong>No card required</strong><small>Configure your organisation before the trial begins.</small></span></div>
      </section>
      <p className="onboarding-trial-explanation">Selecting the trial creates a pending subscription only. The 60-day clock starts when you explicitly take the organisation live in a later setup step.</p>
      <div className="onboarding-form-actions onboarding-form-actions--split">
        <Button type="submit" name="intent" value="save_exit" variant="secondary" disabled={pending}>Save and exit</Button>
        <Button type="submit" name="intent" value="continue" disabled={pending || plans.length === 0}>{pending ? "Starting safely..." : "Start free trial"}</Button>
      </div>
    </form>
  );
}
