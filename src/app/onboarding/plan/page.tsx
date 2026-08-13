import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { PlanSelectionForm } from "@/components/onboarding/plan-selection-form";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function PlanSelectionPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") redirect("/mfa?next=/onboarding/plan");
  if (snapshot.steps.find((step) => step.stepKey === "first_site")?.status !== "complete") redirect("/onboarding/site");
  if (snapshot.steps.find((step) => step.stepKey === "subscription")?.status === "complete") redirect("/onboarding/next");
  return (
    <OnboardingShell activeStep="subscription" completedSteps={["owner_security", "legal_acceptance", "organisation", "first_site"]}>
      <div className="onboarding-page-heading"><span>Plan and trial</span><h1>Choose how you want to begin</h1><p>Start with the complete core attendance experience. Your trial remains pending while you finish setup.</p></div>
      <PlanSelectionForm plans={snapshot.planCatalogue} sessionRevision={snapshot.session.revision} idempotencyKey={randomUUID()} />
    </OnboardingShell>
  );
}
