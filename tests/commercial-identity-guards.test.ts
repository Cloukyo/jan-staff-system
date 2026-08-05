import { describe, expect, it } from "vitest";
import { requireAal2, requireLinkedStaffProfile, requirePermission } from "@/lib/commercial-identity/guards";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import {
  decodeCommercialPreference,
  encodeCommercialPreference,
  safeCommercialContinuation,
} from "@/lib/commercial-identity/preference";
import type { CommercialIdentitySnapshot, CommercialMembershipContext } from "@/types/tenancy";
import { commercialPreferenceCookieOptions, getCommercialSessionSecret } from "@/lib/commercial-identity/session";

const SECRET = "fictional-commercial-session-secret-at-least-32-characters";
const NOW = new Date("2026-08-05T12:00:00Z");

function context(overrides: Partial<CommercialMembershipContext> = {}): CommercialMembershipContext {
  return {
    membershipId: "membership-a",
    organisationId: "organisation-a",
    organisationDisplayName: "Organisation A",
    organisationStatus: "active",
    organisationArchived: false,
    status: "active",
    active: true,
    staffId: "staff-a",
    authorisationRevision: 4,
    roles: [],
    siteAccess: [],
    sitePermissions: {},
    selectedSiteId: null,
    permittedSiteIds: [],
    permissions: ["rota.manage"],
    ...overrides,
  };
}

function errorCode(action: () => unknown) {
  try { action(); } catch (error) { return (error as CommercialIdentityError).code; }
  return "none";
}

describe("commercial preference and guards", () => {
  it("round-trips a signed minimal preference and clears site state when omitted", async () => {
    const encoded = await encodeCommercialPreference({ membershipId: "membership-a", siteId: null, authorisationRevision: 4 }, SECRET, NOW);
    expect(await decodeCommercialPreference(encoded, SECRET, NOW)).toEqual({ membershipId: "membership-a", siteId: null, authorisationRevision: 4 });
    expect(encoded).not.toContain("rota.manage");
  });

  it("rejects tampered, expired and wrong-version preferences", async () => {
    const encoded = await encodeCommercialPreference({ membershipId: "membership-a", siteId: "site-a", authorisationRevision: 4 }, SECRET, NOW, 60);
    expect(await decodeCommercialPreference(`${encoded.slice(0, -1)}x`, SECRET, NOW)).toBeNull();
    expect(await decodeCommercialPreference(encoded, SECRET, new Date("2026-08-05T12:02:00Z"))).toBeNull();
    expect(await decodeCommercialPreference(encoded.replace(/^v1/, "v2"), SECRET, NOW)).toBeNull();
  });

  it("allows only fixed local continuation routes", () => {
    expect(safeCommercialContinuation("/dashboard")).toBe("/dashboard");
    expect(safeCommercialContinuation("https://evil.example")).toBe("/dashboard");
    expect(safeCommercialContinuation("//evil.example/path")).toBe("/dashboard");
    expect(safeCommercialContinuation("/attendance?day=2026-08-05")).toBe("/attendance?day=2026-08-05");
  });

  it("enforces permissions and linked staff with typed neutral errors", () => {
    expect(requirePermission(context(), "rota.manage").membershipId).toBe("membership-a");
    expect(errorCode(() => requirePermission(context(), "payroll.export"))).toBe("permission_denied");
    expect(errorCode(() => requireLinkedStaffProfile(context({ staffId: null })))).toBe("linked_staff_required");
  });

  it("requires fresh server-provided AAL2 for privileged operations", () => {
    const identity = { authUserId: "user", email: null, memberships: [], aal: "aal1" } satisfies CommercialIdentitySnapshot;
    expect(errorCode(() => requireAal2(identity))).toBe("mfa_required");
    expect(requireAal2({ ...identity, aal: "aal2" }).aal).toBe("aal2");
  });

  it("uses secure HTTP-only cookie flags and validates the server-only secret lazily", () => {
    expect(commercialPreferenceCookieOptions(true)).toEqual(expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }));
    expect(() => getCommercialSessionSecret({} as NodeJS.ProcessEnv)).toThrow("COMMERCIAL_SESSION_SECRET");
    expect(getCommercialSessionSecret({ ...process.env, COMMERCIAL_SESSION_SECRET: SECRET })).toBe(SECRET);
  });
});
