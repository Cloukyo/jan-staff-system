import { describe, expect, it } from "vitest";
import {
  resolvePostAuthDestination,
  safePostAuthContinuation,
  type PostAuthDestinationInput,
} from "@/lib/auth/post-auth-destination";
import type { CommercialIdentitySnapshot, CommercialMembershipSummary, OrganisationRole } from "@/types/tenancy";

function membership(overrides: Partial<CommercialMembershipSummary> = {}): CommercialMembershipSummary {
  return {
    membershipId: "membership-a",
    organisationId: "organisation-a",
    organisationDisplayName: "Fictional Nursery A",
    organisationStatus: "active",
    organisationArchived: false,
    status: "active",
    active: true,
    staffId: null,
    authorisationRevision: 7,
    roles: [{ role: "organisation_admin", scopeType: "organisation", siteId: null }],
    siteAccess: ["site-a"],
    permissions: ["attendance.read"],
    sitePermissions: { "site-a": ["attendance.read"] },
    ...overrides,
  };
}

function withRole(role: OrganisationRole, overrides: Partial<CommercialMembershipSummary> = {}) {
  return membership({ roles: [{ role, scopeType: "organisation", siteId: null }], ...overrides });
}

function input(overrides: Partial<PostAuthDestinationInput> = {}): PostAuthDestinationInput {
  return {
    identity: {
      authUserId: "fictional-user",
      email: "manager@example.test",
      aal: "aal2",
      memberships: [membership()],
    },
    legacyAccount: null,
    onboardingDestination: null,
    requestedContinuation: "/dashboard",
    ...overrides,
  };
}

function identity(memberships: CommercialMembershipSummary[], aal: "aal1" | "aal2" = "aal2"): CommercialIdentitySnapshot {
  return { authUserId: "fictional-user", email: "manager@example.test", aal, memberships };
}

