import type { OnboardingBootstrapSnapshot } from "./contracts";

export type OnboardingRoute = "/onboarding" | "/onboarding/legal" | "/onboarding/organisation" | "/onboarding/site" | "/onboarding/plan" | "/onboarding/next";

export function authoritativeOnboardingRoute(snapshot: OnboardingBootstrapSnapshot): OnboardingRoute {
  if (snapshot.session.organisationId) {
    if (snapshot.steps.find((step) => step.stepKey === "first_site")?.status !== "complete") return "/onboarding/site";
    return snapshot.steps.find((step) => step.stepKey === "subscription")?.status === "complete"
      ? "/onboarding/next" : "/onboarding/plan";
  }
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") return "/onboarding";
  if (!snapshot.security.legalAcceptancesCurrent) return "/onboarding/legal";
  return "/onboarding/organisation";
}
