import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { OnboardingNotice, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function OnboardingNextPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (snapshot.steps.find((step) => step.stepKey === "first_site")?.status !== "complete") redirect("/onboarding/site");
  if (snapshot.steps.find((step) => step.stepKey === "subscription")?.status !== "complete") redirect("/onboarding/plan");
  return (
    <OnboardingShell activeStep="subscription" completedSteps={["owner_security", "legal_acceptance", "organisation", "first_site", "subscription"]}>
      <div className="onboarding-success"><CheckCircle2 aria-hidden /><span>Trial pending</span><h1>{snapshot.subscriptionSummary?.planDisplayName ?? "Your selected plan"} is reserved</h1><p>Your no-card trial is ready for {snapshot.siteSummary?.displayName ?? "your first site"}. No trial days have been used. The 60-day clock starts only when you Go Live later.</p></div>
      <OnboardingNotice tone="success">Plan selection is complete. Adding staff is the next phase and is not available in this milestone.</OnboardingNotice>
    </OnboardingShell>
  );
}
