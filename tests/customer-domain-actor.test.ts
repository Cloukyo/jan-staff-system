import { describe, expect, it } from "vitest";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { resolveCustomerDomainActor } from "@/lib/customer-domain/actor";

describe("customer-domain compatibility actor", () => {
  it("uses current commercial membership authority without consulting staff_accounts", async () => {
    let legacyCalls = 0;
    const commercial = { membershipId: "membership-a", organisationId: "org-a", selectedSiteId: "site-a" };
    const actor = await resolveCustomerDomainActor({
      loadCommercial: async () => commercial,
      loadLegacyManager: async () => { legacyCalls += 1; return { id: "legacy" }; },
    });
    expect(actor).toEqual({ kind: "commercial", context: commercial });
    expect(legacyCalls).toBe(0);
  });

  it("falls back only when the authenticated user has no commercial membership", async () => {
    const actor = await resolveCustomerDomainActor({
      loadCommercial: async () => { throw new CommercialIdentityError("membership_required"); },
      loadLegacyManager: async () => ({ id: "legacy-manager" }),
    });
    expect(actor).toEqual({ kind: "legacy", account: { id: "legacy-manager" } });
  });

  it("does not turn commercial permission denial into legacy manager access", async () => {
    await expect(resolveCustomerDomainActor({
      loadCommercial: async () => { throw new CommercialIdentityError("permission_denied"); },
      loadLegacyManager: async () => ({ id: "legacy-manager" }),
    })).rejects.toMatchObject({ code: "permission_denied" });
  });
});
