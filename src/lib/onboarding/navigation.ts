import type { OnboardingBootstrapSnapshot } from "./contracts";

export type OnboardingRoute =
  | "/onboarding"
  | "/onboarding/legal"
  | "/onboarding/organisation"
  | "/onboarding/site"
  | "/onboarding/plan"
  | "/onboarding/staffing"
  | "/onboarding/managers"
  | "/onboarding/staff-invitations"
  | "/onboarding/next";

export function authoritativeOnboardingRoute(
  snapshot: OnboardingBootstrapSnapshot,
): OnboardingRoute {
  if (snapshot.session.organisationId) {
    if (
      snapshot.steps.find((step) => step.stepKey === "first_site")?.status !==
      "complete"
    )
      return "/onboarding/site";
    if (
      snapshot.steps.find((step) => step.stepKey === "subscription")?.status !==
      "complete"
    )
      return "/onboarding/plan";
    const staffing = snapshot.steps.find(
      (step) => step.stepKey === "staffing",
    )?.status;
    if (staffing !== "complete" && staffing !== "skipped")
      return "/onboarding/staffing";
    const managers = snapshot.steps.find(
      (step) => step.stepKey === "manager_invitations",
    )?.status;
    if (managers !== "complete" && managers !== "skipped")
      return "/onboarding/managers";
    const staffInvitations = snapshot.steps.find(
      (step) => step.stepKey === "staff_invitations",
    )?.status;
    return staffInvitations === "complete" || staffInvitations === "skipped"
      ? "/onboarding/next"
      : "/onboarding/staff-invitations";
  }
  if (
    !snapshot.security.emailVerified ||
    snapshot.security.assuranceLevel !== "aal2"
  )
    return "/onboarding";
  if (!snapshot.security.legalAcceptancesCurrent) return "/onboarding/legal";
  return "/onboarding/organisation";
}
