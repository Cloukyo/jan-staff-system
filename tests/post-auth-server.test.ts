// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommercialIdentitySnapshot } from "@/types/tenancy";

const state = vi.hoisted(() => ({
  identity: { authUserId: "user-a", email: "manager@example.test", aal: "aal2", memberships: [] } as CommercialIdentitySnapshot,
  account: null as null | { active: boolean; must_change_password: boolean; role: "manager" | "staff" },
  accountError: null as null | { message: string },
  onboardingLoads: 0,
  onboardingDestination: "/onboarding/legal",
  write: vi.fn(),
  clear: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signOut: state.signOut },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.account, error: state.accountError }) }),
      }),
    }),
    rpc: vi.fn(),
  }),
}));
vi.mock("@/lib/commercial-identity/identity", () => ({
  resolveAuthenticatedCommercialIdentity: async () => state.identity,
}));
vi.mock("@/lib/commercial-identity/supabase-store", () => ({
  createSupabaseCommercialIdentityDependencies: async () => ({}),
}));
vi.mock("@/lib/commercial-identity/session", () => ({
  writeCommercialPreference: state.write,
  clearCommercialPreference: state.clear,
}));
vi.mock("@/lib/onboarding/bootstrap-service", () => ({
  loadOnboardingBootstrap: async () => {
    state.onboardingLoads += 1;
    return {};
  },
}));
vi.mock("@/lib/onboarding/navigation", () => ({
  authoritativeOnboardingRoute: () => state.onboardingDestination,
}));

import {
  applyPostAuthDestination,
  resolvePostAuthDestinationServer,
} from "@/lib/auth/post-auth-server";

function establishedIdentity(): CommercialIdentitySnapshot {
  return {
    authUserId: "user-a",
    email: "manager@example.test",
    aal: "aal2",
    memberships: [{
      membershipId: "membership-a",
      organisationId: "organisation-a",
      organisationDisplayName: "Fictional Nursery",
      organisationStatus: "active",
      organisationArchived: false,
      status: "active",
      active: true,
      staffId: null,
      authorisationRevision: 4,
      roles: [{ role: "organisation_admin", scopeType: "organisation", siteId: null }],
      siteAccess: ["site-a"],
      permissions: ["attendance.read"],
      sitePermissions: { "site-a": ["attendance.read"] },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.identity = { authUserId: "user-a", email: "owner@example.test", aal: "aal2", memberships: [] };
  state.account = null;
  state.accountError = null;
  state.onboardingLoads = 0;
  state.onboardingDestination = "/onboarding/legal";
});

describe("post-auth server authority", () => {
  it("does not load or create owner onboarding state for an established member", async () => {
    state.identity = establishedIdentity();
    const decision = await resolvePostAuthDestinationServer("/dashboard");
    expect(decision.destination).toBe("/dashboard");
    expect(state.onboardingLoads).toBe(0);
  });

  it("loads authoritative onboarding only for a user with no membership or legacy account", async () => {
    const decision = await resolvePostAuthDestinationServer("/dashboard");
    expect(decision.destination).toBe("/onboarding/legal");
    expect(state.onboardingLoads).toBe(1);
  });

  it("does not start owner onboarding for a revoked member", async () => {
    state.identity = establishedIdentity();
    state.identity.memberships[0].active = false;
    state.identity.memberships[0].status = "revoked";
    const decision = await resolvePostAuthDestinationServer("/dashboard");
    expect(decision.destination).toBe("/organisations/select?next=%2Fdashboard");
    expect(state.onboardingLoads).toBe(0);
  });

  it("persists only the resolver's authorised preference", async () => {
    await applyPostAuthDestination({
      destination: "/dashboard",
      commercialPreference: { membershipId: "membership-a", siteId: "site-a", authorisationRevision: 4 },
    });
    expect(state.write).toHaveBeenCalledWith({ membershipId: "membership-a", siteId: "site-a", authorisationRevision: 4 });
    expect(state.clear).not.toHaveBeenCalled();
  });

  it("clears stale context and signs out when the authoritative decision requires it", async () => {
    await applyPostAuthDestination({
      destination: "/login?notice=inactive",
      clearCommercialPreference: true,
      signOut: true,
    });
    expect(state.clear).toHaveBeenCalledOnce();
    expect(state.signOut).toHaveBeenCalledOnce();
  });
});
