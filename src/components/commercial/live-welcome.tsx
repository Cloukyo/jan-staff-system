import Link from "next/link";
import { CheckCircle2, Clock3, MapPin, MonitorCheck, Users } from "lucide-react";
import type { CommercialLiveSummary } from "@/lib/onboarding/readiness-contracts";

const ukDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

export function LiveWelcome({ summary }: { summary: CommercialLiveSummary }) {
  return <main className="live-welcome">
    <header><span><CheckCircle2 aria-hidden /> Organisation live</span><h1>{summary.organisationName} is ready</h1><p>Online attendance is available now. Your free trial ends on <strong>{ukDate.format(new Date(summary.trialEndsAt))}</strong>.</p></header>
    <section className="live-summary" aria-label="Live setup summary">
      <div><MapPin aria-hidden /><span><strong>{summary.siteName}</strong><small>First site</small></span></div>
      <div><MonitorCheck aria-hidden /><span><strong>{summary.kioskConnected ? "Connected" : "Needs attention"}</strong><small>Clocking device</small></span></div>
      <div><Users aria-hidden /><span><strong>{summary.staffCount}</strong><small>Active staff</small></span></div>
      <div><Clock3 aria-hidden /><span><strong>Online only</strong><small>Offline disabled</small></span></div>
    </section>
    <section className="live-next-actions"><h2>Recommended next actions</h2><div><Link href="/clock">Open Staff Clock</Link><Link href="/attendance">Review attendance</Link><Link href="/staff">Invite more staff</Link></div><p>You can also create a rota, add compliance records or contact support when you need help.</p></section>
  </main>;
}
