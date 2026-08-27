import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrganisationSelector } from "@/components/auth/organisation-selector";
import type { CommercialMembershipSummary } from "@/types/tenancy";

function membership(name: string, id: string): CommercialMembershipSummary {
  return {
    membershipId: id, organisationId: `org-${id}`, organisationDisplayName: name,
    organisationStatus: "active", organisationArchived: false, status: "active", active: true,
    staffId: null, authorisationRevision: 1, roles: [], siteAccess: [], permissions: [], sitePermissions: {},
  };
}

describe("organisation selection", () => {
  it("renders a neutral no-membership state", () => {
    const html = renderToStaticMarkup(<OrganisationSelector memberships={[]} continuation="/dashboard" />);
    expect(html).toContain("No organisation access");
    expect(html).not.toContain("membershipId");
  });

  it("renders only active available organisations as large selectable controls", () => {
    const html = renderToStaticMarkup(<OrganisationSelector
      memberships={[
        membership("Organisation A", "membership-a"),
        membership("Organisation B", "membership-b"),
        { ...membership("Suspended", "membership-c"), active: false, status: "suspended" },
      ]}
      continuation="/attendance"
      stalePreference
    />);
    expect(html).toContain("Organisation A");
    expect(html).toContain("Organisation B");
    expect(html).not.toContain(">Suspended<");
    expect(html).toContain("Your previous organisation access has changed");
    expect(html).toContain('name="membershipId"');
    expect(html).toContain('value="/attendance"');
  });
});
