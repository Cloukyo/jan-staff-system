import { describe, expect, it } from "vitest";
import { activeStaffSiteAssignments, primaryStaffSiteAssignment } from "@/lib/customer-domain/assignments";
import type { StaffSiteAssignment } from "@/types/tenancy";

const assignments: StaffSiteAssignment[] = [
  {
    id: "assignment-old",
    organisationId: "org-a",
    staffId: "staff-a",
    siteId: "site-a",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-08-31",
    isPrimary: true,
    employmentRole: "Practitioner",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "assignment-new",
    organisationId: "org-a",
    staffId: "staff-a",
    siteId: "site-b",
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    isPrimary: true,
    employmentRole: "Senior practitioner",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "assignment-relief",
    organisationId: "org-a",
    staffId: "staff-a",
    siteId: "site-c",
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    isPrimary: false,
    employmentRole: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  },
];

describe("customer staff-site assignments", () => {
  it("uses inclusive effective dates and supports concurrent non-primary sites", () => {
    expect(activeStaffSiteAssignments(assignments, "2026-08-31").map((item) => item.id)).toEqual([
      "assignment-old",
      "assignment-relief",
    ]);
  });

  it("resolves a future primary transfer without rewriting the earlier assignment", () => {
    expect(primaryStaffSiteAssignment(assignments, "2026-08-31")?.siteId).toBe("site-a");
    expect(primaryStaffSiteAssignment(assignments, "2026-09-01")?.siteId).toBe("site-b");
  });
});
