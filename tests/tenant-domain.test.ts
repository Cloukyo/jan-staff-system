import { describe, expect, it } from "vitest";
import {
  ORGANISATION_PERMISSIONS,
  ORGANISATION_ROLES,
  isOrganisationPermission,
  isOrganisationRole,
} from "@/types/tenancy";

describe("tenant domain constants", () => {
  it("publishes the fixed role catalogue", () => {
    expect(ORGANISATION_ROLES).toEqual([
      "organisation_owner",
      "organisation_admin",
      "hr_admin",
      "payroll_admin",
      "site_manager",
      "scheduler",
      "staff",
    ]);
    expect(isOrganisationRole("site_manager")).toBe(true);
    expect(isOrganisationRole("manager")).toBe(false);
  });

  it("publishes and validates the frozen permission catalogue", () => {
    expect(ORGANISATION_PERMISSIONS).toHaveLength(25);
    expect(isOrganisationPermission("organisation.export")).toBe(true);
    expect(isOrganisationPermission("attendance.correct")).toBe(true);
    expect(isOrganisationPermission("tenant.escape")).toBe(false);
  });
});
