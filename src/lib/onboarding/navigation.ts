import type { OnboardingBootstrapSnapshot } from "./contracts";

export type OnboardingRoute = "/onboarding" | "/onboarding/legal" | "/onboarding/organisation" | "/onboarding/next";

export function authoritativeOnboardingRoute(snapshot: OnboardingBootstrapSnapshot): OnboardingRoute {
  if (snapshot.session.organisationId) return "/onboarding/next";
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") return "/onboarding";
  if (!snapshot.security.legalAcceptancesCurrent) return "/onboarding/legal";
  return "/onboarding/organisation";
}
