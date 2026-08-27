import { headers } from "next/headers";
import { correlationId } from "@/lib/observability/request-context";
import { createLogger } from "@/lib/observability/logging";
import { resolveMembershipContext, type MembershipContextRequest } from "./context";
import { resolveAuthenticatedCommercialIdentity } from "./identity";
import { readCommercialPreference } from "./session";
import { createSupabaseCommercialIdentityDependencies } from "./supabase-store";

export async function requireCommercialIdentity() {
  return resolveAuthenticatedCommercialIdentity(await createSupabaseCommercialIdentityDependencies());
}

export async function requireActiveMembership(request: MembershipContextRequest = {}) {
  const requestId = correlationId((await headers()).get("x-request-id"));
  const identity = await requireCommercialIdentity();
  const preference = await readCommercialPreference();
  try {
    return resolveMembershipContext(identity, {
      requestedMembershipId: request.requestedMembershipId ?? preference?.membershipId,
      requestedOrganisationId: request.requestedOrganisationId,
      requestedSiteId: request.requestedSiteId ?? preference?.siteId,
      expectedAuthorisationRevision: request.expectedAuthorisationRevision ?? preference?.authorisationRevision,
      selectionMode: request.selectionMode ?? "sensitive",
    });
  } catch (error) {
    createLogger("commercial-identity", { correlationId: requestId }).warn("Commercial membership context denied", {
      errorCode: error instanceof Error && "code" in error ? String(error.code) : "identity_unavailable",
    });
    throw error;
  }
}
