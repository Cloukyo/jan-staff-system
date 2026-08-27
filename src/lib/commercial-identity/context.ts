import { CommercialIdentityError } from "./errors";
import type {
  CommercialIdentitySnapshot,
  CommercialMembershipContext,
  CommercialMembershipSummary,
  OrganisationPermission,
} from "@/types/tenancy";

export type MembershipContextRequest = {
  requestedMembershipId?: string | null;
  requestedOrganisationId?: string | null;
  requestedSiteId?: string | null;
  expectedAuthorisationRevision?: number | null;
  selectionMode?: "navigation" | "sensitive";
};

function chooseMembership(
  memberships: CommercialMembershipSummary[],
  request: MembershipContextRequest,
): CommercialMembershipSummary {
  const explicitlyRequested = request.requestedMembershipId || request.requestedOrganisationId;
  const selected = request.requestedMembershipId
    ? memberships.find((item) => item.membershipId === request.requestedMembershipId)
    : request.requestedOrganisationId
      ? memberships.find((item) => item.organisationId === request.requestedOrganisationId)
      : undefined;

  if (explicitlyRequested) {
    if (!selected?.active || selected.status !== "active") {
      throw new CommercialIdentityError("membership_unavailable");
    }
    return selected;
  }

  const active = memberships.filter((item) => item.active && item.status === "active");
  if (active.length === 0) throw new CommercialIdentityError("membership_required");
  if (active.length > 1) throw new CommercialIdentityError("organisation_selection_required");
  return active[0];
}

function uniqueSorted(values: OrganisationPermission[]): OrganisationPermission[] {
  return [...new Set(values)].sort();
}

export function resolveMembershipContext(
  identity: CommercialIdentitySnapshot,
  request: MembershipContextRequest,
): CommercialMembershipContext {
  const membership = chooseMembership(identity.memberships, request);
  if (
    request.selectionMode === "sensitive" &&
    request.expectedAuthorisationRevision != null &&
    request.expectedAuthorisationRevision !== membership.authorisationRevision
  ) {
    throw new CommercialIdentityError("stale_preference");
  }

  const selectedSiteId = request.requestedSiteId ?? null;
  const sitePermissions = selectedSiteId ? membership.sitePermissions[selectedSiteId] : undefined;
  if (selectedSiteId && !sitePermissions) {
    throw new CommercialIdentityError("site_unavailable");
  }

  return {
    ...membership,
    selectedSiteId,
    permittedSiteIds: Object.keys(membership.sitePermissions).sort(),
    permissions: uniqueSorted(sitePermissions ?? membership.permissions),
  };
}
