// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveSiteNavigation, resolveOrganisationSelection, resolveSiteSelection, requiresSiteNavigation } from "@/lib/commercial-identity/site-navigation";
import { decodeCommercialPreference, encodeCommercialPreference, type CommercialPreference } from "@/lib/commercial-identity/preference";
import type { CommercialIdentitySnapshot, CommercialMembershipSummary } from "@/types/tenancy";

export function member(sites: string[] = ["site-a", "site-b"], overrides: Partial<CommercialMembershipSummary> = {}): CommercialMembershipSummary {
  return { membershipId: "membership-a", organisationId: "org-a", organisationDisplayName: "Fictional Nursery A", organisationStatus: "active", organisationArchived: false, status: "active", active: true, staffId: null, authorisationRevision: 7, roles: [{ role: "organisation_owner", scopeType: "organisation", siteId: null }], siteAccess: sites, permissions: ["attendance.read"], sitePermissions: Object.fromEntries(sites.map((id) => [id, ["attendance.read"]])), ...overrides };
}
function identity(memberships = [member()]): CommercialIdentitySnapshot {
  return { authUserId: "fictional-user", email: "manager@example.test", aal: "aal2", memberships };
}
const preference: CommercialPreference = { membershipId: "membership-a", siteId: null, authorisationRevision: 7 };

describe("authoritative commercial site navigation", () => {
  it("requires an organisation choice without a signed preference", () => {
    expect(resolveSiteNavigation(identity(), null).kind).toBe("organisation");
  });
  it("keeps zero-site organisations out of Home", () => {
    expect(resolveSiteNavigation(identity([member([])]), preference).kind).toBe("sites");
    expect(resolveOrganisationSelection(identity([member([])]), "membership-a").selectedSiteId).toBeNull();
  });
  it("automatically resolves exactly one authorised site", () => {
    const result = resolveSiteNavigation(identity([member(["site-a"])]), preference);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.context.selectedSiteId).toBe("site-a");
  });
  it("requires an explicit choice for multiple sites", () => {
    expect(resolveSiteNavigation(identity(), preference).kind).toBe("sites");
  });
  it("accepts a currently authorised site", () => {
    expect(resolveSiteSelection(identity(), "membership-a", "site-b", 7).selectedSiteId).toBe("site-b");
  });
  it.each(["inaccessible", "site-from-org-b", "", "toString", "__proto__"])("rejects an invalid submitted site: %s", (site) => {
    expect(() => resolveSiteSelection(identity(), "membership-a", site, 7)).toThrow();
  });
  it("rejects an empty membership instead of choosing an implicit organisation", () => {
    expect(() => resolveOrganisationSelection(identity(), "")).toThrow();
  });
  it("rejects stale form authorisation", () => {
    expect(() => resolveSiteSelection(identity(), "membership-a", "site-a", 6)).toThrow();
  });
  it("sends revoked site access through selection, not an alternative auto-selection", () => {
    expect(resolveSiteNavigation(identity([member(["site-b"])]), { ...preference, siteId: "site-a" }).kind).toBe("sites");
  });
  it("rejects stale revisions even if the site still exists", () => {
    expect(resolveSiteNavigation(identity(), { ...preference, siteId: "site-a", authorisationRevision: 6 }).kind).toBe("sites");
  });
  it.each([{ active: false }, { status: "revoked" as const }, { organisationArchived: true }])("returns unavailable organisations to organisation selection", (overrides) => {
    expect(resolveSiteNavigation(identity([member(undefined, overrides)]), preference).kind).toBe("organisation");
  });
  it("does not carry a site across organisations", () => {
    const b = member(["site-c", "site-d"], { membershipId: "membership-b", organisationId: "org-b" });
    expect(resolveOrganisationSelection(identity([member(), b]), "membership-b").selectedSiteId).toBeNull();
    expect(() => resolveSiteSelection(identity([member(), b]), "membership-b", "site-a", 7)).toThrow();
  });
  it("auto-selects a single-site destination organisation", () => {
    const b = member(["site-c"], { membershipId: "membership-b", organisationId: "org-b" });
    expect(resolveOrganisationSelection(identity([member(), b]), "membership-b").selectedSiteId).toBe("site-c");
  });
  it("preserves selected context through the actual signed-cookie round trip", async () => {
    const selected = { ...preference, siteId: "site-b" };
    const secret = "test-".repeat(8);
    const restored = await decodeCommercialPreference(await encodeCommercialPreference(selected, secret), secret);
    const result = resolveSiteNavigation(identity(), restored);
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.context.selectedSiteId).toBe("site-b");
    expect(resolveSiteNavigation(identity(), await decodeCommercialPreference("tampered", secret)).kind).toBe("organisation");
  });
  it.each(["/dashboard", "/rota", "/attendance", "/payroll", "/payroll/review", "/compliance", "/staff/example", "/settings", "/leave", "/accounts", "/my-rota", "/my-attendance"])("covers direct operational navigation to %s", (path) => {
    expect(requiresSiteNavigation(path)).toBe(true);
  });
  it.each(["/organisations/sites", "/organisations/select", "/admin", "/admin/sites", "/onboarding", "/login", "/mfa", "/api/internal/notifications/process", "/clock"])("does not trap recovery, admin, auth or kiosk routes: %s", (path) => {
    expect(requiresSiteNavigation(path)).toBe(false);
  });
});
