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
  const managerStatus = snapshot.steps.find((step) => step.stepKey === "manager_invitations")?.status;
  if (managerStatus !== "complete" && managerStatus !== "skipped") redirect("/onboarding/managers");
  const activeInvitations = snapshot.managerInvitations.invitations.filter((invitation) => invitation.status === "pending" || invitation.status === "accepted");
  return (
    <OnboardingShell activeStep="manager_invitations" completedSteps={["owner_security", "legal_acceptance", "organisation", "first_site", "subscription", "staffing", "manager_invitations"]}>
      <div className="onboarding-success"><CheckCircle2 aria-hidden /><span>Manager access prepared</span><h1>{managerStatus === "skipped" ? "You remain the sole manager for now" : `${activeInvitations.length} manager invitation${activeInvitations.length === 1 ? "" : "s"} recorded`}</h1><p>Your no-card trial remains pending for {snapshot.siteSummary?.displayName ?? "your first site"}. Manager access is not created until each invited person verifies their identity, completes MFA and accepts.</p></div>
      <OnboardingNotice tone={managerStatus === "skipped" ? "warning" : "success"}>{managerStatus === "skipped" ? "You acknowledged that you will manage the organisation alone for now." : "Manager invitations are saved and their delivery and acceptance states remain visible."} Staff invitations are the next phase and are not available in this milestone.</OnboardingNotice>
      {staffingStatus === "complete" ? <p>{snapshot.staffing.activeStaffCount} active staff are assigned to {snapshot.staffing.firstSiteName ?? "the first site"}. {snapshot.staffing.activeBatch?.excludedRows ?? 0} import rows were excluded. {snapshot.staffing.remainingStaffAllowance === null ? "The selected plan allowance remains authoritative." : `${snapshot.staffing.remainingStaffAllowance} active-staff places remain on the selected plan.`} Attendance still requires the later security and kiosk steps.</p> : null}
      {staffingStatus === "skipped" ? <p><Link href="/onboarding/staffing">Return to initial staffing</Link> when you are ready. Continuing setup does not mean the organisation is ready for attendance.</p> : null}
      <p>Your plan trial is still pending, offline attendance is unavailable and no kiosk or attendance authorisation has been created.</p>
    </OnboardingShell>
  );
}
