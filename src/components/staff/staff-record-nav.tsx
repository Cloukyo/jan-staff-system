import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import {
  staffRecordSectionHref,
  staffRecordSections,
  type StaffRecordSection,
} from "@/lib/staff/record-sections";

export function StaffRecordNav({
  staffId,
  section,
}: {
  staffId: string;
  section: StaffRecordSection;
}) {
  return (
    <ManagerPageNav
      activeId={section}
      label="Employee record sections"
      items={staffRecordSections.map((item) => ({
        ...item,
        href: staffRecordSectionHref(staffId, item.id),
      }))}
    />
  );
}
