import { describe, expect, it } from "vitest";
import { complianceDashboardCounts } from "@/lib/calculations/compliance";
import {
  getCompliancePack,
  getCompliancePackForIndustry,
} from "@/lib/compliance/modules";
import type { StaffProfile } from "@/types";

const staff: StaffProfile[] = [{
  id: "staff-1",
  fullName: "Example Person",
  displayName: "Example",
  employmentRole: "Example role",
  mainQualificationLevel: null,
  isApprentice: false,
  isCoverStaff: false,
  appointmentDate: null,
  active: true,
  authUserId: null,
  email: null,
  notes: null,
  createdAt: "x",
  updatedAt: "x",
}];

describe("compliance modules", () => {
  it("selects an optional default pack for every approved industry profile", () => {
    expect(getCompliancePackForIndustry("nursery").id).toBe("early_years_uk");
    expect(getCompliancePackForIndustry("care_home").id).toBe("care_uk");
    expect(getCompliancePackForIndustry("tuition_centre").id).toBe("education_safeguarding_uk");
    expect(getCompliancePackForIndustry("clinic").id).toBe("clinical_uk");
  });

  it("keeps nursery checks in its pack instead of universal core logic", () => {
    expect(getCompliancePack("early_years_uk").requirements.map((item) => item.label)).toEqual([
      "Paediatric First Aid",
      "Safeguarding",
      "DBS",
      "Central record",
    ]);
    expect(getCompliancePack("clinical_uk").requirements.map((item) => item.label)).toEqual([
      "Basic Life Support",
      "Professional registration",
    ]);
  });

  it("calculates missing requirements from the selected pack", () => {
    const nursery = complianceDashboardCounts(staff, [], [], new Date("2026-06-10T12:00:00+01:00"), [], getCompliancePack("early_years_uk"));
    const clinic = complianceDashboardCounts(staff, [], [], new Date("2026-06-10T12:00:00+01:00"), [], getCompliancePack("clinical_uk"));
    expect(nursery.missingRequirements).toEqual({
      paediatric_first_aid: 1,
      safeguarding: 1,
      dbs: 1,
      central_record: 1,
    });
    expect(clinic.missingRequirements).toEqual({
      basic_life_support: 1,
      professional_registration: 1,
    });
    expect(clinic.missingSafeguarding).toBe(0);
    expect(clinic.incompleteCentralRecords).toBe(0);
  });
});
