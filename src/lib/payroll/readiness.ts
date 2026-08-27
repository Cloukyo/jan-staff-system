import type {
  PayrollReadinessCode,
  PayrollReadinessIssue,
  PayrollReadinessSeverity,
} from "@/lib/payroll/tenant-types";

const READINESS_SEVERITY: Record<PayrollReadinessCode, PayrollReadinessSeverity> = {
  missing_clock_in: "blocker",
  missing_clock_out: "blocker",
  malformed_sequence: "blocker",
  unresolved_exception: "blocker",
  unreviewed_day: "warning",
  pending_request: "blocker",
  long_shift: "warning",
  site_attribution: "blocker",
  stale_input: "blocker",
  manager_correction: "informational",
  missing_pay_arrangement: "blocker",
};

export function readinessSeverity(code: PayrollReadinessCode): PayrollReadinessSeverity {
  return READINESS_SEVERITY[code];
}

export function countReadinessIssues(
  issues: PayrollReadinessIssue[],
): Record<PayrollReadinessSeverity, number> {
  return issues.reduce<Record<PayrollReadinessSeverity, number>>(
    (counts, issue) => ({ ...counts, [issue.severity]: counts[issue.severity] + 1 }),
    { blocker: 0, warning: 0, informational: 0 },
  );
}
