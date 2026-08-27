import {
  getIndustryProfile,
  type IndustryProfileId,
} from "@/lib/platform/industry-profile";

export type DemoPreset = {
  id: IndustryProfileId;
  organisationDisplayName: string;
  siteDisplayName: string;
  emailDomain: string;
  staffRoles: readonly string[];
  workAreas: readonly string[];
  trainingLabel: string;
  qualificationLabel: string;
};

const presets: Record<IndustryProfileId, DemoPreset> = {
  nursery: {
    id: "nursery",
    organisationDisplayName: "Early Years Demo Group",
    siteDisplayName: "Riverside Nursery",
    emailDomain: "nursery.demo",
    staffRoles: ["Manager", "Deputy Manager", "Room Leader", "Nursery Practitioner", "Nursery Practitioner", "Apprentice", "Room Leader", "Nursery Practitioner", "Administrator", "Nursery Practitioner", "Nursery Practitioner", "Former Practitioner"],
    workAreas: ["Office", "Preschool room", "Nursery floor"],
    trainingLabel: "Safeguarding refresher",
    qualificationLabel: "Childcare",
  },
  care_home: {
    id: "care_home",
    organisationDisplayName: "Care Services Demo Group",
    siteDisplayName: "Riverside Care Home",
    emailDomain: "care.demo",
    staffRoles: ["Manager", "Deputy Manager", "Senior Carer", "Care Assistant", "Care Assistant", "Care Apprentice", "Senior Carer", "Care Assistant", "Administrator", "Care Assistant", "Care Assistant", "Former Care Assistant"],
    workAreas: ["Office", "Residential unit", "Communal area"],
    trainingLabel: "Moving and handling refresher",
    qualificationLabel: "Adult Social Care",
  },
  tuition_centre: {
    id: "tuition_centre",
    organisationDisplayName: "Learning Centres Demo Group",
    siteDisplayName: "Riverside Tuition Centre",
    emailDomain: "tuition.demo",
    staffRoles: ["Centre Manager", "Deputy Centre Manager", "Lead Tutor", "Tutor", "Tutor", "Trainee Tutor", "Lead Tutor", "Tutor", "Administrator", "Tutor", "Tutor", "Former Tutor"],
    workAreas: ["Reception", "Classroom 1", "Classroom 2"],
    trainingLabel: "Teaching practice refresher",
    qualificationLabel: "Teaching",
  },
  clinic: {
    id: "clinic",
    organisationDisplayName: "Health Services Demo Group",
    siteDisplayName: "Riverside Clinic",
    emailDomain: "clinic.demo",
    staffRoles: ["Clinic Manager", "Deputy Clinic Manager", "Senior Practitioner", "Clinic Assistant", "Clinic Assistant", "Trainee Practitioner", "Senior Practitioner", "Clinic Assistant", "Administrator", "Clinic Assistant", "Clinic Assistant", "Former Clinic Assistant"],
    workAreas: ["Administration", "Reception", "Treatment area"],
    trainingLabel: "Clinical safety refresher",
    qualificationLabel: "Clinical Practice",
  },
};

export function getDemoPreset(value?: string | null): DemoPreset {
  return presets[getIndustryProfile(value).id];
}
