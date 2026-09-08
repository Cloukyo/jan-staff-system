import { describe, expect, it } from "vitest";
import {
  deriveRecruitmentReadiness,
  type RecruitmentReadinessInput,
} from "@/lib/compliance/recruitment-readiness";

const verifiedEmployee: RecruitmentReadinessInput = {
  active: true,
  engagementType: "employee",
  proposedStartDate: "2026-09-01",
  dbsRequirement: "required",
  dbsCheckLevel: "enhanced_childrens_barred_list",
  dbsStatus: "verified",
  dbsCertificateReceivedDate: "2026-09-01",
  dbsReceiptConfirmed: true,
  dbsRecorded: true,
  dbsVerifiedAt: "2026-09-02T09:00:00+01:00",
  hasFullDbsReference: true,
  suitabilityStatus: "suitable",
  suitabilityDecidedAt: "2026-09-02T09:05:00+01:00",
  startAuthorisedAt: "2026-09-02T09:10:00+01:00",
  volunteerException: null,
};

describe("nursery recruitment readiness", () => {
  it("allows a verified suitable employee to start", () => {
    expect(deriveRecruitmentReadiness(verifiedEmployee, "2026-09-04")).toMatchObject({
      status: "ready",
      mayStartWork: true,
      blockerCodes: [],
    });
  });

  it("blocks a required check until the certificate is received and verified", () => {
    expect(deriveRecruitmentReadiness({
      ...verifiedEmployee,
      dbsStatus: "application_submitted",
      dbsCertificateReceivedDate: null,
      dbsVerifiedAt: null,
      hasFullDbsReference: false,
      startAuthorisedAt: null,
    }, "2026-09-10")).toMatchObject({
      status: "blocked",
      mayStartWork: false,
      blockerCodes: expect.arrayContaining(["dbs_not_verified", "start_not_authorised"]),
    });
  });

  it("does not infer DBS eligibility from employee or volunteer classification alone", () => {
    const result = deriveRecruitmentReadiness({
      ...verifiedEmployee,
      engagementType: "volunteer",
      dbsRequirement: "assessment_needed",
      dbsStatus: "not_started",
      dbsCertificateReceivedDate: null,
      dbsVerifiedAt: null,
      hasFullDbsReference: false,
      suitabilityStatus: "not_assessed",
      suitabilityDecidedAt: null,
      startAuthorisedAt: null,
    }, "2026-09-04");
    expect(result.mayStartWork).toBe(false);
    expect(result.blockerCodes).toContain("dbs_assessment_required");
  });

  it("permits only an explicitly recorded occasional supervised volunteer exception", () => {
    expect(deriveRecruitmentReadiness({
      ...verifiedEmployee,
      engagementType: "volunteer",
      dbsRequirement: "not_required",
      dbsCheckLevel: null,
      dbsStatus: "not_required",
      dbsCertificateReceivedDate: null,
      dbsVerifiedAt: null,
      hasFullDbsReference: false,
      volunteerException: "occasional_supervised",
    }, "2026-09-04")).toMatchObject({
      status: "ready",
      mayStartWork: true,
      restrictionCodes: ["supervision_required"],
    });

    expect(deriveRecruitmentReadiness({
      ...verifiedEmployee,
      engagementType: "volunteer",
      dbsRequirement: "not_required",
      dbsCheckLevel: null,
      dbsStatus: "not_required",
      dbsCertificateReceivedDate: null,
      dbsVerifiedAt: null,
      hasFullDbsReference: false,
      volunteerException: null,
    }, "2026-09-04").mayStartWork).toBe(false);
  });

  it("keeps inactive historic staff informational rather than falsely ready", () => {
    expect(deriveRecruitmentReadiness({ ...verifiedEmployee, active: false }, "2026-09-04")).toMatchObject({
      status: "information",
      mayStartWork: false,
    });
  });
});
