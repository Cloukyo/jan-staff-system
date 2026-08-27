import { describe, expect, it } from "vitest";
import { resolveAuthenticatedCommercialIdentity } from "@/lib/commercial-identity/identity";
import { toLegacyAccountCapability } from "@/lib/commercial-identity/legacy-adapter";
import { mapInvitationAcceptanceError } from "@/lib/commercial-identity/invitations";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import type { CommercialMembershipSummary } from "@/types/tenancy";

function membership(overrides: Partial<CommercialMembershipSummary> = {}): CommercialMembershipSummary {
  return {
    membershipId: "membership-a", organisationId: "organisation-a", organisationDisplayName: "Organisation A",
    organisationStatus: "active", organisationArchived: false, status: "active", active: true,
    staffId: "staff-a", authorisationRevision: 2, roles: [], siteAccess: [],
    permissions: ["staff.read"], sitePermissions: {}, ...overrides,
  };
}

describe("commercial identity adapters", () => {
  it("resolves Auth identity, AAL and a fresh membership snapshot", async () => {
    let loads = 0;
    const identity = await resolveAuthenticatedCommercialIdentity({
      getUser: async () => ({ id: "user-a", email: "user@example.test" }),
      getAal: async () => "aal2",
      loadMemberships: async () => { loads += 1; return [membership()]; },
    });
    expect(identity).toEqual(expect.objectContaining({ authUserId: "user-a", email: "user@example.test", aal: "aal2" }));
    expect(loads).toBe(1);
  });

  it("fails safely when no authenticated user exists", async () => {
    await expect(resolveAuthenticatedCommercialIdentity({
      getUser: async () => null,
      getAal: async () => "aal1",
      loadMemberships: async () => [],
    })).rejects.toMatchObject({ code: "not_authenticated" });
  });

  it("maps one approved commercial membership to legacy capability", () => {
    expect(toLegacyAccountCapability([membership({ permissions: ["staff.manage"], staffId: null })])).toEqual({ role: "manager", staffId: null, organisationId: "organisation-a" });
    expect(toLegacyAccountCapability([membership()])).toEqual({ role: "staff", staffId: "staff-a", organisationId: "organisation-a" });
  });

  it("fails closed for multi-organisation ambiguity or unlinked staff", () => {
    expect(() => toLegacyAccountCapability([membership(), membership({ membershipId: "membership-b", organisationId: "organisation-b" })])).toThrow(CommercialIdentityError);
    expect(() => toLegacyAccountCapability([membership({ staffId: null, permissions: [] })])).toThrow(CommercialIdentityError);
  });

  it("maps invitation errors without leaking database details", () => {
    expect(mapInvitationAcceptanceError(new Error("commercial_invitation_mfa_required DETAIL secret"))).toBe("mfa_required");
    expect(mapInvitationAcceptanceError(new Error("commercial_invitation_duplicate_membership"))).toBe("unavailable");
    expect(mapInvitationAcceptanceError(new Error("unknown database error"))).toBe("unavailable");
  });
});
