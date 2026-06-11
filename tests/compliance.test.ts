import { describe, expect, it } from "vitest";
import type { StaffCertificate, StaffCentralRecord, StaffProfile } from "@/types";
import { activeComplianceRecords, canEditCompliance, centralRecordCompletion, certificateStatus, complianceDashboardCounts, maskDbsNumber, parseUkDateForImport } from "@/lib/calculations/compliance";

function certificate(expiryDate: string | null, overrides: Partial<StaffCertificate> = {}): StaffCertificate {
  return {
    id: `cert-${expiryDate ?? "none"}`,
    staffId: "staff-1",
    certificateType: "Paediatric First Aid",
    customTitle: null,
    completionDate: "2026-01-01",
    expiryDate,
    validityMonths: null,
    permanent: false,
    evidenceStatus: "verified",
    evidenceReference: "private evidence reference",
    notes: null,
    verifiedBy: "manager",
    verifiedAt: "2026-01-02T09:00:00+00:00",
    archivedAt: null,
    createdAt: "2026-01-01T09:00:00+00:00",
    updatedAt: "2026-01-01T09:00:00+00:00",
    ...overrides,
  };
}

const today = new Date("2026-06-10T12:00:00+01:00");

describe("certificate status calculations", () => {
  it("calculates expiry bands around 30, 60 and 90 days", () => {
    expect(certificateStatus(certificate("2026-06-09"), today)).toBe("expired");
    expect(certificateStatus(certificate("2026-07-10"), today)).toBe("expiring_30");
    expect(certificateStatus(certificate("2026-08-09"), today)).toBe("expiring_60");
    expect(certificateStatus(certificate("2026-09-08"), today)).toBe("expiring_90");
    expect(certificateStatus(certificate("2026-09-09"), today)).toBe("valid");
  });

  it("does not mark permanent or no-expiry records as expired", () => {
    expect(certificateStatus(certificate(null, { permanent: true }), today)).toBe("no_expiry");
    expect(certificateStatus(certificate(null), today)).toBe("no_expiry");
  });

  it("flags missing evidence when no completion evidence exists", () => {
    expect(certificateStatus(certificate(null, { completionDate: null, evidenceReference: null }), today)).toBe("awaiting_evidence");
  });
});

describe("central records and import review helpers", () => {
  it("calculates central-record completion", () => {
    const record = { appointmentInductionCompleted: true, contractForm: true, idChecked: false } as Partial<StaffCentralRecord>;
    expect(centralRecordCompletion(record)).toEqual({ completed: 2, total: 11, percent: 18 });
  });

  it("flags invalid source dates such as 31/04/22", () => {
    expect(parseUkDateForImport("31/04/22").warning).toContain("Invalid calendar date");
    expect(parseUkDateForImport("10/06/2026")).toEqual({ isoDate: "2026-06-10", warning: null });
  });

  it("counts compliance dashboard alerts", () => {
    const staff: StaffProfile[] = [
      { id: "staff-1", fullName: "Example One", displayName: "Example", employmentRole: "Practitioner", mainQualificationLevel: "Level 3", isApprentice: false, isCoverStaff: false, appointmentDate: null, active: true, authUserId: null, email: null, notes: null, createdAt: "x", updatedAt: "x" },
    ];
    const counts = complianceDashboardCounts(staff, [certificate("2026-06-09")], [], today);
    expect(counts.expired).toBe(1);
    expect(counts.missingSafeguarding).toBe(1);
    expect(counts.incompleteCentralRecords).toBe(1);
  });

  it("recalculates dashboard counts after a certificate expiry edit", () => {
    const staff: StaffProfile[] = [
      { id: "staff-1", fullName: "Example One", displayName: "Example", employmentRole: "Practitioner", mainQualificationLevel: "Level 3", isApprentice: false, isCoverStaff: false, appointmentDate: null, active: true, authUserId: null, email: null, notes: null, createdAt: "x", updatedAt: "x" },
    ];
    expect(complianceDashboardCounts(staff, [certificate("2026-06-09")], [], today).expired).toBe(1);
    expect(complianceDashboardCounts(staff, [certificate("2026-09-09")], [], today).expired).toBe(0);
  });

  it("excludes archived records from active compliance lists", () => {
    expect(activeComplianceRecords([certificate("2026-06-09"), certificate("2026-06-10", { archivedAt: "2026-06-11" })])).toHaveLength(1);
  });

  it("masks sensitive DBS values", () => {
    expect(maskDbsNumber("001234567890")).toBe("****7890");
    expect(maskDbsNumber(null)).toBe("Not recorded");
  });

  it("allows managers but not staff to edit compliance records", () => {
    expect(canEditCompliance("manager")).toBe(true);
    expect(canEditCompliance("staff")).toBe(false);
    expect(canEditCompliance(null)).toBe(false);
  });
});
