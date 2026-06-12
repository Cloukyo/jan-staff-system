import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { londonDateStartUtc } from "@/lib/dates/format";
import { arrangementAt, arrangementsForPeriod, calculateClockTotals, createPayrollPreparationRow } from "@/lib/payroll/calculations";
import { payrollRepositorySource } from "@/lib/payroll/server";
import type { PayArrangement, ProductionStaffRow } from "@/lib/payroll/types";

const hourly: PayArrangement = {
  id: "pay-1", staffId: "staff-1", payType: "hourly", hourlyRate: 12, annualSalary: null, monthlySalary: null,
  contractedWeeklyHours: 35, standardDailyHours: 7, overtimeMultiplier: 1.5, effectiveFrom: "2026-05-01",
  effectiveTo: null, isActive: true, managerNotes: null, createdAt: "2026-05-01", updatedAt: "2026-05-01",
};
const staff: ProductionStaffRow = {
  id: "staff-1", fullName: "Canonical Staff", displayName: "Canonical", employmentRole: "Practitioner",
  mainQualificationLevel: null, active: true, loginStatus: "No login", kioskStatus: "Enabled", isManager: false,
  payArrangements: [hourly],
};

describe("production payroll repository separation", () => {
  it("uses Supabase in production and demo data only in explicit demo mode", () => {
    expect(payrollRepositorySource("production")).toBe("supabase");
    expect(payrollRepositorySource("demo")).toBe("demo");
  });

  it("does not route production staff or payroll directly to the prototype", () => {
    const staffPage = readFileSync(resolve("src/app/staff/page.tsx"), "utf8");
    const payrollPage = readFileSync(resolve("src/app/payroll/page.tsx"), "utf8");
    expect(staffPage).toContain("loadProductionStaffRows");
    expect(payrollPage).toContain("loadProductionClockEvents");
    expect(payrollPage).toContain("!person.isManager");
    expect(staffPage).toContain('getAppMode() === "demo"');
    expect(payrollPage).toContain('getAppMode() === "demo"');
  });
});

describe("London pay-period boundaries", () => {
  it("uses GMT and BST correctly", () => {
    expect(londonDateStartUtc("2026-01-15").toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(londonDateStartUtc("2026-06-15").toISOString()).toBe("2026-06-14T23:00:00.000Z");
  });
});

describe("effective-dated pay arrangements", () => {
  it("selects the correct arrangement and detects changes in a period", () => {
    const older = { ...hourly, id: "old", effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31" };
    const newer = { ...hourly, id: "new", hourlyRate: 13, effectiveFrom: "2026-06-01" };
    expect(arrangementAt([older, newer], "2026-05-20")?.id).toBe("old");
    expect(arrangementAt([older, newer], "2026-06-20")?.id).toBe("new");
    expect(arrangementsForPeriod([older, newer], "2026-05-01", "2026-06-30")).toHaveLength(2);
  });

  it("schema rejects overlaps and restricts payroll to managers", () => {
    const migration = readFileSync(resolve("supabase/migrations/202606120001_payroll_arrangements.sql"), "utf8");
    expect(migration).toContain("staff_pay_arrangements_no_overlap");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("current_staff_role() = 'manager'");
    expect(migration).toContain("revoke all on public.staff_pay_arrangements from anon");
  });
});

describe("production payroll preparation", () => {
  it("pairs clock events, flags invalid sequences and distinguishes corrections", () => {
    const result = calculateClockTotals([
      { id: "1", staffId: "staff-1", eventType: "clock_in", eventTimestamp: "2026-06-01T08:00:00Z", managerCorrection: false },
      { id: "2", staffId: "staff-1", eventType: "clock_out", eventTimestamp: "2026-06-01T16:00:00Z", managerCorrection: true },
    ]);
    expect(result.recordedMinutes).toBe(480);
    expect(result.warnings).toContain("Manager correction");
  });

  it("calculates hourly pay but keeps salaried attendance informational", () => {
    const events = [
      { id: "1", staffId: "staff-1", eventType: "clock_in" as const, eventTimestamp: "2026-06-01T08:00:00Z", managerCorrection: false },
      { id: "2", staffId: "staff-1", eventType: "clock_out" as const, eventTimestamp: "2026-06-01T16:00:00Z", managerCorrection: false },
    ];
    const hourlyRow = createPayrollPreparationRow(staff, events, "2026-06-01", "2026-06-07");
    expect(hourlyRow.estimatedGross).toBe(96);
    const salariedStaff = { ...staff, payArrangements: [{ ...hourly, payType: "salaried" as const, hourlyRate: null, annualSalary: 30000 }] };
    const salariedRow = createPayrollPreparationRow(salariedStaff, events, "2026-06-01", "2026-06-07");
    expect(salariedRow.estimatedGross).toBeNull();
    expect(salariedRow.salaryBasis).not.toBeNull();
  });

  it("warns when a canonical profile has no pay arrangement", () => {
    const row = createPayrollPreparationRow({ ...staff, payArrangements: [] }, [], "2026-06-01", "2026-06-30");
    expect(row.warnings).toContain("Missing active pay arrangement");
    expect(row.warnings).toContain("Zero recorded hours");
  });
});
