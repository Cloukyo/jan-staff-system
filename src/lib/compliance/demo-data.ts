import type { StaffCertificate, StaffCentralRecord, StaffProfile, StaffQualification, StaffReferenceCheck } from "@/types";
import { browserIdentifiers } from "@/lib/platform/browser-identifiers";
import { getDemoPreset } from "@/lib/demo-data/presets";
import { getCompliancePackForIndustry } from "@/lib/compliance/modules";
import { getActiveIndustryProfile, type IndustryProfileId } from "@/lib/platform/industry-profile";

const now = "2026-06-10T00:00:00+01:00";

export const demoComplianceStorageKey = browserIdentifiers.complianceStorage.current;
export const legacyDemoComplianceStorageKeys = browserIdentifiers.complianceStorage.legacy;

export type DemoComplianceState = {
  staff: StaffProfile[];
  qualifications: StaffQualification[];
  certificates: StaffCertificate[];
  centralRecords: StaffCentralRecord[];
  references: StaffReferenceCheck[];
  importWarnings: Record<string, string[]>;
};

export function createDemoComplianceState(profileId: IndustryProfileId = getActiveIndustryProfile().id): DemoComplianceState {
  const preset = getDemoPreset(profileId);
  const compliancePack = getCompliancePackForIndustry(profileId);
  const staff: StaffProfile[] = [
    ["staff-demo-person-a", "Demo Person A", "Demo A", "Level 3"],
    ["staff-demo-person-b", "Demo Person B", "Demo B", "Level 3"],
    ["staff-demo-person-c", "Demo Person C", "Demo C", "Level 2"],
    ["staff-demo-person-d", "Demo Person D", "Demo D", "Level 3"],
    ["staff-demo-person-e", "Demo Person E", "Demo E", null],
    ["staff-demo-person-f", "Demo Person F", "Demo F", "Level 3"],
    ["staff-demo-person-g", "Demo Person G", "Demo G", null],
    ["staff-demo-person-h", "Demo Person H", "Demo H", "Level 2"],
    ["staff-demo-person-i", "Demo Person I", "Demo I", "Level 3"],
    ["staff-demo-person-j", "Demo Person J", "Demo J", "Level 3"],
    ["staff-demo-person-k", "Demo Person K", "Demo K", "Level 3"],
    ["staff-demo-person-l", "Demo Person L", "Demo L", null],
    ["staff-demo-person-m", "Demo Person M", "Demo M", "Level 3"],
    ["staff-demo-person-n", "Demo Person N", "Demo N", "Level 2"],
    ["staff-demo-person-o", "Demo Person O", "Demo O", null],
  ].map(([id, fullName, displayName, level], index) => ({
    id: id as string,
    fullName: fullName as string,
    displayName: displayName as string,
    employmentRole: preset.staffRoles[index % preset.staffRoles.length],
    mainQualificationLevel: level as string | null,
    isApprentice: false,
    isCoverStaff: index === 4,
    appointmentDate: null,
    active: true,
    authUserId: null,
    email: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  }));

  const qualifications: StaffQualification[] = staff
    .filter((person) => person.mainQualificationLevel)
    .map((person) => ({
      id: `qual-${person.id}`,
      staffId: person.id,
      qualificationName: `${preset.qualificationLabel} ${person.mainQualificationLevel}`,
      qualificationLevel: person.mainQualificationLevel,
      awardingOrganisation: null,
      awardDate: null,
      expectedCompletionDate: null,
      permanent: true,
      evidenceStatus: "awaiting",
      evidenceReference: null,
      notes: null,
      verifiedBy: null,
      verifiedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }));

  const certificateRequirements = compliancePack.requirements.filter((requirement) => requirement.kind === "certificate");
  const certificates: StaffCertificate[] = staff.flatMap((person, index) => {
    const firstAidExpiry = index % 5 === 0 ? "2026-06-20" : index % 5 === 1 ? "2026-07-25" : index % 5 === 2 ? "2026-08-30" : index % 5 === 3 ? "2026-05-01" : null;
    const safeguardingExpiry = index % 4 === 0 ? "2026-07-05" : null;
    return certificateRequirements.map((requirement, requirementIndex) => {
      const expiryDate = requirementIndex === 0 ? firstAidExpiry : safeguardingExpiry;
      return {
        id: `cert-${requirement.id}-${person.id}`,
        staffId: person.id,
        certificateType: requirement.label,
        customTitle: null,
        completionDate: expiryDate ? "2023-06-20" : null,
        expiryDate,
        validityMonths: expiryDate ? (requirementIndex === 0 ? 36 : 12) : null,
        permanent: requirementIndex > 0 && expiryDate === null,
        evidenceStatus: expiryDate ? "received" : "awaiting",
        evidenceReference: null,
        notes: expiryDate ? null : "No expiry recorded.",
        verifiedBy: index % 3 === 0 ? null : "manager",
        verifiedAt: index % 3 === 0 ? null : "2026-06-01T10:00:00+01:00",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      } satisfies StaffCertificate;
    });
  });

  const centralRecords: StaffCentralRecord[] = staff.map((person, index) => ({
    id: `central-${person.id}`,
    staffId: person.id,
    appointmentInductionCompleted: index % 2 === 0,
    appointmentInductionCheckedAt: index % 2 === 0 ? "2026-06-01" : null,
    contractForm: index % 3 !== 0,
    contractFormCheckedAt: index % 3 !== 0 ? "2026-06-01" : null,
    idChecked: index % 4 !== 0,
    idCheckedAt: index % 4 !== 0 ? "2026-06-01" : null,
    addressEvidenceChecked: index % 5 !== 0,
    addressEvidenceCheckedAt: index % 5 !== 0 ? "2026-06-01" : null,
    additionalEmploymentTaxEvidenceChecked: index % 2 === 0,
    additionalEmploymentTaxEvidenceCheckedAt: index % 2 === 0 ? "2026-06-01" : null,
    dbsRecorded: false,
    dbsUpdateService: false,
    dbsIssueDate: null,
    dbsLastCheckedAt: null,
    dbsNumberLast4: null,
    dbsNewCheckRequired: false,
    referencesComplete: false,
    referencesCheckedAt: null,
    starterForm: index % 3 !== 2,
    starterFormCheckedAt: index % 3 !== 2 ? "2026-06-01" : null,
    suitabilityDeclaration: index % 2 === 0,
    suitabilityDeclarationCheckedAt: index % 2 === 0 ? "2026-06-01" : null,
    medicalDeclaration: index % 4 !== 2,
    medicalDeclarationCheckedAt: index % 4 !== 2 ? "2026-06-01" : null,
    employeeInformationForm: index % 5 !== 3,
    employeeInformationFormCheckedAt: index % 5 !== 3 ? "2026-06-01" : null,
    checkedBy: "manager",
    checkedAt: "2026-06-01T10:00:00+01:00",
    notes: null,
    itemStatuses: {},
    itemNotes: {},
    createdAt: now,
    updatedAt: now,
  }));

  return { staff, qualifications, certificates, centralRecords, references: [], importWarnings: {} };
}
