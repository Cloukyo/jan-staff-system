import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { OrganisationForm } from "@/components/onboarding/organisation-form";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function OrganisationPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (snapshot.session.organisationId) redirect("/onboarding/next");
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") redirect("/onboarding");
  if (!snapshot.security.legalAcceptancesCurrent) redirect("/onboarding/legal");
  const { data } = await (await createSupabaseServerClient()).auth.getUser();
  return (
    <OnboardingShell activeStep="organisation" completedSteps={["owner_security", "legal_acceptance"]}>
      <div className="onboarding-page-heading"><span>Organisation details</span><h1>Set up your organisation</h1><p>This creates the customer account you will own. You will add the first site in the next phase.</p></div>
      <OrganisationForm sessionRevision={snapshot.session.revision} contactEmail={data.user?.email ?? ""} idempotencyKey={randomUUID()} />
    </OnboardingShell>
  );
}
