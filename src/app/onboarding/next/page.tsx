import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import {
  OnboardingNotice,
  OnboardingShell,
} from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function OnboardingNextPage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (
    snapshot.steps.find((step) => step.stepKey === "first_site")?.status !==
    "complete"
  )
    redirect("/onboarding/site");
  if (
    snapshot.steps.find((step) => step.stepKey === "subscription")?.status !==
    "complete"
  )
    redirect("/onboarding/plan");
  const staffingStatus = snapshot.steps.find(
    (step) => step.stepKey === "staffing",
  )?.status;
  if (staffingStatus !== "complete" && staffingStatus !== "skipped")
    redirect("/onboarding/staffing");
  const managerStatus = snapshot.steps.find(
    (step) => step.stepKey === "manager_invitations",
  )?.status;
  if (managerStatus !== "complete" && managerStatus !== "skipped")
    redirect("/onboarding/managers");
  const staffInvitationStatus = snapshot.steps.find(
    (step) => step.stepKey === "staff_invitations",
  )?.status;
  if (
    staffInvitationStatus !== "complete" &&
    staffInvitationStatus !== "skipped"
  )
    redirect("/onboarding/staff-invitations");
  if (snapshot.steps.find((step) => step.stepKey === "kiosk")?.status !== "complete") redirect("/onboarding/kiosk");
  const activeInvitations = snapshot.managerInvitations.invitations.filter(
    (invitation) =>
      invitation.status === "pending" || invitation.status === "accepted",
  );
  const linkedStaff = snapshot.staffInvitations.staff.filter(
    (staff) => staff.accountState === "account_linked",
  ).length;
  const pendingStaff = snapshot.staffInvitations.staff.filter(
    (staff) => staff.accountState === "invitation_pending",
  ).length;
  return (
    <OnboardingShell
      activeStep="kiosk"
      completedSteps={[
        "owner_security",
        "legal_acceptance",
        "organisation",
        "first_site",
        "subscription",
        "staffing",
        "manager_invitations",
        "staff_invitations",
      ]}
    >
      <div className="onboarding-success">
        <CheckCircle2 aria-hidden />
        <span>Account access prepared</span>
        <h1>
          {staffInvitationStatus === "skipped"
            ? "Staff can be invited later"
            : `${linkedStaff} linked, ${pendingStaff} invitation${pendingStaff === 1 ? "" : "s"} pending`}
        </h1>
        <p>
          Your no-card trial remains pending for{" "}
          {snapshot.siteSummary?.displayName ?? "your first site"}. Staff
          without login accounts can still remain eligible for the later
          PIN-only attendance setup.
        </p>
      </div>
      <OnboardingNotice
        tone={staffInvitationStatus === "skipped" ? "warning" : "success"}
      >
        {staffInvitationStatus === "skipped"
          ? "No staff login accounts were created. You can return to invitations later."
          : "Staff invitations are saved. Account access starts only after each intended staff member signs in with the matching email and accepts."}
      </OnboardingNotice>
      <p>
        {activeInvitations.length} manager invitation
        {activeInvitations.length === 1 ? " is" : "s are"} recorded. Manager
        access remains separate from ordinary staff access.
      </p>
      {staffingStatus === "complete" ? (
        <p>
          {snapshot.staffing.activeStaffCount} active staff are assigned to{" "}
          {snapshot.staffing.firstSiteName ?? "the first site"}.{" "}
          {snapshot.staffing.activeBatch?.excludedRows ?? 0} import rows were
          excluded.{" "}
          {snapshot.staffing.remainingStaffAllowance === null
            ? "The selected plan allowance remains authoritative."
            : `${snapshot.staffing.remainingStaffAllowance} active-staff places remain on the selected plan.`}{" "}
          Attendance still requires the later security and kiosk steps.
        </p>
      ) : null}
      {staffingStatus === "skipped" ? (
        <p>
          <Link href="/onboarding/staffing">Return to initial staffing</Link>{" "}
          when you are ready. Continuing setup does not mean the organisation is
          ready for attendance.
        </p>
      ) : null}
      <p>
        Your plan trial is still pending, offline attendance is unavailable and
        no kiosk or attendance authorisation has been created.
      </p>
    </OnboardingShell>
  );
}
