import { describe, expect, it } from "vitest";
import { previewStaffImport } from "@/lib/customer-domain/imports";

describe("commercial staff import preview", () => {
  const context = {
    organisationId: "org-a",
    targetSiteId: "site-a",
  };

  it("normalises valid staff and assignment commands without committing data", () => {
    const result = previewStaffImport(context, [{
      sourceRow: "2",
      externalKey: "EMP-001",
      fullName: "  Alex Example ",
      displayName: " Alex ",
      employmentRole: " Tutor ",
      siteId: "site-a",
      effectiveFrom: "2026-09-01",
      primarySite: true,
      email: " ALEX@EXAMPLE.TEST ",
    }]);

    expect(result.valid).toBe(true);
    expect(result.rows[0]).toMatchObject({
      sourceRow: "2",
      externalKey: "EMP-001",
      fullName: "Alex Example",
      displayName: "Alex",
      employmentRole: "Tutor",
      organisationId: "org-a",
      siteId: "site-a",
      email: "alex@example.test",
    });
    expect(result.rows[0]).not.toHaveProperty("staffId");
  });

  it("rejects duplicate keys, invalid dates and sites outside the organisation context", () => {
    const result = previewStaffImport(context, [
      { sourceRow: "2", externalKey: "EMP-001", fullName: "Alex Example", employmentRole: "Tutor", siteId: "site-x", effectiveFrom: "not-a-date" },
      { sourceRow: "3", externalKey: "EMP-001", fullName: "Jo Example", employmentRole: "Tutor", siteId: "site-a", effectiveFrom: "2026-09-01" },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { sourceRow: "2", code: "site_not_permitted", field: "siteId" },
      { sourceRow: "2", code: "invalid_date", field: "effectiveFrom" },
      { sourceRow: "3", code: "duplicate_external_key", field: "externalKey" },
    ]);
  });

  it("rejects impossible calendar dates without promising database-generated staff IDs", () => {
    const result = previewStaffImport(context, [
      { sourceRow: "2", externalKey: "EMP 1", fullName: "One Example", employmentRole: "Tutor", siteId: "site-a", effectiveFrom: "2026-02-30" },
      { sourceRow: "3", externalKey: "EMP-1", fullName: "Two Example", employmentRole: "Tutor", siteId: "site-a", effectiveFrom: "2026-09-01" },
    ]);
    expect(result.errors).toContainEqual({ sourceRow: "2", code: "invalid_date", field: "effectiveFrom" });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => !("staffId" in row))).toBe(true);
  });

  it("rejects duplicate normalised emails within one target-site batch", () => {
    const result = previewStaffImport(context, [
      { sourceRow: "2", externalKey: "EMP-101", fullName: "One Example", employmentRole: "Tutor", siteId: "site-a", effectiveFrom: "2026-09-01", email: "same@example.test" },
      { sourceRow: "3", externalKey: "EMP-102", fullName: "Two Example", employmentRole: "Tutor", siteId: "site-a", effectiveFrom: "2026-09-01", email: " SAME@EXAMPLE.TEST " },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ sourceRow: "3", code: "duplicate_email", field: "email" });
  });
});
