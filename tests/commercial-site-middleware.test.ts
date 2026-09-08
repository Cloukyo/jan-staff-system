// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CommercialMembershipSummary } from "@/types/tenancy";
import { decodeCommercialPreference, encodeCommercialPreference } from "@/lib/commercial-identity/preference";
const state = vi.hoisted(() => ({ memberships: [] as CommercialMembershipSummary[], error: null as null | { message: string }, user: { id: "fictional" } as { id: string } | null, legacy: false }));
vi.mock("@/lib/app-mode", () => ({ getAppMode: () => "production" }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.legacy ? { must_change_password: false } : null }) }) }) }) }), rpc: async () => ({ data: state.memberships, error: state.error }) }) }));
import { middleware } from "../middleware";
const secret = "fictional-test-only-secret-of-sufficient-length";
async function request(path: string, siteId: string | null = null, revision = 7) {
  const cookie = await encodeCommercialPreference({ membershipId: "m", siteId, authorisationRevision: revision }, secret);
  return new NextRequest(`https://app.example.test${path}`, { headers: { cookie: `commercial_membership=${cookie}` } });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fictional.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "fictional-publishable");
  vi.stubEnv("COMMERCIAL_SESSION_SECRET", secret);
  state.user = { id: "fictional" }; state.error = null; state.legacy = false;
  state.memberships = [{ membershipId: "m", organisationId: "o", organisationDisplayName: "Fictional Nursery", organisationStatus: "active", organisationArchived: false, status: "active", active: true, staffId: null, authorisationRevision: 7, roles: [], siteAccess: [], permissions: [], sitePermissions: { a: ["attendance.read"], b: ["attendance.read"] } }];
});
afterEach(() => vi.unstubAllEnvs());
describe("real middleware site guard", () => {
  it.each(["/dashboard", "/attendance", "/rota", "/payroll", "/compliance", "/staff", "/leave", "/settings"])("redirects direct %s without a site", async (path) => {
    const response = await middleware(await request(path));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`https://app.example.test/organisations/sites?next=${encodeURIComponent(path)}`);
  });
  it("persists and forwards a single-site cookie before server rendering", async () => {
    state.memberships[0].sitePermissions = { b: ["attendance.read"] };
    const response = await middleware(await request("/dashboard"));
    expect(response.headers.get("location")).toBeNull();
    expect(await decodeCommercialPreference(response.cookies.get("commercial_membership")?.value, secret)).toMatchObject({ siteId: "b" });
    expect(response.headers.get("x-middleware-request-cookie")).toContain("commercial_membership=v1.");
  });
  it("does not change a valid preference during ordinary navigation", async () => {
    const response = await middleware(await request("/rota", "b"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.has("commercial_membership")).toBe(false);
  });
  it.each([["revoked", 7], ["a", 6]] as const)("clears stale site %s revision %s and redirects safely", async (site, revision) => {
    const response = await middleware(await request("/dashboard", site, revision));
    expect(response.headers.get("location")).toContain("/organisations/sites?");
    expect(await decodeCommercialPreference(response.cookies.get("commercial_membership")?.value, secret)).toMatchObject({ siteId: null, authorisationRevision: 7 });
  });
  it("sends a signed-out visitor to login", async () => {
    state.user = null;
    expect((await middleware(await request("/dashboard"))).headers.get("location")).toContain("/login");
  });
  it("does not divert POST actions around their authoritative guards", async () => {
    const response = await middleware(new NextRequest("https://app.example.test/attendance", { method: "POST" }));
    expect(response.headers.get("location")).toBeNull();
  });
  it("fails closed if the current identity cannot be loaded", async () => {
    state.error = { message: "private database detail" };
    const response = await middleware(await request("/dashboard", "a"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
  it("preserves the existing legacy-account path when no commercial memberships exist", async () => {
    state.memberships = []; state.legacy = true;
    expect((await middleware(await request("/dashboard"))).headers.get("location")).toBeNull();
  });
});
