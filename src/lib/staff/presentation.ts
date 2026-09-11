import type { StaffDirectoryRow } from "@/lib/payroll/types";

export type StaffDirectoryCounts = {
  active: number;
  "needs-setup": number;
  "needs-checks": number;
  inactive: number;
};

export function staffNeedsSetup(person: StaffDirectoryRow): boolean {
  return person.active && (
    person.kioskStatus === "PIN setup needed"
    || person.kioskStatus === "Disabled"
    || person.loginStatus === "Login not linked"
    || !person.hasQualification
    || !person.hasCurrentPayArrangement
  );
}

export function staffDirectoryCounts(staff: StaffDirectoryRow[]): StaffDirectoryCounts {
  return staff.reduce<StaffDirectoryCounts>((counts, person) => {
    if (person.active) counts.active += 1;
    else counts.inactive += 1;
    if (staffNeedsSetup(person)) counts["needs-setup"] += 1;
    if (person.active && person.hasComplianceIssues) counts["needs-checks"] += 1;
    return counts;
  }, { active: 0, "needs-setup": 0, "needs-checks": 0, inactive: 0 });
}

export function staffDirectoryPriority(person: StaffDirectoryRow): {
  label: string;
  detail: string;
  tone: "green" | "amber" | "red" | "grey";
} {
  if (!person.active) {
    return { label: "Inactive record", detail: "Historical records remain preserved.", tone: "grey" };
  }
  if (person.hasComplianceIssues) {
    return { label: "Checks need attention", detail: "Review recruitment, checks or training evidence.", tone: "red" };
  }
  if (person.kioskStatus === "PIN setup needed") {
    return { label: "Clocking-in setup needed", detail: "Set a Staff Clock PIN from this staff record.", tone: "amber" };
  }
  if (person.kioskStatus === "Disabled") {
    return { label: "Clocking in disabled", detail: "Enable Staff Clock access when this person should clock in.", tone: "amber" };
  }
  if (person.loginStatus === "Login not linked") {
    return { label: "Login setup needed", detail: "Finish linking this person to their staff login.", tone: "amber" };
  }
  if (!person.hasQualification) {
    return { label: "Qualification incomplete", detail: "Add their main qualification to the staff record.", tone: "amber" };
  }
  if (!person.hasCurrentPayArrangement) {
    return { label: "Pay details needed", detail: "Add their current pay arrangement before pay preparation.", tone: "amber" };
  }
  return { label: "Record ready", detail: "No staff-record action is currently required.", tone: "green" };
}
