import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { ReadinessReview } from "@/components/onboarding/readiness-review";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (snapshot.session.status === "live") redirect("/commercial/welcome");
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") redirect("/mfa?next=/onboarding/readiness");
  if (snapshot.steps.find((step) => step.stepKey === "kiosk")?.status !== "complete") redirect("/onboarding/kiosk");
  if (!snapshot.readiness) throw new Error("Authoritative readiness is unavailable.");
  return <OnboardingShell activeStep="readiness" completedSteps={["owner_security","legal_acceptance","organisation","first_site","subscription","staffing","manager_invitations","staff_invitations","kiosk"]}>
    <div className="onboarding-page-heading"><span>Final review</span><h1>Ready to start live attendance?</h1><p>These checks come directly from your current organisation, staff and clocking device setup.</p></div>
    <ReadinessReview readiness={snapshot.readiness} revision={snapshot.session.revision} refreshKey={randomUUID()} goLiveKey={randomUUID()}/>
  </OnboardingShell>;
}
