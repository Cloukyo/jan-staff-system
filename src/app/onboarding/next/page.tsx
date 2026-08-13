import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { OnboardingNotice, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function OnboardingNextPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (snapshot.steps.find((step) => step.stepKey === "first_site")?.status !== "complete") redirect("/onboarding/site");
  return (
    <OnboardingShell activeStep="first_site" completedSteps={["owner_security", "legal_acceptance", "organisation", "first_site"]}>
      <div className="onboarding-success"><CheckCircle2 aria-hidden /><span>First site created</span><h1>{snapshot.siteSummary?.displayName ?? "Your first site"} is ready</h1><p>The site, inherited defaults and owner access were created together for {snapshot.siteSummary?.timezone ?? "the organisation time zone"}. Your saved setup will be here when the next onboarding phase becomes available.</p></div>
      <OnboardingNotice tone="success">Site setup is complete. Subscription selection is the next phase and is not available in this milestone.</OnboardingNotice>
    </OnboardingShell>
  );
}
