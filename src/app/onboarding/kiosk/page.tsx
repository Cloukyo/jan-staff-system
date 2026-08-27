import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { KioskSetup } from "@/components/onboarding/kiosk-setup";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { emptyKioskSnapshot } from "@/lib/onboarding/kiosk-contracts";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";
export default async function KioskOnboardingPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") redirect("/mfa?next=/onboarding/kiosk");
  const staffAccounts = snapshot.steps.find((step) => step.stepKey === "staff_invitations")?.status;
  if (staffAccounts !== "complete" && staffAccounts !== "skipped") redirect("/onboarding/staff-invitations");
  return <OnboardingShell activeStep="kiosk" completedSteps={["owner_security","legal_acceptance","organisation","first_site","subscription","staffing","manager_invitations","staff_invitations"]}><div className="onboarding-page-heading"><span>Clocking device</span><h1>Connect your online staff clock</h1><p>Register one browser to your location, check its connection and prepare at least one staff PIN.</p></div><KioskSetup snapshot={snapshot.kiosk ?? emptyKioskSnapshot} revision={snapshot.session.revision} keys={Array.from({ length: (snapshot.kiosk?.staff.length ?? 0) + 4 }, () => randomUUID())}/></OnboardingShell>;
}
