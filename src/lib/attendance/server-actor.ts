import { requireAccount } from "@/lib/auth/permissions";
import { requireCustomerDomainContext } from "@/lib/customer-domain/context";
import { resolveAttendanceActor } from "@/lib/attendance/tenant-actor";
import type { OrganisationPermission } from "@/types/tenancy";
import { requireActiveMembership } from "@/lib/commercial-identity/server";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";

export function requireAttendanceActor(
  permission: OrganisationPermission,
  options: { siteRequired?: boolean; legacyRoles?: Array<"manager" | "staff"> } = {},
) {
  return resolveAttendanceActor({
    loadCommercial: () => requireCustomerDomainContext(permission, options),
    loadLegacy: () => requireAccount(options.legacyRoles ?? ["manager"]),
  });
}

export function requireAttendanceSelfActor() {
  return resolveAttendanceActor({
    loadCommercial: async () => {
      const context = await requireActiveMembership({ selectionMode: "sensitive" });
      if (!context.staffId) throw new CommercialIdentityError("linked_staff_required");
      if (!context.selectedSiteId) throw new CommercialIdentityError("site_unavailable");
      return context;
    },
    loadLegacy: () => requireAccount(["staff"]),
  });
}
