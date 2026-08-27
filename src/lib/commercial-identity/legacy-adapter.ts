import { CommercialIdentityError } from "./errors";
import type { CommercialMembershipSummary } from "@/types/tenancy";

export type LegacyCommercialCapability = {
  role: "manager" | "staff";
  staffId: string | null;
  organisationId: string;
};

/** Compatibility bridge for inherited routes. Remove as their data becomes tenant-owned in Workstream 4. */
export function toLegacyAccountCapability(memberships: CommercialMembershipSummary[]): LegacyCommercialCapability {
  const active = memberships.filter((membership) => membership.active && membership.status === "active");
  if (active.length !== 1) throw new CommercialIdentityError(active.length ? "organisation_selection_required" : "membership_required");
  const membership = active[0];
  const manager = membership.permissions.some((permission) =>
    ["organisation.manage", "membership.manage", "site.manage", "staff.manage"].includes(permission),
  );
  if (manager) return { role: "manager", staffId: membership.staffId, organisationId: membership.organisationId };
  if (!membership.staffId) throw new CommercialIdentityError("linked_staff_required");
  return { role: "staff", staffId: membership.staffId, organisationId: membership.organisationId };
}
