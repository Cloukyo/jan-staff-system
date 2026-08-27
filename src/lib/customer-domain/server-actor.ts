import { requireAccount } from "@/lib/auth/permissions";
import { resolveCustomerDomainActor } from "@/lib/customer-domain/actor";
import { requireCustomerDomainContext } from "@/lib/customer-domain/context";
import type { OrganisationPermission } from "@/types/tenancy";

export function requireCustomerDomainActor(
  permission: OrganisationPermission,
  options: { siteRequired?: boolean } = {},
) {
  return resolveCustomerDomainActor({
    loadCommercial: () => requireCustomerDomainContext(permission, options),
    loadLegacyManager: () => requireAccount(["manager"]),
  });
}
