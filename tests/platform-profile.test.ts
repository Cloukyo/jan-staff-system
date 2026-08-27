import { describe, expect, it } from "vitest";
import { getPlatformBranding } from "@/lib/platform/branding";
import {
  getActiveIndustryProfile,
  getIndustryProfile,
  industryProfileIds,
} from "@/lib/platform/industry-profile";

describe("platform branding", () => {
  it("uses neutral placeholders until a commercial identity is configured", () => {
    expect(getPlatformBranding({} as NodeJS.ProcessEnv)).toEqual({
      productName: "Workforce Operations Platform",
      productShortName: "Workforce Platform",
      productLogoPath: null,
      organisationDisplayName: "Organisation",
      siteDisplayName: "Site",
      serviceIdentifier: "workforce-platform",
    });
  });

  it("accepts configured product and deployment display values", () => {
    expect(getPlatformBranding({
      NEXT_PUBLIC_PRODUCT_NAME: "Example Product",
      NEXT_PUBLIC_PRODUCT_SHORT_NAME: "Example",
      NEXT_PUBLIC_PRODUCT_LOGO_PATH: "/brand/example.svg",
      NEXT_PUBLIC_ORGANISATION_DISPLAY_NAME: "Example Group",
      NEXT_PUBLIC_SITE_DISPLAY_NAME: "North Site",
      PLATFORM_SERVICE_IDENTIFIER: "example-workforce",
    } as unknown as NodeJS.ProcessEnv)).toMatchObject({
      productName: "Example Product",
      productShortName: "Example",
      productLogoPath: "/brand/example.svg",
      organisationDisplayName: "Example Group",
      siteDisplayName: "North Site",
      serviceIdentifier: "example-workforce",
    });
  });
});

describe("industry profiles", () => {
  it("supports the four approved presentation profiles", () => {
    expect(industryProfileIds).toEqual([
      "nursery",
      "care_home",
      "tuition_centre",
      "clinic",
    ]);
    expect(getIndustryProfile("nursery")).toMatchObject({
      workAreaSingular: "Room",
      defaultCompliancePackId: "early_years_uk",
      defaultRoleLabels: ["Nursery Practitioner", "Room Leader", "Manager"],
    });
    expect(getIndustryProfile("care_home")).toMatchObject({
      workAreaSingular: "Unit",
      defaultCompliancePackId: "care_uk",
    });
    expect(getIndustryProfile("tuition_centre")).toMatchObject({
      workAreaSingular: "Classroom",
      defaultCompliancePackId: "education_safeguarding_uk",
    });
    expect(getIndustryProfile("clinic")).toMatchObject({
      workAreaSingular: "Department",
      defaultCompliancePackId: "clinical_uk",
    });
  });

  it("uses the nursery profile only as an explicit compatibility default", () => {
    expect(getIndustryProfile("unknown").id).toBe("nursery");
    expect(getActiveIndustryProfile({} as NodeJS.ProcessEnv).id).toBe("nursery");
    expect(getActiveIndustryProfile({ NEXT_PUBLIC_INDUSTRY_PROFILE: "clinic" } as unknown as NodeJS.ProcessEnv).id).toBe("clinic");
  });
});
