import { describe, expect, it } from "vitest";
import {
  buildPayrollReadinessProgress,
  groupPayrollReadinessIssues,
} from "@/components/payroll/payroll-presentation";
import type { PayrollReadinessIssue } from "@/lib/payroll/tenant-types";

function issue(
  severity: PayrollReadinessIssue["severity"],
  code: PayrollReadinessIssue["code"],
): PayrollReadinessIssue {
  return {
    severity,
    code,
    organisationId: "10000000-0000-0000-0000-000000000001",
    siteId: "20000000-0000-0000-0000-000000000001",
    staffId: "staff-1",
    operationalDate: null,
    sourceId: null,
  };
}

describe("commercial payroll readiness progress regression", () => {
  it("derives review progress from the same issues rendered in the blocker panels", () => {
    const issues = [
      issue("blocker", "missing_pay_arrangement"),
      issue("warning", "long_shift"),
      issue("informational", "manager_correction"),
    ];

    const groups = groupPayrollReadinessIssues(issues);
    const progress = buildPayrollReadinessProgress(issues);

    expect(progress).toEqual({ blockers: 1, warnings: 1, information: 1 });
    expect(progress.blockers).toBe(groups.blockers.length);
    expect(progress.warnings).toBe(groups.warnings.length);
    expect(progress.information).toBe(groups.information.length);
  });

  it("cannot report zero blockers while a missing-pay blocker is displayed", () => {
    const issues = [issue("blocker", "missing_pay_arrangement")];

    expect(groupPayrollReadinessIssues(issues).blockers).toHaveLength(1);
    expect(buildPayrollReadinessProgress(issues).blockers).toBe(1);
  });
});
