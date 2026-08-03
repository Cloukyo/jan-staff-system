export type StaffRecordSection =
  | "overview"
  | "employment"
  | "clocking-in"
  | "staff-login"
  | "training-checks"
  | "pay-details";

export const staffRecordSections: ReadonlyArray<{
  id: StaffRecordSection;
  label: string;
}> = [
  { id: "overview", label: "Overview" },
  { id: "employment", label: "Employment" },
  { id: "clocking-in", label: "Clocking in" },
  { id: "staff-login", label: "Staff login" },
  { id: "training-checks", label: "Training & checks" },
  { id: "pay-details", label: "Pay details" },
];

const sectionIds = new Set<StaffRecordSection>(
  staffRecordSections.map((section) => section.id),
);

export function parseStaffRecordSection(
  value: string | string[] | undefined,
): StaffRecordSection {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && sectionIds.has(candidate as StaffRecordSection)
    ? candidate as StaffRecordSection
    : "overview";
}

export function staffRecordSectionHref(
  staffId: string,
  section: StaffRecordSection,
): string {
  return `/compliance/staff/${encodeURIComponent(staffId)}?section=${section}`;
}
