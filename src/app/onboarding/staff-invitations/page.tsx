import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { StaffInvitations } from "@/components/onboarding/staff-invitations";
import {
  OnboardingNotice,
  OnboardingShell,
} from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";
export default async function StaffInvitationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [snapshot, params] = await Promise.all([
    loadOnboardingBootstrapServer(),
    searchParams,
  ]);
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (
    !snapshot.security.emailVerified ||
    snapshot.security.assuranceLevel !== "aal2"
  )
    redirect("/mfa?next=/onboarding/staff-invitations");
  const managers = snapshot.steps.find(
    (s) => s.stepKey === "manager_invitations",
  )?.status;
  if (managers !== "complete" && managers !== "skipped")
    redirect("/onboarding/managers");
  const current = snapshot.steps.find(
    (s) => s.stepKey === "staff_invitations",
  )?.status;
  if (current === "complete" || current === "skipped")
    redirect("/onboarding/next");
  return (
    <OnboardingShell
      activeStep="staff_invitations"
      completedSteps={[
        "owner_security",
        "legal_acceptance",
        "organisation",
        "first_site",
        "subscription",
        "staffing",
        "manager_invitations",
      ]}
    >
      <div className="onboarding-page-heading">
        <span>Staff accounts</span>
        <h1>Choose who needs a login account</h1>
        <p>
          Staff profiles already exist. Invitations only link a secure login to
          the selected profile, and PIN-only attendance can continue without
          one.
        </p>
      </div>
      {typeof params.error === "string" ? (
        <OnboardingNotice tone="error">
          Nothing was saved. Reload this step and try again.
        </OnboardingNotice>
      ) : null}
      <StaffInvitations
        snapshot={snapshot.staffInvitations}
        revision={snapshot.session.revision}
        keys={Array.from(
          { length: snapshot.staffInvitations.staff.length * 2 + 4 },
          () => randomUUID(),
        )}
      />
    </OnboardingShell>
  );
}
