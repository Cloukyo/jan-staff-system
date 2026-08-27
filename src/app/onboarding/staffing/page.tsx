import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { OnboardingNotice, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { InitialStaffing } from "@/components/onboarding/initial-staffing";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function StaffingPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const [snapshot, params] = await Promise.all([loadOnboardingBootstrapServer(), searchParams]);
  if (!snapshot.session.organisationId) redirect("/onboarding");
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") redirect("/mfa?next=/onboarding/staffing");
  if (snapshot.steps.find((step) => step.stepKey === "subscription")?.status !== "complete") redirect("/onboarding/plan");
  const status = snapshot.steps.find((step) => step.stepKey === "staffing")?.status;
  const staffingDraft = snapshot.steps.find((step) => step.stepKey === "staffing")?.draftPayload ?? {};
  if (status === "complete") redirect("/onboarding/next");
  return (
    <OnboardingShell activeStep="staffing" completedSteps={["owner_security","legal_acceptance","organisation","first_site","subscription"]}>
      <div className="onboarding-page-heading"><span>Initial staffing</span><h1>Add the people who will use attendance</h1><p>Add one person now or review a CSV before importing. Accounts, invitations, PINs and attendance history are not created at this step.</p></div>
      {typeof params.error === "string" ? <OnboardingNotice tone="error">Nothing was saved. The staffing review changed or could not be confirmed ({params.error.replaceAll("_"," ")}). Reload and try again.</OnboardingNotice> : null}
      <InitialStaffing snapshot={snapshot.staffing} draft={staffingDraft} sessionRevision={snapshot.session.revision} idempotencyKeys={Array.from({ length: 4 }, () => randomUUID())} />
    </OnboardingShell>
  );
}
