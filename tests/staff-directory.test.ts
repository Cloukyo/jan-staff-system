import { describe, expect, it } from "vitest";
import { highestPrioritySetupWarning } from "@/components/staff/production-staff-screen";
import { toStaffDirectoryRows } from "@/lib/payroll/server";
import type { ProductionStaffRow } from "@/lib/payroll/types";

const baseStaff: ProductionStaffRow = {
  id: "staff-1",
  fullName: "Aisha Khan",
  displayName: "Aisha",
  employmentRole: "Nursery practitioner",
  mainQualificationLevel: "Level 3",
  active: true,
  loginStatus: "Active login",
  kioskStatus: "Enabled",
  isManager: false,
  payArrangements: [{
    id: "pay-1",
    staffId: "staff-1",
    payType: "hourly",
    hourlyRate: 88.99,
    annualSalary: null,
    monthlySalary: null,
    contractedWeeklyHours: 35,
    hoursBasis: "contracted",
    standardDailyHours: 7,
    overtimeMultiplier: 1.5,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    isActive: true,
    managerNotes: "Private manager note",
    createdByName: "Nursery manager",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
  }],
};

describe("staff directory payload", () => {
  it("returns only operational fields and setup booleans", () => {
    const rows = toStaffDirectoryRows([baseStaff], "2026-07-27");

    expect(rows).toEqual([{
      id: "staff-1",
      fullName: "Aisha Khan",
      displayName: "Aisha",
      employmentRole: "Nursery practitioner",
      active: true,
      loginStatus: "Active login",
      kioskStatus: "Enabled",
      hasQualification: true,
      hasCurrentPayArrangement: true,
    }]);
    expect(JSON.stringify(rows)).not.toContain("Private manager note");
    expect(JSON.stringify(rows)).not.toContain("88.99");
  });

  it("treats both effective-date boundaries as current", () => {
    const onStart = {
      ...baseStaff,
      id: "on-start",
      payArrangements: [{
        ...baseStaff.payArrangements[0],
        staffId: "on-start",
        effectiveFrom: "2026-07-27",
        effectiveTo: "2026-08-10",
      }],
    };
    const onEnd = {
      ...baseStaff,
      id: "on-end",
      payArrangements: [{
        ...baseStaff.payArrangements[0],
        staffId: "on-end",
        effectiveFrom: "2026-07-01",
        effectiveTo: "2026-07-27",
      }],
    };

    const rows = toStaffDirectoryRows([onStart, onEnd], "2026-07-27");

    expect(rows.map((row) => row.hasCurrentPayArrangement)).toEqual([true, true]);
  });

  it("does not treat expired or future arrangements as current", () => {
    const expired = {
      ...baseStaff,
      id: "expired",
      payArrangements: [{
        ...baseStaff.payArrangements[0],
        staffId: "expired",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2026-07-26",
      }],
    };
    const future = {
      ...baseStaff,
      id: "future",
      payArrangements: [{
        ...baseStaff.payArrangements[0],
        staffId: "future",
        effectiveFrom: "2026-07-28",
        effectiveTo: null,
      }],
    };

    const rows = toStaffDirectoryRows([expired, future], "2026-07-27");

    expect(rows.map((row) => row.hasCurrentPayArrangement)).toEqual([false, false]);
    expect(rows.map(highestPrioritySetupWarning)).toEqual(["Add pay details", "Add pay details"]);
  });
});
