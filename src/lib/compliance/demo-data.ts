import type { StaffCertificate, StaffCentralRecord, StaffProfile, StaffQualification, StaffReferenceCheck } from "@/types";

const now = "2026-06-10T00:00:00+01:00";

export const demoComplianceStorageKey = "jan-staff-compliance-demo-v1";

export type DemoComplianceState = {
  staff: StaffProfile[];
  qualifications: StaffQualification[];
  certificates: StaffCertificate[];
  centralRecords: StaffCentralRecord[];
  references: StaffReferenceCheck[];
  importWarnings: Record<string, string[]>;
};

export function createDemoComplianceState(): DemoComplianceState {
  const staff: StaffProfile[] = [
    ["staff-ejana-chowdhury-jyoti", "Ejana Chowdhury Jyoti", "Ejana", "Nursery Practitioner", "Level 3"],
    ["staff-areeg-shahzadi", "Areeg Shahzadi", "Areeg", "Nursery Practitioner", "Level 3"],
    ["staff-ashwathy-vijayakumar-sreelekha", "Ashwathy Vijayakumar Sreelekha", "Ashwathy", "Nursery Practitioner", "Level 2"],
    ["staff-atampreet-kaur", "Atampreet Kaur", "Atampreet", "Nursery Practitioner", "Level 3"],
    ["staff-fouzia-mechri", "Fouzia Mechri", "Fouzia", "Cover Staff", null],
    ["staff-haleema-sadia", "Haleema Sadia", "Haleema", "Nursery Practitioner", "Level 3"],
    ["staff-kitenge-tshakupebwa", "Kitenge Tshakupebwa", "Kitenge", "Nursery Practitioner", null],
    ["staff-madiha-luqman", "Madiha Luqman", "Madiha", "Nursery Practitioner", "Level 2"],
    ["staff-nazmon-hannan", "Nazmon Hannan", "Nazmon", "Manager", "Level 3"],
    ["staff-naziha-bouda", "Naziha Bouda", "Naziha", "Nursery Practitioner", "Level 3"],
    ["staff-rehana-mahmood", "Rehana Mahmood", "Rehana M", "Nursery Practitioner", "Level 3"],
    ["staff-rehana-ali", "Rehana Ali", "Rehana A", "Nursery Practitioner", null],
    ["staff-samreera-siddiqah", "Samreera Siddiqah", "Samreera", "Nursery Practitioner", "Level 3"],
    ["staff-shukri-ismail", "Shukri Ismail", "Shukri", "Nursery Practitioner", "Level 2"],
    ["staff-mahbuba-begum-panna", "Mahbuba Begum Panna", "Mahbuba", "Nursery Practitioner", null],
  ].map(([id, fullName, displayName, role, level]) => ({
    id: id as string,
    fullName: fullName as string,
    displayName: displayName as string,
    employmentRole: role as string,
    mainQualificationLevel: level as string | null,
    isApprentice: false,
    isCoverStaff: role === "Cover Staff",
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
      qualificationName: `Childcare ${person.mainQualificationLevel}`,
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

  const certificates: StaffCertificate[] = staff.flatMap((person, index) => {
    const firstAidExpiry = index % 5 === 0 ? "2026-06-20" : index % 5 === 1 ? "2026-07-25" : index % 5 === 2 ? "2026-08-30" : index % 5 === 3 ? "2026-05-01" : null;
    const safeguardingExpiry = index % 4 === 0 ? "2026-07-05" : null;
    return [
      {
        id: `cert-fa-${person.id}`,
        staffId: person.id,
        certificateType: "Paediatric First Aid",
        customTitle: null,
        completionDate: firstAidExpiry ? "2023-06-20" : null,
        expiryDate: firstAidExpiry,
        validityMonths: firstAidExpiry ? 36 : null,
        permanent: false,
        evidenceStatus: firstAidExpiry ? "received" : "awaiting",
        evidenceReference: null,
        notes: null,
        verifiedBy: index % 3 === 0 ? null : "manager",
        verifiedAt: index % 3 === 0 ? null : "2026-06-01T10:00:00+01:00",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `cert-sg-${person.id}`,
        staffId: person.id,
        certificateType: "Safeguarding",
        customTitle: null,
        completionDate: "2026-01-10",
        expiryDate: safeguardingExpiry,
        validityMonths: safeguardingExpiry ? 12 : null,
        permanent: safeguardingExpiry === null,
        evidenceStatus: "verified",
        evidenceReference: null,
        notes: safeguardingExpiry ? null : "No expiry recorded.",
        verifiedBy: "manager",
        verifiedAt: "2026-06-01T10:00:00+01:00",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ];
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
    dbsRecorded: index % 3 !== 1,
    dbsUpdateService: index % 4 === 1,
    dbsIssueDate: index % 3 !== 1 ? "2025-06-01" : null,
    dbsLastCheckedAt: index % 3 !== 1 ? "2026-06-01" : null,
    dbsNumberLast4: index % 3 !== 1 ? `${1000 + index}` : null,
    dbsNewCheckRequired: index % 6 === 0,
    referencesComplete: index % 2 === 1,
    referencesCheckedAt: index % 2 === 1 ? "2026-06-01" : null,
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
