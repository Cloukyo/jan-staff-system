const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/;
const onboardingPaths = new Set([
  "/onboarding",
  "/onboarding/organisation",
  "/onboarding/site",
  "/onboarding/plan",
  "/onboarding/staffing",
  "/onboarding/managers",
]);

export function managerInvitationPath(token: string): string | null {
  return tokenPattern.test(token)
    ? `/invitations/manager?token=${encodeURIComponent(token)}`
    : null;
}

export function safeCommercialContinuation(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (onboardingPaths.has(value)) return value;
  try {
    const url = new URL(value, "https://commercial.invalid");
    if (
      url.origin !== "https://commercial.invalid" ||
      url.pathname !== "/invitations/manager"
    )
      return null;
    if ([...url.searchParams.keys()].some((key) => key !== "token"))
      return null;
    return managerInvitationPath(url.searchParams.get("token") ?? "");
  } catch {
    return null;
  }
}
