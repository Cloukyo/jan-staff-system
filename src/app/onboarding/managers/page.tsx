import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ManagerInvitations } from "@/components/onboarding/manager-invitations";
import {
  OnboardingNotice,
  OnboardingShell,
} from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";
export const dynamic = "force-dynamic";
export default async function ManagersPage({
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
    redirect("/mfa?next=/onboarding/managers");
  const staffing = snapshot.steps.find(
    (step) => step.stepKey === "staffing",
  )?.status;
  if (staffing !== "complete" && staffing !== "skipped")
    redirect("/onboarding/staffing");
  const status = snapshot.steps.find(
    (step) => step.stepKey === "manager_invitations",
  )?.status;
  if (status === "complete" || status === "skipped")
    redirect("/onboarding/staff-invitations");
  return (
    <OnboardingShell
      activeStep="manager_invitations"
      completedSteps={[
        "owner_security",
        "legal_acceptance",
        "organisation",
        "first_site",
        "subscription",
        "staffing",
      ]}
    >
      <div className="onboarding-page-heading">
        <span>Manager access</span>
        <h1>Invite the people who will help manage operations</h1>
        <p>
          Choose a clear role and, where needed, the sites each manager may
          access. Every grant is checked again when they accept.
        </p>
      </div>
      {typeof params.error === "string" ? (
        <OnboardingNotice tone="error">
          Nothing was saved. Reload this step and try again.
        </OnboardingNotice>
      ) : null}
      <ManagerInvitations
        snapshot={snapshot.managerInvitations}
        revision={snapshot.session.revision}
        keys={Array.from(
          { length: snapshot.managerInvitations.invitations.length * 2 + 4 },
          () => randomUUID(),
        )}
      />
    </OnboardingShell>
  );
}
