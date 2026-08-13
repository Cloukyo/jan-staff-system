import type { OnboardingBootstrapSnapshot } from "./contracts";

export type OnboardingRoute = "/onboarding" | "/onboarding/legal" | "/onboarding/organisation" | "/onboarding/site" | "/onboarding/next";

export function authoritativeOnboardingRoute(snapshot: OnboardingBootstrapSnapshot): OnboardingRoute {
  if (snapshot.session.organisationId) {
    return snapshot.steps.find((step) => step.stepKey === "first_site")?.status === "complete"
      ? "/onboarding/next"
      : "/onboarding/site";
  }
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") return "/onboarding";
  if (!snapshot.security.legalAcceptancesCurrent) return "/onboarding/legal";
  return "/onboarding/organisation";
}
