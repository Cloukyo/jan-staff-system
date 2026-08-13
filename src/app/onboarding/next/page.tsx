import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { OnboardingNotice, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function OnboardingNextPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (snapshot.steps.find((step) => step.stepKey === "first_site")?.status !== "complete") redirect("/onboarding/site");
  if (snapshot.steps.find((step) => step.stepKey === "subscription")?.status !== "complete") redirect("/onboarding/plan");
  const staffingStatus = snapshot.steps.find((step) => step.stepKey === "staffing")?.status;
  if (staffingStatus !== "complete" && staffingStatus !== "skipped") redirect("/onboarding/staffing");
  return (
    <OnboardingShell activeStep="staffing" completedSteps={["owner_security", "legal_acceptance", "organisation", "first_site", "subscription", "staffing"]}>
      <div className="onboarding-success"><CheckCircle2 aria-hidden /><span>Initial staffing saved</span><h1>{snapshot.staffing.activeStaffCount > 0 ? `${snapshot.staffing.activeStaffCount} staff ready for later setup` : "You can add staff later"}</h1><p>Your no-card trial remains pending for {snapshot.siteSummary?.displayName ?? "your first site"}. No invitations or PINs have been created and no trial days have been used.</p></div>
      <OnboardingNotice tone={staffingStatus === "skipped" ? "warning" : "success"}>{staffingStatus === "skipped" ? "Initial staffing was deliberately skipped. This does not satisfy future attendance readiness." : "Initial staffing is complete."} Manager invitations are the next phase and are not available in this milestone.</OnboardingNotice>
      {staffingStatus === "complete" ? <p>{snapshot.staffing.activeStaffCount} active staff are assigned to {snapshot.staffing.firstSiteName ?? "the first site"}. {snapshot.staffing.activeBatch?.excludedRows ?? 0} import rows were excluded. {snapshot.staffing.remainingStaffAllowance === null ? "The selected plan allowance remains authoritative." : `${snapshot.staffing.remainingStaffAllowance} active-staff places remain on the selected plan.`} Attendance still requires the later security and kiosk steps.</p> : null}
      {staffingStatus === "skipped" ? <p><Link href="/onboarding/staffing">Return to initial staffing</Link> when you are ready. Continuing setup does not mean the organisation is ready for attendance.</p> : null}
    </OnboardingShell>
  );
}
