import type { StaffSiteAssignment } from "@/types/tenancy";

function appliesOn(assignment: StaffSiteAssignment, date: string): boolean {
  return assignment.effectiveFrom <= date && (assignment.effectiveTo === null || assignment.effectiveTo >= date);
}

export function activeStaffSiteAssignments(
  assignments: readonly StaffSiteAssignment[],
  date: string,
): StaffSiteAssignment[] {
  return assignments
    .filter((assignment) => appliesOn(assignment, date))
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id));
}

export function primaryStaffSiteAssignment(
  assignments: readonly StaffSiteAssignment[],
  date: string,
): StaffSiteAssignment | null {
  return activeStaffSiteAssignments(assignments, date).find((assignment) => assignment.isPrimary) ?? null;
}
