export const industryProfileIds = [
  "nursery",
  "care_home",
  "tuition_centre",
  "clinic",
] as const;

export type IndustryProfileId = (typeof industryProfileIds)[number];

export type IndustryProfile = {
  id: IndustryProfileId;
  displayName: string;
  workAreaSingular: string;
  workAreaPlural: string;
  scheduleLabel: string;
  staffRoleLabel: string;
  clockingDeviceLabel: string;
  siteClosureLabel: string;
  defaultCompliancePackId:
    | "early_years_uk"
    | "care_uk"
    | "education_safeguarding_uk"
    | "clinical_uk";
  defaultRoleLabels: readonly string[];
  defaultWorkAreas: readonly string[];
  helpContext: string;
};

const profiles: Record<IndustryProfileId, IndustryProfile> = {
  nursery: {
    id: "nursery",
    displayName: "Nursery",
    workAreaSingular: "Room",
    workAreaPlural: "Rooms",
    scheduleLabel: "Rota",
    staffRoleLabel: "Job role",
    clockingDeviceLabel: "Clocking device",
    siteClosureLabel: "Nursery closure",
    defaultCompliancePackId: "early_years_uk",
    defaultRoleLabels: ["Nursery Practitioner", "Room Leader", "Manager"],
    defaultWorkAreas: ["Preschool room", "Nursery floor", "Office"],
    helpContext: "nursery",
  },
  care_home: {
    id: "care_home",
    displayName: "Care Home",
    workAreaSingular: "Unit",
    workAreaPlural: "Units",
    scheduleLabel: "Rota",
    staffRoleLabel: "Job role",
    clockingDeviceLabel: "Clocking device",
    siteClosureLabel: "Site closure",
    defaultCompliancePackId: "care_uk",
    defaultRoleLabels: ["Care Assistant", "Senior Carer", "Manager"],
    defaultWorkAreas: ["Residential unit", "Communal area", "Office"],
    helpContext: "care home",
  },
  tuition_centre: {
    id: "tuition_centre",
    displayName: "Tuition Centre",
    workAreaSingular: "Classroom",
    workAreaPlural: "Classrooms",
    scheduleLabel: "Timetable",
    staffRoleLabel: "Job role",
    clockingDeviceLabel: "Clocking device",
    siteClosureLabel: "Centre closure",
    defaultCompliancePackId: "education_safeguarding_uk",
    defaultRoleLabels: ["Tutor", "Lead Tutor", "Centre Manager"],
    defaultWorkAreas: ["Classroom 1", "Classroom 2", "Reception"],
    helpContext: "tuition centre",
  },
  clinic: {
    id: "clinic",
    displayName: "Clinic",
    workAreaSingular: "Department",
    workAreaPlural: "Departments",
    scheduleLabel: "Rota",
    staffRoleLabel: "Job role",
    clockingDeviceLabel: "Clocking device",
    siteClosureLabel: "Clinic closure",
    defaultCompliancePackId: "clinical_uk",
    defaultRoleLabels: ["Clinic Assistant", "Practitioner", "Clinic Manager"],
    defaultWorkAreas: ["Reception", "Treatment area", "Administration"],
    helpContext: "clinic",
  },
};

export function getIndustryProfile(value: string | null | undefined): IndustryProfile {
  return profiles[industryProfileIds.includes(value as IndustryProfileId)
    ? value as IndustryProfileId
    : "nursery"];
}

export function getActiveIndustryProfile(
  env: NodeJS.ProcessEnv = process.env,
): IndustryProfile {
  return getIndustryProfile(env.NEXT_PUBLIC_INDUSTRY_PROFILE);
}
