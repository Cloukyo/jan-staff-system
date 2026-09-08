import { describe, expect, it } from "vitest";
import { deriveRecruitmentReadiness, type RecruitmentReadinessInput } from "@/lib/compliance/recruitment-readiness";

export const confirmedEmployee = {
  active: true, engagementType: "employee", proposedStartDate: "2020-01-01",
  dbsRequirement: "required", dbsCheckLevel: "enhanced_childrens_barred_list", dbsStatus: "verified",
  dbsCertificateReceivedDate: "2026-09-20", dbsReceiptConfirmed: true, dbsRecorded: true,
  dbsVerifiedAt: "2026-09-01T09:00:00Z", hasFullDbsReference: true,
  suitabilityStatus: "suitable", suitabilityDecidedAt: "2026-09-01T09:00:00Z",
  startAuthorisedAt: "2026-09-01T09:00:00Z", volunteerException: null,
} satisfies RecruitmentReadinessInput & { dbsReceiptConfirmed: boolean; dbsRecorded: boolean };

describe("authoritative recruitment calendar dates", () => {
  for (const engagementType of ["employee", "volunteer"] as const) {
    it.each([["2026-09-19", false], ["2026-09-20", true], ["2026-09-21", true]] as const)(`${engagementType}: receipt compared with %s`, (workDate, expected) => {
      expect(deriveRecruitmentReadiness({ ...confirmedEmployee, engagementType }, workDate).mayStartWork).toBe(expected);
    });
    it.each([["2026-09-19", false], ["2026-09-20", true], ["2026-09-21", true]] as const)(`${engagementType}: authorisation compared with %s`, (workDate, expected) => {
      expect(deriveRecruitmentReadiness({ ...confirmedEmployee, engagementType,
        dbsCertificateReceivedDate: "2026-09-01", startAuthorisedAt: "2026-09-20T18:00:00+01:00",
      }, workDate).mayStartWork).toBe(expected);
    });
  }

  it("distinguishes future evidence from missing evidence", () => {
    expect(deriveRecruitmentReadiness(confirmedEmployee, "2026-09-10")).toMatchObject({
      mayStartWork: false, evidenceState: "future_effective", blockerCodes: expect.arrayContaining(["dbs_receipt_future_effective"]),
    });
    expect(deriveRecruitmentReadiness({ ...confirmedEmployee, dbsCertificateReceivedDate: null, startAuthorisedAt: null }, "2026-09-20"))
      .toMatchObject({ mayStartWork: false, evidenceState: "missing" });
  });

  it("never infers receipt confirmation from a populated or verified date", () => {
    expect(deriveRecruitmentReadiness({ ...confirmedEmployee, dbsReceiptConfirmed: false }, "2026-09-21"))
      .toMatchObject({ mayStartWork: false, evidenceState: "receipt_unconfirmed", blockerCodes: expect.arrayContaining(["dbs_receipt_timing_unconfirmed"]) });
  });

  it("preserves legacy evidence but needs confirmation, not replacement DBS", () => {
    const legacy = { ...confirmedEmployee, dbsStatus: "legacy_recorded" as const, dbsCertificateReceivedDate: "2020-01-01", hasFullDbsReference: false, dbsVerifiedAt: null };
    expect(deriveRecruitmentReadiness({ ...legacy, dbsReceiptConfirmed: false }, "2026-09-21").mayStartWork).toBe(false);
    expect(deriveRecruitmentReadiness(legacy, "2026-09-21").mayStartWork).toBe(true);
    expect(deriveRecruitmentReadiness({ ...legacy, dbsRecorded: false }, "2026-09-21").mayStartWork).toBe(false);
    expect(deriveRecruitmentReadiness({ ...legacy, proposedStartDate: "2026-09-01" }, "2026-09-21").mayStartWork).toBe(false);
  });

  it("does not authorise a future appointment", () => {
    expect(deriveRecruitmentReadiness({ ...confirmedEmployee, proposedStartDate: "2026-10-01" }, "2026-09-21").mayStartWork).toBe(false);
  });

  it("retains only the explicit occasional supervised volunteer exception", () => {
    const exception = { ...confirmedEmployee, engagementType: "volunteer" as const, dbsRequirement: "not_required" as const,
      dbsStatus: "not_required" as const, dbsCertificateReceivedDate: null, dbsReceiptConfirmed: false, volunteerException: "occasional_supervised" as const };
    expect(deriveRecruitmentReadiness(exception, "2026-09-21")).toMatchObject({ mayStartWork: true, evidenceState: "permitted_exception", restrictionCodes: ["supervision_required"] });
    expect(deriveRecruitmentReadiness({ ...exception, engagementType: "employee" }, "2026-09-21").mayStartWork).toBe(false);
    expect(deriveRecruitmentReadiness({ ...exception, dbsStatus: "not_started" }, "2026-09-21").mayStartWork).toBe(false);
    expect(deriveRecruitmentReadiness({ ...exception, startAuthorisedAt: "2026-09-22T00:00:00Z" }, "2026-09-21").mayStartWork).toBe(false);
  });

  it.each([
    ["2026-09-19T22:59:59Z", "2026-09-19", true],
    ["2026-09-19T23:00:00Z", "2026-09-19", false],
    ["2026-09-19T23:00:00Z", "2026-09-20", true],
    ["2026-03-29T23:00:00Z", "2026-03-29", false],
    ["2026-03-29T23:00:00Z", "2026-03-30", true],
    ["2026-10-25T23:00:00Z", "2026-10-25", true],
    ["2026-12-19T23:00:00Z", "2026-12-19", true],
  ] as const)("London authorisation %s against %s", (timestamp, workDate, expected) => {
    expect(deriveRecruitmentReadiness({ ...confirmedEmployee, dbsCertificateReceivedDate: "2020-01-01",
      dbsVerifiedAt: "2020-01-01T00:00:00Z", suitabilityDecidedAt: "2020-01-01T00:00:00Z", startAuthorisedAt: timestamp,
    }, workDate).mayStartWork).toBe(expected);
  });
});
