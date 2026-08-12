import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { OnboardingNotice, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function OnboardingNextPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  return (
    <OnboardingShell activeStep="organisation" completedSteps={["owner_security", "legal_acceptance", "organisation"]}>
      <div className="onboarding-success"><CheckCircle2 aria-hidden /><span>Organisation created</span><h1>Your organisation is ready for the next step</h1><p>Your owner membership, organisation owner role and default settings were created together. No site has been created.</p></div>
      <OnboardingNotice>The next step is to add the organisation&apos;s first site. That step belongs to Workstream 7B and is not available in this milestone.</OnboardingNotice>
    </OnboardingShell>
  );
}
