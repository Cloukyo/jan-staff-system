import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  staffDirectoryCounts,
  staffDirectoryPriority,
} from "@/lib/staff/presentation";
import type { StaffDirectoryRow } from "@/lib/payroll/types";

function person(overrides: Partial<StaffDirectoryRow> = {}): StaffDirectoryRow {
  return {
    id: "staff-1",
    fullName: "Alex Example",
    displayName: "Alex",
    employmentRole: "Practitioner",
    active: true,
    kioskStatus: "Enabled",
    loginStatus: "Login linked",
    hasQualification: true,
    hasCurrentPayArrangement: true,
    hasComplianceIssues: false,
    ...overrides,
  };
}

describe("staff directory UX presentation", () => {
  it("counts each actionable directory view independently", () => {
    const rows = [
      person(),
      person({ id: "staff-2", kioskStatus: "PIN setup needed" }),
      person({ id: "staff-3", hasComplianceIssues: true }),
      person({ id: "staff-4", active: false }),
    ];

    expect(staffDirectoryCounts(rows)).toEqual({
      active: 3,
      "needs-setup": 1,
      "needs-checks": 1,
      inactive: 1,
    });
  });

  it("prioritises checks before setup and keeps inactive records neutral", () => {
    expect(staffDirectoryPriority(person({ hasComplianceIssues: true }))).toEqual({
      label: "Checks need attention",
      detail: "Review recruitment, checks or training evidence.",
      tone: "red",
    });
    expect(staffDirectoryPriority(person({ kioskStatus: "PIN setup needed" }))).toEqual({
      label: "Clocking-in setup needed",
      detail: "Set a Staff Clock PIN from this staff record.",
      tone: "amber",
    });
    expect(staffDirectoryPriority(person({ active: false }))).toEqual({
      label: "Inactive record",
      detail: "Historical records remain preserved.",
      tone: "grey",
    });
  });

  it("exposes workload counts and responsive record context", () => {
    const screen = readFileSync(resolve("src/components/staff/production-staff-screen.tsx"), "utf8");
    const form = readFileSync(resolve("src/components/staff/add-staff-form.tsx"), "utf8");

    expect(screen).toContain("staffDirectoryCounts");
    expect(screen).toContain('aria-live="polite"');
    expect(screen).toContain("Staff needing action");
    expect(screen).toContain("Open staff record");
    expect(form).toContain("Employment details");
    expect(form).toContain("Operational status");
  });
});
