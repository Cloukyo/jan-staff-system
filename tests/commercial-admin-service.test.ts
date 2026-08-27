import { describe, expect, it, vi } from "vitest";
import { executeCommercialAdminCommand, loadCommercialAdminSnapshot } from "@/lib/commercial-admin/service";

const snapshot = {
  organisation: { id: "10000000-0000-4000-8000-000000000001", displayName: "Northstar Example", legalName: "Northstar Example Limited", contactEmail: "owner@example.invalid", contactPhone: null, countryCode: "GB", timezone: "Europe/London", operationalState: "live", addressLine1: "1 Fictional Way", addressLine2: null, locality: "Exampleton", region: null, postcode: "ZZ1 1ZZ", revision: 4 },
  actor: { membershipId: "20000000-0000-4000-8000-000000000001", revision: 2, permissions: ["organisation.manage"] },
  selectedSiteId: null, sites: [], staff: [], memberships: [], invitations: [], workAreas: [], closures: [], devices: [], settings: { organisation: null, sites: [] },
};

describe("commercial administration service", () => {
  it("parses an authoritative tenant-fenced snapshot", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
    await expect(loadCommercialAdminSnapshot({ organisationId: snapshot.organisation.id, siteId: null }, { rpc })).resolves.toEqual(snapshot);
    expect(rpc).toHaveBeenCalledWith("get_commercial_admin_snapshot", { target_organisation_id: snapshot.organisation.id, target_site_id: null });
  });

  it("sends the expected organisation revision and rejects malformed replies", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "success", code: "site_created", resourceId: "30000000-0000-4000-8000-000000000001", revision: 5 }, error: null });
    await expect(executeCommercialAdminCommand({ organisationId: snapshot.organisation.id, commandName: "create_site", payload: { name: "East Site" }, idempotencyKey: "40000000-0000-4000-8000-000000000001", expectedRevision: 4 }, { rpc })).resolves.toMatchObject({ outcome: "success", revision: 5 });
    rpc.mockResolvedValueOnce({ data: { outcome: "success", revision: "wrong" }, error: null });
    await expect(executeCommercialAdminCommand({ organisationId: snapshot.organisation.id, commandName: "create_site", payload: { name: "East Site" }, idempotencyKey: "40000000-0000-4000-8000-000000000002", expectedRevision: 4 }, { rpc })).rejects.toThrow(/invalid/i);
  });
});