describe("post-auth destination state machine", () => {
  it.each([
    ["brand-new owner", "/onboarding"],
    ["required legal acceptance", "/onboarding/legal"],
    ["continuation after legal acceptance", "/onboarding/organisation"],
  ])("keeps %s in the authoritative owner-onboarding flow", (_label, onboardingDestination) => {
    const result = resolvePostAuthDestination(input({
      identity: identity([]),
      onboardingDestination,
    }));
    expect(result.destination).toBe(onboardingDestination);
    expect(result.clearCommercialPreference).toBe(true);
  });

  it.each([
    ["established owner", withRole("organisation_owner")],
    ["established manager", withRole("organisation_admin")],
    ["invited manager after acceptance", withRole("site_manager")],
  ])("routes an %s from membership state instead of owner onboarding", (_label, establishedMembership) => {
    const result = resolvePostAuthDestination(input({
      identity: identity([establishedMembership]),
      onboardingDestination: "/onboarding/legal",
    }));
    expect(result.destination).toBe("/dashboard");
    expect(result.commercialPreference).toEqual({ membershipId: "membership-a", siteId: "site-a", authorisationRevision: 7 });
  });

  it("does not require a historical onboarding session for an established member", () => {
    const result = resolvePostAuthDestination(input({ onboardingDestination: null }));
    expect(result.destination).toBe("/dashboard");
  });

  it("does not restart completed onboarding", () => {
    const result = resolvePostAuthDestination(input({ onboardingDestination: "/commercial/welcome" }));
    expect(result.destination).toBe("/dashboard");
  });

  it("requires MFA before resolving a privileged commercial member's context", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([membership()], "aal1"),
      requestedContinuation: "/attendance?day=2026-09-08",
    }));
    expect(result.destination).toBe("/mfa?next=%2Fattendance%3Fday%3D2026-09-08");
    expect(result.commercialPreference).toBeUndefined();
  });

  it("preserves a supported invitation continuation before membership exists", () => {
    const token = "A".repeat(43);
    const destination = `/invitations/manager?token=${token}`;
    expect(resolvePostAuthDestination(input({
      identity: identity([]),
      onboardingDestination: "/onboarding/legal",
      requestedContinuation: destination,
    })).destination).toBe(destination);
  });

  it("automatically selects one authorised site in one organisation", () => {
    const result = resolvePostAuthDestination(input({ requestedContinuation: "/rota?week=2026-09-07" }));
    expect(result.destination).toBe("/rota?week=2026-09-07");
    expect(result.commercialPreference?.siteId).toBe("site-a");
  });

  it("shows a safe no-access site state for an organisation with zero authorised sites", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([membership({ siteAccess: [], sitePermissions: {} })]),
    }));
    expect(result.destination).toBe("/organisations/sites?next=%2Fdashboard");
    expect(result.commercialPreference?.siteId).toBeNull();
  });

  it("requires explicit site choice for multiple authorised sites", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([membership({
        siteAccess: ["site-a", "site-b"],
        sitePermissions: { "site-a": ["attendance.read"], "site-b": ["attendance.read"] },
      })]),
    }));
    expect(result.destination).toBe("/organisations/sites?next=%2Fdashboard");
    expect(result.commercialPreference?.siteId).toBeNull();
  });

  it("requires organisation selection for multiple active organisations", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([
        membership(),
        membership({ membershipId: "membership-b", organisationId: "organisation-b", organisationDisplayName: "Fictional Nursery B" }),
      ]),
    }));
    expect(result.destination).toBe("/organisations/select?next=%2Fdashboard");
    expect(result.clearCommercialPreference).toBe(true);
  });

  it("routes a commercial staff-only member to self-service and not a manager continuation", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([withRole("staff", { staffId: "staff-a" })], "aal1"),
      requestedContinuation: "/dashboard",
    }));
    expect(result.destination).toBe("/my-rota");
    expect(result.commercialPreference?.siteId).toBe("site-a");
  });

  it.each([
    ["manager", "/dashboard"],
    ["staff", "/my-rota"],
  ] as const)("retains the legacy %s destination when no commercial membership exists", (role, destination) => {
    const result = resolvePostAuthDestination(input({
      identity: identity([]),
      legacyAccount: { active: true, mustChangePassword: false, role },
    }));
    expect(result.destination).toBe(destination);
  });

  it("forces a required password change before any application route", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([]),
      legacyAccount: { active: true, mustChangePassword: true, role: "manager" },
    }));
    expect(result.destination).toBe("/change-password");
  });

  it("signs out an inactive legacy account", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([]),
      legacyAccount: { active: false, mustChangePassword: false, role: "manager" },
    }));
    expect(result.destination).toBe("/login?notice=inactive");
    expect(result.signOut).toBe(true);
    expect(result.clearCommercialPreference).toBe(true);
  });

  it.each(["revoked", "suspended"] as const)("fails closed for a %s membership instead of starting owner onboarding", (status) => {
    const result = resolvePostAuthDestination(input({
      identity: identity([membership({ status, active: false })]),
      onboardingDestination: "/onboarding/legal",
    }));
    expect(result.destination).toBe("/organisations/select?next=%2Fdashboard");
    expect(result.clearCommercialPreference).toBe(true);
  });

  it("does not let stale commercial membership fall back to a legacy manager account", () => {
    const result = resolvePostAuthDestination(input({
      identity: identity([membership({ status: "revoked", active: false })]),
      legacyAccount: { active: true, mustChangePassword: false, role: "manager" },
    }));
    expect(result.destination).toBe("/organisations/select?next=%2Fdashboard");
  });

  it("normalises untrusted continuations without allowing external redirects", () => {
    expect(safePostAuthContinuation("//outside.example")).toBe("/dashboard");
    expect(safePostAuthContinuation("https://outside.example")).toBe("/dashboard");
    expect(safePostAuthContinuation("/attendance?day=2026-09-08")).toBe("/attendance?day=2026-09-08");
    expect(safePostAuthContinuation("/onboarding/legal")).toBe("/onboarding/legal");
  });

  it("is stable when resolution is repeated and never returns owner onboarding for an established member", () => {
    const first = resolvePostAuthDestination(input());
    const second = resolvePostAuthDestination(input({ requestedContinuation: first.destination }));
    expect(second.destination).toBe(first.destination);
    expect(second.destination).not.toMatch(/^\/onboarding/);
  });
});
