import { getIndustryProfile, type IndustryProfileId } from "@/lib/platform/industry-profile";

export type CompliancePackId =
  | "early_years_uk"
  | "care_uk"
  | "education_safeguarding_uk"
  | "clinical_uk";

export const CORE_COMPLIANCE_CAPABILITIES = [
  "qualifications",
  "credentials",
  "requirements",
  "documents",
] as const;

export type CoreComplianceCapability = (typeof CORE_COMPLIANCE_CAPABILITIES)[number];

export type ComplianceRequirement = {
  id: string;
  label: string;
  kind: "certificate" | "dbs" | "central_record";
  certificateKeywords?: readonly string[];
};

export type CompliancePack = {
  id: CompliancePackId;
  industry: IndustryProfileId;
  displayName: string;
  requirements: readonly ComplianceRequirement[];
};

const packs: Record<CompliancePackId, CompliancePack> = {
  early_years_uk: {
    id: "early_years_uk",
    industry: "nursery",
    displayName: "Early Years UK",
    requirements: [
      { id: "paediatric_first_aid", label: "Paediatric First Aid", kind: "certificate", certificateKeywords: ["paediatric first aid", "first aid"] },
      { id: "safeguarding", label: "Safeguarding", kind: "certificate", certificateKeywords: ["safeguarding"] },
      { id: "dbs", label: "DBS", kind: "dbs" },
      { id: "central_record", label: "Central record", kind: "central_record" },
    ],
  },
  care_uk: {
    id: "care_uk",
    industry: "care_home",
    displayName: "Care UK",
    requirements: [
      { id: "first_aid", label: "First Aid", kind: "certificate", certificateKeywords: ["first aid"] },
      { id: "moving_handling", label: "Moving and Handling", kind: "certificate", certificateKeywords: ["moving and handling"] },
      { id: "dbs", label: "DBS", kind: "dbs" },
    ],
  },
  education_safeguarding_uk: {
    id: "education_safeguarding_uk",
    industry: "tuition_centre",
    displayName: "Education Safeguarding UK",
    requirements: [
      { id: "safeguarding", label: "Safeguarding", kind: "certificate", certificateKeywords: ["safeguarding"] },
      { id: "dbs", label: "DBS", kind: "dbs" },
    ],
  },
  clinical_uk: {
    id: "clinical_uk",
    industry: "clinic",
    displayName: "Clinical UK",
    requirements: [
      { id: "basic_life_support", label: "Basic Life Support", kind: "certificate", certificateKeywords: ["basic life support", "bls"] },
      { id: "professional_registration", label: "Professional registration", kind: "certificate", certificateKeywords: ["professional registration", "gmc", "nmc", "hcpc"] },
    ],
  },
};

export function getCompliancePack(id: CompliancePackId): CompliancePack {
  return packs[id];
}

export function getCompliancePackForIndustry(profileId: IndustryProfileId): CompliancePack {
  return getCompliancePack(getIndustryProfile(profileId).defaultCompliancePackId);
}
