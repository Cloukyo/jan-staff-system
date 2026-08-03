import { describe, expect, it } from "vitest";
import * as staffDirectory from "@/components/staff/production-staff-screen";
import * as complianceCalculations from "@/lib/calculations/compliance";
import { toStaffDirectoryRows } from "@/lib/payroll/server";
import type { ComplianceDataset } from "@/lib/compliance/repository";
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
      hasComplianceIssues: false,
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
    expect(rows.map(staffDirectory.highestPrioritySetupWarning)).toEqual(["Add pay details", "Add pay details"]);
  });

  it("derives a minimal compliance flag for expired training and incomplete central records", () => {
    const staffIdsNeedingComplianceChecks = (
      complianceCalculations as unknown as {
        staffIdsNeedingComplianceChecks: (
          dataset: ComplianceDataset,
          today: Date,
        ) => Set<string>;
      }
    ).staffIdsNeedingComplianceChecks;
    expect(typeof staffIdsNeedingComplianceChecks).toBe("function");

    const completeItems = Array.from({ length: 12 }, (_, index) => ({
      id: `item-${index}`,
      staffId: "expired-training",
      itemKey: `item-${index}`,
      status: "complete",
      checkedAt: null,
      checkedBy: null,
      notes: null,
    }));
    const dataset = {
      staff: [
        { id: "expired-training", active: true },
        { id: "incomplete-record", active: true },
        { id: "unverified-evidence", active: true },
      ],
      qualifications: [{
        id: "qualification-evidence",
        staffId: "unverified-evidence",
        evidenceReference: "qualification.pdf",
        verifiedAt: null,
        archivedAt: null,
      }],
      certificates: [
        {
          id: "first-aid",
          staffId: "expired-training",
          certificateType: "Paediatric first aid",
          customTitle: null,
          completionDate: "2025-01-01",
          expiryDate: "2026-07-26",
          permanent: false,
          evidenceReference: "first-aid.pdf",
          verifiedAt: "2025-01-02T09:00:00.000Z",
          archivedAt: null,
        },
        {
          id: "safeguarding",
          staffId: "expired-training",
          certificateType: "Safeguarding",
          customTitle: null,
          completionDate: "2026-01-01",
          expiryDate: "2027-01-01",
          permanent: false,
          evidenceReference: "safeguarding.pdf",
          verifiedAt: "2026-01-02T09:00:00.000Z",
          archivedAt: null,
        },
        {
          id: "first-aid-current",
          staffId: "incomplete-record",
          certificateType: "Paediatric first aid",
          customTitle: null,
          completionDate: "2026-01-01",
          expiryDate: "2027-01-01",
          permanent: false,
          evidenceReference: "first-aid-current.pdf",
          verifiedAt: "2026-01-02T09:00:00.000Z",
          archivedAt: null,
        },
        {
          id: "safeguarding-current",
          staffId: "incomplete-record",
          certificateType: "Safeguarding",
          customTitle: null,
          completionDate: "2026-01-01",
          expiryDate: "2027-01-01",
          permanent: false,
          evidenceReference: "safeguarding-current.pdf",
          verifiedAt: "2026-01-02T09:00:00.000Z",
          archivedAt: null,
        },
        {
          id: "first-aid-evidence",
          staffId: "unverified-evidence",
          certificateType: "Paediatric first aid",
          customTitle: null,
          completionDate: "2026-01-01",
          expiryDate: "2027-01-01",
          permanent: false,
          evidenceReference: "first-aid-evidence.pdf",
          verifiedAt: "2026-01-02T09:00:00.000Z",
          archivedAt: null,
        },
        {
          id: "safeguarding-evidence",
          staffId: "unverified-evidence",
          certificateType: "Safeguarding",
          customTitle: null,
          completionDate: "2026-01-01",
          expiryDate: "2027-01-01",
          permanent: false,
          evidenceReference: "safeguarding-evidence.pdf",
          verifiedAt: "2026-01-02T09:00:00.000Z",
          archivedAt: null,
        },
      ],
      centralRecords: [],
      references: [],
      importWarnings: [],
      accounts: [],
      centralItems: [
        ...completeItems,
        ...completeItems.map((item, index) => ({
          ...item,
          id: `evidence-item-${index}`,
          staffId: "unverified-evidence",
        })),
      ],
    } as unknown as ComplianceDataset;

    const result = staffIdsNeedingComplianceChecks(
      dataset,
      new Date("2026-07-27T12:00:00.000Z"),
    );

    expect([...result]).toEqual([
      "expired-training",
      "incomplete-record",
      "unverified-evidence",
    ]);
  });

  it("filters compliance checks separately from general setup", () => {
    const filterStaffDirectoryRows = (
      staffDirectory as unknown as {
        filterStaffDirectoryRows: (
          rows: Array<Record<string, unknown>>,
          filter: string,
          query?: string,
        ) => Array<Record<string, unknown>>;
      }
    ).filterStaffDirectoryRows;
    expect(typeof filterStaffDirectoryRows).toBe("function");

    const completeButExpired = {
      ...toStaffDirectoryRows([baseStaff], "2026-07-27")[0],
      hasComplianceIssues: true,
    };
    const setupOnly = {
      ...completeButExpired,
      id: "setup-only",
      hasComplianceIssues: false,
      kioskStatus: "PIN setup needed",
    };

    expect(
      filterStaffDirectoryRows(
        [completeButExpired, setupOnly],
        "needs-checks",
      ).map((row) => row.id),
    ).toEqual(["staff-1"]);
    expect(
      filterStaffDirectoryRows(
        [completeButExpired, setupOnly],
        "needs-setup",
      ).map((row) => row.id),
    ).toEqual(["setup-only"]);
  });
});
