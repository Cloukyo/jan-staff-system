import { CommercialIdentityError } from "./errors";
import type { AuthenticatorAssuranceLevel, CommercialIdentitySnapshot, CommercialMembershipSummary } from "@/types/tenancy";

export type CommercialIdentityDependencies = {
  getUser: () => Promise<{ id: string; email: string | null } | null>;
  getAal: () => Promise<AuthenticatorAssuranceLevel>;
  loadMemberships: (authUserId: string) => Promise<CommercialMembershipSummary[]>;
};

export async function resolveAuthenticatedCommercialIdentity(
  dependencies: CommercialIdentityDependencies,
): Promise<CommercialIdentitySnapshot> {
  const user = await dependencies.getUser();
  if (!user) throw new CommercialIdentityError("not_authenticated");
  const [aal, memberships] = await Promise.all([
    dependencies.getAal(),
    dependencies.loadMemberships(user.id),
  ]);
  return { authUserId: user.id, email: user.email, aal, memberships };
}
