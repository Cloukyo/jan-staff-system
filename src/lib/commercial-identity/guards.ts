import { CommercialIdentityError } from "./errors";
import type {
  CommercialIdentitySnapshot,
  CommercialMembershipContext,
  OrganisationPermission,
} from "@/types/tenancy";

export function requirePermission(
  context: CommercialMembershipContext,
  permission: OrganisationPermission,
): CommercialMembershipContext {
  if (!context.permissions.includes(permission)) throw new CommercialIdentityError("permission_denied");
  return context;
}

export function requireSitePermission(
  context: CommercialMembershipContext,
  permission: OrganisationPermission,
): CommercialMembershipContext {
  if (!context.selectedSiteId) throw new CommercialIdentityError("site_unavailable");
  return requirePermission(context, permission);
}

export function requireLinkedStaffProfile(context: CommercialMembershipContext): CommercialMembershipContext & { staffId: string } {
  if (!context.staffId) throw new CommercialIdentityError("linked_staff_required");
  return context as CommercialMembershipContext & { staffId: string };
}

export function requireAal2(identity: CommercialIdentitySnapshot): CommercialIdentitySnapshot & { aal: "aal2" } {
  if (identity.aal !== "aal2") throw new CommercialIdentityError("mfa_required");
  return identity as CommercialIdentitySnapshot & { aal: "aal2" };
}
