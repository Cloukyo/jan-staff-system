import { describe, expect, it } from "vitest";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { commercialProtectedRouteRecovery } from "@/lib/commercial-identity/route-recovery";

describe("commercial protected route recovery", () => {
  it.each([
    ["unauthenticated request", "not_authenticated"],
    ["expired authentication session", "not_authenticated"],
  ] as const)("routes an %s to sign-in without exposing an exception", (_label, code) => {
    expect(commercialProtectedRouteRecovery(new CommercialIdentityError(code), "/admin"))
      .toEqual({ kind: "redirect", destination: "/login?next=%2Fadmin" });
  });

  it.each([
    ["invalid organisation preference", "stale_preference"],
    ["revoked membership", "membership_unavailable"],
    ["no active membership", "membership_required"],
    ["site access changed", "site_unavailable"],
  ] as const)("routes an %s to authoritative context selection", (_label, code) => {
    expect(commercialProtectedRouteRecovery(new CommercialIdentityError(code), "/admin/sites"))
      .toEqual({ kind: "redirect", destination: "/organisations/select?next=%2Fadmin%2Fsites" });
  });

  it("routes an MFA downgrade through the existing MFA contract", () => {
    expect(commercialProtectedRouteRecovery(new CommercialIdentityError("mfa_required"), "/admin/billing"))
      .toEqual({ kind: "redirect", destination: "/mfa?next=%2Fadmin%2Fbilling" });
  });

  it("returns not-found for an authenticated permission denial", () => {
    expect(commercialProtectedRouteRecovery(new CommercialIdentityError("permission_denied"), "/admin/access"))
      .toEqual({ kind: "not_found" });
  });

  it("does not swallow unexpected failures", () => {
    expect(commercialProtectedRouteRecovery(new Error("database unavailable"), "/admin"))
      .toEqual({ kind: "rethrow" });
  });

  it("rejects an unsafe continuation before building a redirect", () => {
    expect(commercialProtectedRouteRecovery(new CommercialIdentityError("not_authenticated"), "//example.test"))
      .toEqual({ kind: "redirect", destination: "/login?next=%2Fdashboard" });
  });
});
