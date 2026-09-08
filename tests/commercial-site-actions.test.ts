// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommercialIdentitySnapshot } from "@/types/tenancy";

const state = vi.hoisted(() => ({ identity: {} as CommercialIdentitySnapshot, write: vi.fn(), clear: vi.fn(), signOut: vi.fn(), preference: { membershipId: "m", siteId: "a", authorisationRevision: 7 } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/commercial-identity/identity", () => ({ resolveAuthenticatedCommercialIdentity: async () => state.identity }));
vi.mock("@/lib/commercial-identity/supabase-store", () => ({ createSupabaseCommercialIdentityDependencies: async () => ({}) }));
vi.mock("@/lib/commercial-identity/session", () => ({ writeCommercialPreference: state.write, clearCommercialPreference: state.clear, readCommercialPreference: async () => state.preference }));
vi.mock("@/lib/auth/config", () => ({ hasSupabaseConfig: () => true }));
vi.mock("@/lib/pilot-access/signup-authorisation", () => ({ PILOT_SIGNUP_MESSAGE: "Pilot access required", reservePilotSignup: vi.fn(), releasePilotSignup: vi.fn(), bindPilotSignup: vi.fn() }));
vi.mock("@/lib/auth/supabase-server", () => ({ createSupabaseServerClient: async () => ({ auth: { signOut: state.signOut } }) }));
import { selectCommercialOrganisation, selectCommercialSite } from "@/lib/commercial-identity/actions";
import { signOutAction } from "@/lib/auth/actions";

function form(values: Record<string, string>) { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, value); return result; }
beforeEach(() => {
  vi.clearAllMocks();
  state.identity = { authUserId: "fictional", email: "fictional@example.test", aal: "aal2", memberships: [{ membershipId: "m", organisationId: "o", organisationDisplayName: "Fictional Nursery", organisationStatus: "active", organisationArchived: false, status: "active", active: true, staffId: null, authorisationRevision: 7, roles: [], siteAccess: ["a", "b"], permissions: [], sitePermissions: { a: ["attendance.read"], b: ["attendance.read"] } }] };
});
describe("site-selection server actions", () => {
  it("organisation selection clears the old site and routes multi-site managers to selection", async () => {
    await expect(selectCommercialOrganisation(form({ membershipId: "m", continuation: "/dashboard" }))).rejects.toThrow("redirect:/organisations/sites?next=%2Fdashboard");
    expect(state.write).toHaveBeenCalledWith({ membershipId: "m", siteId: null, authorisationRevision: 7 });
  });
  it("one-site organisation selection persists the only current authorised site", async () => {
    state.identity.memberships[0].sitePermissions = { b: ["attendance.read"] };
    await expect(selectCommercialOrganisation(form({ membershipId: "m", continuation: "/rota" }))).rejects.toThrow("redirect:/rota");
    expect(state.write).toHaveBeenCalledWith({ membershipId: "m", siteId: "b", authorisationRevision: 7 });
  });
  it("authorised site selection preserves a safe continuation", async () => {
    await expect(selectCommercialSite(form({ membershipId: "m", siteId: "b", continuation: "/rota?week=2026-09-07" }))).rejects.toThrow("redirect:/rota?week=2026-09-07");
    expect(state.write).toHaveBeenCalledWith({ membershipId: "m", siteId: "b", authorisationRevision: 7 });
  });
  it.each(["foreign-site", "", "toString"])("rejects forged client site %s without persisting it", async (siteId) => {
    await expect(selectCommercialSite(form({ membershipId: "m", siteId, continuation: "/dashboard" }))).rejects.toThrow("redirect:/organisations/sites?");
    expect(state.write).not.toHaveBeenCalledWith(expect.objectContaining({ siteId }));
  });
  it("handles access revoked between rendering and submission", async () => {
    state.identity.memberships[0].sitePermissions = { b: ["attendance.read"] };
    state.identity.memberships[0].authorisationRevision = 8;
    await expect(selectCommercialSite(form({ membershipId: "m", siteId: "a" }))).rejects.toThrow("redirect:/organisations/sites?");
    expect(state.write).not.toHaveBeenCalledWith(expect.objectContaining({ siteId: "a" }));
  });
  it("handles an organisation becoming unavailable without a server error", async () => {
    state.identity.memberships[0].active = false;
    await expect(selectCommercialSite(form({ membershipId: "m", siteId: "a" }))).rejects.toThrow("redirect:/organisations/select?");
    expect(state.clear).toHaveBeenCalled();
  });
  it("does not allow an external continuation", async () => {
    await expect(selectCommercialSite(form({ membershipId: "m", siteId: "b", continuation: "//outside.example" }))).rejects.toThrow("redirect:/dashboard");
  });
  it("clears site context at logout before another account can sign in", async () => {
    await expect(signOutAction()).rejects.toThrow("redirect:/login");
    expect(state.signOut).toHaveBeenCalledOnce();
    expect(state.clear).toHaveBeenCalledOnce();
  });
});
