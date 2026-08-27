import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, MailCheck, ShieldCheck, Scale } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { OnboardingNotice, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { resendVerificationAction } from "@/lib/onboarding/actions";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";
import { authoritativeOnboardingRoute } from "@/lib/onboarding/navigation";

export const dynamic = "force-dynamic";

export default async function OnboardingReadinessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [snapshot, params] = await Promise.all([loadOnboardingBootstrapServer(), searchParams]);
  const route = authoritativeOnboardingRoute(snapshot);
  if (route !== "/onboarding") redirect(route);
  return (
    <OnboardingShell activeStep="owner_security" completedSteps={[]}>
      <div className="onboarding-page-heading"><span>Commercial setup</span><h1>Account readiness</h1><p>Secure your owner account before creating an organisation.</p></div>
      {params.verification === "sent" ? <OnboardingNotice tone="success">If the address is eligible, a new verification email has been sent.</OnboardingNotice> : null}
      <div className="onboarding-readiness-list">
        <article data-ready={snapshot.security.emailVerified}><MailCheck aria-hidden /><div><h2>Email verification</h2><p>{snapshot.security.emailVerified ? "Your email address is verified." : "Verify your email address using the link we sent you."}</p></div>{snapshot.security.emailVerified ? <CheckCircle2 aria-label="Complete" /> : null}</article>
        <article data-ready={snapshot.security.assuranceLevel === "aal2"}><ShieldCheck aria-hidden /><div><h2>Multi-factor authentication</h2><p>{snapshot.security.assuranceLevel === "aal2" ? "This session has completed the additional security check." : "Set up or confirm an authenticator code to protect owner actions."}</p></div>{snapshot.security.assuranceLevel === "aal2" ? <CheckCircle2 aria-label="Complete" /> : null}</article>
        <article data-ready={false}><Scale aria-hidden /><div><h2>Legal documents</h2><p>Available after your email and multi-factor checks are complete.</p></div></article>
      </div>
      <div className="onboarding-primary-action">
        {!snapshot.security.emailVerified ? <form action={resendVerificationAction}><Button type="submit">Resend verification email</Button></form> : null}
        {snapshot.security.emailVerified && snapshot.security.assuranceLevel !== "aal2" ? <Link className="onboarding-button-link" href="/mfa?next=/onboarding">Continue to MFA</Link> : null}
      </div>
    </OnboardingShell>
  );
}
