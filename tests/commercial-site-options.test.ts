// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommercialMembershipContext } from "@/types/tenancy";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-admin", () => ({
  createSupabaseAdminClient: mocks.createAdminClient,
}));

import { loadAuthorisedSiteOptions } from "@/lib/commercial-identity/site-options";

function context(permittedSiteIds: string[]): CommercialMembershipContext {
  return {
    membershipId: "membership-a",
    organisationId: "organisation-a",
    organisationDisplayName: "Fictional Nursery",
    organisationStatus: "active",
    organisationArchived: false,
    status: "active",
    active: true,
    staffId: "staff-a",
    authorisationRevision: 7,
    roles: [{ role: "staff", scopeType: "organisation", siteId: null }],
    siteAccess: permittedSiteIds,
    permissions: [],
    sitePermissions: {},
    selectedSiteId: null,
    permittedSiteIds,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue({ from: mocks.from });
});

describe("authorised site options", () => {
  it("does not open the privileged client when no site is authorised", async () => {
    await expect(loadAuthorisedSiteOptions(context([]))).resolves.toEqual([]);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("loads names only for the resolved organisation and authorised site IDs", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [{ id: "site-b", name: "Fictional East" }, { id: "site-a", name: "Fictional West" }],
      error: null,
    });
    mocks.from.mockReturnValue(query);

    await expect(loadAuthorisedSiteOptions(context(["site-a", "site-b"]))).resolves.toEqual([
      { id: "site-b", name: "Fictional East" },
      { id: "site-a", name: "Fictional West" },
    ]);
    expect(mocks.from).toHaveBeenCalledWith("organisation_sites");
    expect(query.eq).toHaveBeenCalledWith("organisation_id", "organisation-a");
    expect(query.eq).toHaveBeenCalledWith("active", true);
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
    expect(query.in).toHaveBeenCalledWith("id", ["site-a", "site-b"]);
    expect(query.order).toHaveBeenCalledWith("name");
  });
});
