"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw, Rocket, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { goLiveAction, refreshReadinessAction, type ReadinessActionState } from "@/lib/onboarding/readiness-actions";
import type { CommercialReadinessSnapshot } from "@/lib/onboarding/readiness-contracts";

const initial: ReadinessActionState = { ok: false, code: "idle", message: "" };
const categoryLabels: Record<string, string> = {
  account: "Account", organisation: "Organisation", site: "Site", plan: "Plan", staff: "Staff",
  managers: "Managers", staff_accounts: "Staff accounts", clocking_device: "Clocking device", attendance: "Attendance",
};

export function ReadinessReview({ readiness, revision, refreshKey, goLiveKey }: { readiness: CommercialReadinessSnapshot; revision: string; refreshKey: string; goLiveKey: string }) {
  const [refreshState, refreshAction, refreshPending] = useActionState(refreshReadinessAction, initial);
  const [goLiveState, liveAction, livePending] = useActionState(goLiveAction, initial);
  const [soleManagerAcknowledged, setSoleManagerAcknowledged] = useState(false);
  const categories = [...new Set(readiness.items.map((item) => item.category))];
  const soleManagerWarning = readiness.items.some((item) => item.key === "manager_coverage" && item.status === "warning");
  const ready = readiness.overallStatus === "ready" && readiness.blockerCount === 0;
  return <div className="readiness-review">
    <section className={`readiness-overview readiness-overview--${ready ? "ready" : "blocked"}`} aria-labelledby="readiness-summary">
      <div>{ready ? <ShieldCheck aria-hidden /> : <AlertCircle aria-hidden />}</div>
      <div><span>{readiness.progressPercent}% setup complete</span><h2 id="readiness-summary">{ready ? "Ready for your final confirmation" : `${readiness.blockerCount} setup item${readiness.blockerCount === 1 ? "" : "s"} need attention`}</h2><p>{ready ? "Your live setup has passed the current safety checks." : "Follow the links below, then refresh this review."}</p></div>
      <form action={refreshAction}><input type="hidden" name="expectedSessionRevision" value={revision}/><input type="hidden" name="idempotencyKey" value={refreshKey}/><Button variant="secondary" disabled={refreshPending}><RefreshCw aria-hidden />{refreshPending ? "Checking..." : "Check again"}</Button></form>
    </section>
    {refreshState.message ? <p className={`readiness-action-message readiness-action-message--${refreshState.ok ? "success" : "error"}`} role="status">{refreshState.message}</p> : null}
    <div className="readiness-categories">
      {categories.map((category) => <section key={category} className="readiness-category" aria-labelledby={`category-${category}`}>
        <header><h2 id={`category-${category}`}>{categoryLabels[category]}</h2></header>
        <ul>{readiness.items.filter((item) => item.category === category).map((item) => {
          const status = item.status === "ready" || item.status === "not_applicable" ? "ready" : item.status === "warning" ? "warning" : "blocked";
          return <li key={item.key} data-status={status}>
            <span className="readiness-status-icon">{status === "ready" ? <CheckCircle2 aria-hidden /> : status === "warning" ? <AlertTriangle aria-hidden /> : <AlertCircle aria-hidden />}</span>
            <div><div className="readiness-item-title"><strong>{item.title}</strong><span>{status === "ready" ? (item.status === "not_applicable" ? "Optional" : "Ready") : status === "warning" ? "Warning" : "Needs attention"}</span></div><p>{item.explanation}</p></div>
            {item.remediationRoute && status !== "ready" ? <Link href={item.remediationRoute}>Review</Link> : null}
          </li>;
        })}</ul>
      </section>)}
    </div>
    <section className="go-live-panel" aria-labelledby="go-live-title">
      <div className="go-live-panel__heading"><Rocket aria-hidden /><div><span>Final confirmation</span><h2 id="go-live-title">Start live attendance</h2><p>Your 60-day free trial begins at the moment you confirm. No payment card is required.</p></div></div>
      <ul><li>Online clock-in and clock-out become available on the registered device.</li><li>The trial runs for exactly 60 consecutive days.</li><li>Offline attendance remains unavailable.</li></ul>
      <form action={liveAction}>
        <input type="hidden" name="expectedSessionRevision" value={revision}/><input type="hidden" name="idempotencyKey" value={goLiveKey}/><input type="hidden" name="readinessFingerprint" value={readiness.fingerprint}/>
        {soleManagerWarning ? <label className="go-live-acknowledgement"><input type="checkbox" name="soleManagerAcknowledged" value="yes" required checked={soleManagerAcknowledged} onChange={(event) => setSoleManagerAcknowledged(event.target.checked)}/><span><strong>I understand that I am currently the sole manager.</strong><small>I can invite another manager after Go Live.</small></span></label> : <input type="hidden" name="soleManagerAcknowledged" value="yes"/>}
        {goLiveState.message ? <p className="readiness-action-message readiness-action-message--error" role="alert">{goLiveState.message}</p> : null}
        <Button disabled={!ready || livePending || (soleManagerWarning && !soleManagerAcknowledged)}>{livePending ? "Starting safely..." : "Start live attendance"}</Button>
      </form>
    </section>
  </div>;
}
