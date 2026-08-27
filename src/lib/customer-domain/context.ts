import { requirePermission, requireSitePermission } from "@/lib/commercial-identity/guards";
import { requireActiveMembership } from "@/lib/commercial-identity/server";
import type { CommercialMembershipContext, OrganisationPermission } from "@/types/tenancy";

export async function requireCustomerDomainContext(
  permission: OrganisationPermission,
  options: { siteRequired?: boolean } = {},
): Promise<CommercialMembershipContext> {
  const context = await requireActiveMembership({ selectionMode: "sensitive" });
  return options.siteRequired
    ? requireSitePermission(context, permission)
    : requirePermission(context, permission);
}
