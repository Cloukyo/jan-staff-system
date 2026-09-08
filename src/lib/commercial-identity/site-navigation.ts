import type { CommercialIdentitySnapshot, CommercialMembershipContext } from "@/types/tenancy";
import { resolveMembershipContext } from "./context";
import { CommercialIdentityError } from "./errors";
import { safeCommercialContinuation, type CommercialPreference } from "./preference";

const sitePrefixes = ["/dashboard", "/rota", "/attendance", "/payroll", "/compliance", "/staff", "/leave", "/settings", "/accounts", "/my-rota", "/my-attendance", "/profile"];

export function requiresSiteNavigation(path: string): boolean {
  return sitePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function siteSelectionUrl(continuation: string, accessChanged = false): string {
  return `/organisations/sites?next=${encodeURIComponent(safeCommercialContinuation(continuation))}${accessChanged ? "&reason=access-changed" : ""}`;
}

export function sitePreference(context: CommercialMembershipContext): CommercialPreference {
  return { membershipId: context.membershipId, siteId: context.selectedSiteId, authorisationRevision: context.authorisationRevision };
}

export function resolveSelectionMembership(identity: CommercialIdentitySnapshot, membershipId: string): CommercialMembershipContext {
  if (!membershipId) throw new CommercialIdentityError("membership_unavailable");
  const context = resolveMembershipContext(identity, { requestedMembershipId: membershipId, selectionMode: "sensitive" });
  if (context.organisationArchived || ["suspended", "closed"].includes(context.organisationStatus)) {
    throw new CommercialIdentityError("membership_unavailable");
  }
  return context;
}

export function resolveSiteSelection(identity: CommercialIdentitySnapshot, membershipId: string, siteId: string, revision?: number): CommercialMembershipContext {
  const membership = resolveSelectionMembership(identity, membershipId);
  // Only own keys from the database permission map are sites, never inherited object properties.
  if (!siteId || !membership.permittedSiteIds.includes(siteId)) throw new CommercialIdentityError("site_unavailable");
  return resolveMembershipContext(identity, { requestedMembershipId: membershipId, requestedSiteId: siteId, expectedAuthorisationRevision: revision, selectionMode: "sensitive" });
}

export function resolveOrganisationSelection(identity: CommercialIdentitySnapshot, membershipId: string): CommercialMembershipContext {
  const context = resolveSelectionMembership(identity, membershipId);
  return context.permittedSiteIds.length === 1
    ? resolveSiteSelection(identity, membershipId, context.permittedSiteIds[0])
    : context;
}

type SiteNavigation =
  | { kind: "organisation" }
  | { kind: "sites"; context: CommercialMembershipContext; accessChanged: boolean }
  | { kind: "ready"; context: CommercialMembershipContext };

export function resolveSiteNavigation(identity: CommercialIdentitySnapshot, preference: CommercialPreference | null): SiteNavigation {
  if (!preference) return { kind: "organisation" };
  let context: CommercialMembershipContext;
  try {
    context = resolveSelectionMembership(identity, preference.membershipId);
  } catch (error) {
    if (!(error instanceof CommercialIdentityError)) throw error;
    return { kind: "organisation" };
  }
  const stale = preference.authorisationRevision !== context.authorisationRevision;
  if (stale || (preference.siteId && !context.permittedSiteIds.includes(preference.siteId))) {
    return { kind: "sites", context, accessChanged: true };
  }
  if (preference.siteId) return { kind: "ready", context: resolveSiteSelection(identity, context.membershipId, preference.siteId, preference.authorisationRevision) };
  if (context.permittedSiteIds.length === 1) return { kind: "ready", context: resolveOrganisationSelection(identity, context.membershipId) };
  return { kind: "sites", context, accessChanged: false };
}
