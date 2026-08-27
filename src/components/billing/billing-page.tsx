import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button, Panel, StatusPill } from "@/components/ui/primitives";
import { changeBillingPlan, openBillingPortal, requestSubscriptionCancellation, resumeSubscription, startBillingCheckout } from "@/lib/billing/actions";
import { loadBillingServer } from "@/lib/billing/server";
import type { BillingSnapshot } from "@/lib/billing/contracts";

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(new Date(value)) : "Not scheduled";
}

const accessCopy = {
  setup: { label: "Setup", body: "Choose a plan before using live commercial operations.", tone: "amber" as const },
  full: { label: "Full access", body: "Your current trial or paid plan is fully operational.", tone: "green" as const },
  grace: { label: "Payment grace", body: "Existing operations continue, but growth is paused while payment is recovered.", tone: "amber" as const },
  restricted: { label: "Restricted", body: "Attendance continuity and your records remain available. Recover payment to restore growth and premium capabilities.", tone: "red" as const },
};

export function BillingScreen({ snapshot, permissions }: { snapshot: BillingSnapshot; permissions: readonly string[] }) {
  const posture = accessCopy[snapshot.accessMode];
  const needsCheckout = !snapshot.providerSubscriptionReady && snapshot.state !== "trial_pending";
  return <AppShell commercialPermissions={permissions}>
    <div className="billing-page">
      <header className="billing-heading">
        <span>Plan and billing</span>
        <h1>Manage your subscription</h1>
        <p>Review your plan, use Stripe&apos;s secure hosted payment pages, and recover service without losing operational records.</p>
      </header>

      <section className={`billing-posture billing-posture--${snapshot.accessMode}`} aria-labelledby="billing-status-title">
        {snapshot.accessMode === "full" ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}
        <div><StatusPill tone={posture.tone}>{posture.label}</StatusPill><h2 id="billing-status-title">{snapshot.plan.displayName}</h2><p>{posture.body}</p></div>
        {snapshot.graceEndsAt ? <dl><dt>Action needed by</dt><dd>{date(snapshot.graceEndsAt)}</dd></dl> : null}
      </section>

      <div className="billing-grid">
        <Panel className="billing-plan-card">
          <div className="billing-card-icon"><CreditCard aria-hidden /></div>
          <div><span>Current plan</span><h2>{snapshot.plan.displayName}</h2><p>Plan version {snapshot.plan.version}. Your organisation and data ownership never depend on payment state.</p></div>
          <dl>
            <div><dt>Subscription status</dt><dd>{snapshot.state.replaceAll("_", " ")}</dd></div>
            <div><dt>Trial ends</dt><dd>{date(snapshot.trialEndsAt)}</dd></div>
            <div><dt>Paid through</dt><dd>{date(snapshot.currentPeriodEndsAt)}</dd></div>
          </dl>
          {snapshot.overLimit ? <p className="billing-warning"><AlertTriangle aria-hidden />Your existing footprint is above the selected plan limit. Nothing will be deleted, but further growth is paused.</p> : null}
        </Panel>

        <Panel className="billing-actions-card">
          <div><span>Secure billing</span><h2>Payment and invoices</h2><p>Payment details and full invoice history stay in Stripe&apos;s hosted pages. This application never handles raw card data.</p></div>
          <div className="billing-actions">
            {needsCheckout ? <form action={startBillingCheckout}>
              <input type="hidden" name="planKey" value={snapshot.plan.key}/><input type="hidden" name="planVersion" value={snapshot.plan.version}/><input type="hidden" name="idempotencyKey" value={crypto.randomUUID()}/>
              <Button type="submit"><CreditCard aria-hidden />Set up payment</Button>
            </form> : null}
            {snapshot.providerCustomerReady ? <form action={openBillingPortal}><Button type="submit" variant="secondary">{snapshot.providerSubscriptionReady && snapshot.accessMode !== "full" ? "Recover payment" : "Open billing portal"} <ExternalLink aria-hidden /></Button></form> : null}
          </div>
          <div className="billing-trust"><ShieldCheck aria-hidden /><p><strong>Protected action</strong><span>Multi-factor authentication and billing authority are checked again before Stripe opens.</span></p></div>
        </Panel>
      </div>

      {snapshot.availablePlans.length > 1 ? <Panel className="billing-plan-options">
        <div><h2>Available plans</h2><p>Choose a published plan version. A downgrade never deletes sites, staff, devices or evidence; it pauses further growth if the existing footprint is above the new limit.</p></div>
        <div>{snapshot.availablePlans.map((plan) => <article key={`${plan.key}-${plan.version}`} data-current={plan.key === snapshot.plan.key && plan.version === snapshot.plan.version}>
          <div><strong>{plan.displayName}</strong><p>{plan.summary}</p></div>
          {plan.key === snapshot.plan.key && plan.version === snapshot.plan.version ? <StatusPill tone="purple">Current</StatusPill>
            : <form action={snapshot.providerSubscriptionReady ? changeBillingPlan : startBillingCheckout}>
              <input type="hidden" name="planKey" value={plan.key}/><input type="hidden" name="planVersion" value={plan.version}/><input type="hidden" name="idempotencyKey" value={crypto.randomUUID()}/>
              <Button type="submit" variant="secondary">{snapshot.providerSubscriptionReady ? "Change plan" : "Choose plan"}</Button>
            </form>}
        </article>)}</div>
      </Panel> : null}

      <Panel className="billing-cancellation">
        <div><h2>Subscription changes</h2><p>Cancellation takes effect at the paid-through date. Your data, attendance evidence, exports, and billing recovery remain available.</p></div>
        {snapshot.cancelAtPeriodEnd
          ? <form action={resumeSubscription}><input type="hidden" name="idempotencyKey" value={crypto.randomUUID()}/><Button type="submit" variant="secondary">Resume subscription</Button></form>
          : snapshot.providerSubscriptionReady ? <form action={requestSubscriptionCancellation}><input type="hidden" name="idempotencyKey" value={crypto.randomUUID()}/><Button type="submit" variant="ghost">Cancel at period end</Button></form> : null}
      </Panel>
    </div>
  </AppShell>;
}

export async function BillingPage() {
  const { context, snapshot } = await loadBillingServer();
  return <BillingScreen snapshot={snapshot} permissions={context.permissions}/>;
}
