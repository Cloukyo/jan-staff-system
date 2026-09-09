import { safeCommercialContinuation as safeInvitationContinuation } from "@/lib/invitations/continuation";
import { safeCommercialContinuation } from "@/lib/commercial-identity/preference";
import { resolveOrganisationSelection, sitePreference, siteSelectionUrl } from "@/lib/commercial-identity/site-navigation";
import type { CommercialIdentitySnapshot } from "@/types/tenancy";

export type LegacyPostAuthAccount = {
  active: boolean;
  mustChangePassword: boolean;
  role: "manager" | "staff";
};

export type PostAuthDestinationInput = {
  identity: CommercialIdentitySnapshot;
  legacyAccount: LegacyPostAuthAccount | null;
  onboardingDestination: string | null;
  requestedContinuation?: string | null;
};

export type PostAuthDestination = {
  destination: string;
  commercialPreference?: ReturnType<typeof sitePreference>;
  clearCommercialPreference?: boolean;
  signOut?: boolean;
};

const staffContinuations = ["/my-rota", "/my-attendance", "/leave/request", "/profile"];
const onboardingContinuations = new Set([
  "/onboarding",
  "/onboarding/legal",
  "/onboarding/organisation",
  "/onboarding/site",
  "/onboarding/plan",
  "/onboarding/staffing",
  "/onboarding/managers",
  "/onboarding/staff-invitations",
  "/onboarding/kiosk",
  "/onboarding/readiness",
  "/onboarding/next",
]);

function invitationContinuation(candidate: string | null | undefined): string | null {
  const continuation = safeInvitationContinuation(candidate);
  return continuation?.startsWith("/invitations/") ? continuation : null;
}

export function safePostAuthContinuation(candidate: string | null | undefined): string {
  const invitation = invitationContinuation(candidate);
  if (invitation) return invitation;
  if (candidate && onboardingContinuations.has(candidate)) return candidate;
  return safeCommercialContinuation(candidate);
}

function staffContinuation(candidate: string | null | undefined): string {
  const continuation = safeCommercialContinuation(candidate);
  return staffContinuations.some((path) => continuation === path || continuation.startsWith(`${path}?`))
    ? continuation
    : "/my-rota";
}

export function resolvePostAuthDestination(input: PostAuthDestinationInput): PostAuthDestination {
  const requestedInvitation = invitationContinuation(input.requestedContinuation);
  if (requestedInvitation) return { destination: requestedInvitation, clearCommercialPreference: true };

  if (input.identity.memberships.length > 0) {
    const activeMemberships = input.identity.memberships.filter((membership) => membership.active);
    const privileged = activeMemberships.some((membership) =>
      membership.roles.some((assignment) => assignment.role !== "staff"),
    );
    const continuation = activeMemberships.length > 0 && !privileged
      ? staffContinuation(input.requestedContinuation)
      : safeCommercialContinuation(input.requestedContinuation);

    if (activeMemberships.length === 0) {
      return {
        destination: `/organisations/select?next=${encodeURIComponent(continuation)}`,
        clearCommercialPreference: true,
      };
    }
    if (privileged && input.identity.aal !== "aal2") {
      return { destination: `/mfa?next=${encodeURIComponent(continuation)}` };
    }
    if (activeMemberships.length > 1) {
      return {
        destination: `/organisations/select?next=${encodeURIComponent(continuation)}`,
        clearCommercialPreference: true,
      };
    }

    const context = resolveOrganisationSelection(input.identity, activeMemberships[0].membershipId);
    const commercialPreference = sitePreference(context);
    return context.selectedSiteId
      ? { destination: continuation, commercialPreference }
      : { destination: siteSelectionUrl(continuation), commercialPreference };
  }

  if (input.legacyAccount) {
    if (!input.legacyAccount.active) {
      return {
        destination: "/login?notice=inactive",
        clearCommercialPreference: true,
        signOut: true,
      };
    }
    if (input.legacyAccount.mustChangePassword) {
      return { destination: "/change-password", clearCommercialPreference: true };
    }
    return {
      destination: input.legacyAccount.role === "manager" ? "/dashboard" : "/my-rota",
      clearCommercialPreference: true,
    };
  }

  return {
    destination: input.onboardingDestination ?? "/onboarding",
    clearCommercialPreference: true,
  };
}
