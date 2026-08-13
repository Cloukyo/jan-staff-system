import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { FirstSiteForm } from "@/components/onboarding/first-site-form";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function FirstSitePage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") redirect("/mfa?next=/onboarding/site");
  const step = snapshot.steps.find((candidate) => candidate.stepKey === "first_site");
  if (step?.status === "complete") redirect("/onboarding/plan");
  return (
    <OnboardingShell activeStep="first_site" completedSteps={["owner_security", "legal_acceptance", "organisation"]}>
      <div className="onboarding-page-heading"><span>First site</span><h1>Add your first operating site</h1><p>Set the premises details and normal operating pattern. This creates one site and gives the organisation owner access.</p></div>
      <FirstSiteForm sessionRevision={snapshot.session.revision} idempotencyKey={randomUUID()} draft={step?.draftPayload ?? {}} />
    </OnboardingShell>
  );
}
