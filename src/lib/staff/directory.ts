export type StaffDirectoryFilter = "active" | "needs-setup" | "needs-checks" | "inactive";

export function parseStaffDirectoryFilter(value?: string): StaffDirectoryFilter {
  if (value === "inactive" || value === "needs-setup" || value === "needs-checks") {
    return value;
  }
  return "active";
}
