import { describe, expect, it } from "vitest";
import { resolveMembershipContext } from "@/lib/commercial-identity/context";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import type { CommercialIdentitySnapshot, CommercialMembershipSummary } from "@/types/tenancy";

const SITE_A = "11000000-0000-0000-0000-000000000001";
const SITE_B = "11000000-0000-0000-0000-000000000002";

function membership(overrides: Partial<CommercialMembershipSummary> = {}): CommercialMembershipSummary {
  return {
    membershipId: "aa000000-0000-0000-0000-000000000001",
    organisationId: "10000000-0000-0000-0000-000000000001",
    organisationDisplayName: "Organisation A",
    organisationStatus: "active",
    organisationArchived: false,
    status: "active",
    active: true,
    staffId: "staff-a",
    authorisationRevision: 7,
    roles: [{ role: "site_manager", scopeType: "site", siteId: SITE_A }],
    siteAccess: [SITE_A],
    permissions: [],
    sitePermissions: { [SITE_A]: ["site.read", "rota.manage"] },
    ...overrides,
  };
}

function snapshot(memberships: CommercialMembershipSummary[]): CommercialIdentitySnapshot {
  return { authUserId: "user-a", email: "user@example.test", aal: "aal2", memberships };
}

function code(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return (error as CommercialIdentityError).code;
  }
  return "none";
}

describe("commercial membership context", () => {
  it("requires a membership when none is active", () => {
    expect(code(() => resolveMembershipContext(snapshot([]), {}))).toBe("membership_required");
    expect(code(() => resolveMembershipContext(snapshot([membership({ status: "suspended", active: false })]), {}))).toBe("membership_required");
  });

  it("selects the only active membership but fails closed on ambiguity", () => {
    expect(resolveMembershipContext(snapshot([membership()]), {}).organisationId).toBe("10000000-0000-0000-0000-000000000001");
    const second = membership({ membershipId: "bb000000-0000-0000-0000-000000000001", organisationId: "20000000-0000-0000-0000-000000000001" });
    expect(code(() => resolveMembershipContext(snapshot([membership(), second]), {}))).toBe("organisation_selection_required");
  });

  it("resolves an explicit active organisation and rejects archived or revoked selections", () => {
    expect(resolveMembershipContext(snapshot([membership()]), { requestedOrganisationId: "10000000-0000-0000-0000-000000000001" }).membershipId).toContain("aa000000");
    expect(code(() => resolveMembershipContext(snapshot([membership({ active: false, organisationArchived: true })]), { requestedOrganisationId: "10000000-0000-0000-0000-000000000001" }))).toBe("membership_unavailable");
    expect(code(() => resolveMembershipContext(snapshot([membership({ status: "revoked", active: false })]), { requestedOrganisationId: "10000000-0000-0000-0000-000000000001" }))).toBe("membership_unavailable");
  });

  it("rejects stale sensitive preferences using the current database revision", () => {
    expect(code(() => resolveMembershipContext(snapshot([membership()]), {
      requestedMembershipId: "aa000000-0000-0000-0000-000000000001",
      expectedAuthorisationRevision: 6,
      selectionMode: "sensitive",
    }))).toBe("stale_preference");
  });

  it("limits selected sites to the current permission map", () => {
    const context = resolveMembershipContext(snapshot([membership()]), { requestedSiteId: SITE_A });
    expect(context.permissions).toEqual(["rota.manage", "site.read"]);
    expect(code(() => resolveMembershipContext(snapshot([membership({ siteAccess: [SITE_A, SITE_B] })]), { requestedSiteId: SITE_B }))).toBe("site_unavailable");
  });

  it("unions permissions already derived by the database without trusting caller values", () => {
    const context = resolveMembershipContext(snapshot([membership({
      permissions: ["staff.read"],
      sitePermissions: { [SITE_A]: ["rota.manage", "staff.read"] },
    })]), { requestedSiteId: SITE_A });
    expect(context.permissions).toEqual(["rota.manage", "staff.read"]);
  });
});
