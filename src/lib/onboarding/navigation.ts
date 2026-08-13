import type { OnboardingBootstrapSnapshot } from "./contracts";

export type OnboardingRoute = "/onboarding" | "/onboarding/legal" | "/onboarding/organisation" | "/onboarding/site" | "/onboarding/plan" | "/onboarding/staffing" | "/onboarding/next";

export function authoritativeOnboardingRoute(snapshot: OnboardingBootstrapSnapshot): OnboardingRoute {
  if (snapshot.session.organisationId) {
    if (snapshot.steps.find((step) => step.stepKey === "first_site")?.status !== "complete") return "/onboarding/site";
    if (snapshot.steps.find((step) => step.stepKey === "subscription")?.status !== "complete") return "/onboarding/plan";
    const staffing = snapshot.steps.find((step) => step.stepKey === "staffing")?.status;
    return staffing === "complete" || staffing === "skipped" ? "/onboarding/next" : "/onboarding/staffing";
  }
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") return "/onboarding";
  if (!snapshot.security.legalAcceptancesCurrent) return "/onboarding/legal";
  return "/onboarding/organisation";
}
