import type { SemanticTone } from "@/components/ui/semantic-primitives";
import type { CommercialPayrollReportingState } from "@/lib/payroll/reporting";
import type {
  PayrollReadinessCode,
  PayrollReadinessIssue,
  PayrollReadinessSeverity,
} from "@/lib/payroll/tenant-types";

export type PayrollPrimaryAction =
  | "create_period"
  | "prepare"
  | "recalculate"
  | "resolve_blockers"
  | "acknowledge_warnings"
  | "approve"
  | "select_scope"
  | "export"
  | "none";

export type PayrollWorkflowPresentation = {
  tone: SemanticTone;
  title: string;
  description: string;
  primaryAction: PayrollPrimaryAction;
};

type PayrollWorkflowInput = {
  reporting: CommercialPayrollReportingState;
  canPrepare: boolean;
  canExport: boolean;
  exportScopeMatches: boolean;
};

export function buildPayrollWorkflowPresentation({
  reporting,
  canPrepare,
  canExport,
  exportScopeMatches,
}: PayrollWorkflowInput): PayrollWorkflowPresentation {
  if (!reporting.period) {
    return {
      tone: "information",
      title: "Choose this pay period",
      description: "Create a payroll preparation for the selected dates.",
      primaryAction: canPrepare ? "create_period" : "none",
    };
  }
  if (!reporting.run) {
    return {
      tone: "information",
      title: "Prepare payroll hours",
      description: "Save the current attendance and pay inputs as a reviewable preparation.",
      primaryAction: canPrepare ? "prepare" : "none",
    };
  }
  if (!reporting.isFresh) {
    return {
      tone: "blocking",
      title: "Payroll needs recalculating",
      description: "Attendance, pay details or adjustments changed after this preparation was saved.",
      primaryAction: canPrepare && reporting.period.status === "open" ? "recalculate" : "none",
    };
  }
  if (reporting.run.blockerCount > 0 || reporting.run.status === "needs_review") {
    const count = reporting.run.blockerCount;
    return {
      tone: "blocking",
      title: `${count} ${count === 1 ? "thing must" : "things must"} be fixed`,
      description: "Resolve the blocking payroll inputs, then recalculate this preparation.",
      primaryAction: "resolve_blockers",
    };
  }
  if (reporting.run.warningCount > 0 && !reporting.run.warningsAcknowledged) {
    const count = reporting.run.warningCount;
    return {
      tone: "attention",
      title: `${count} ${count === 1 ? "warning needs" : "warnings need"} review`,
      description: "Review the warning evidence and record one acknowledgement note before approval.",
      primaryAction: canPrepare ? "acknowledge_warnings" : "none",
    };
  }
  if (reporting.approval?.status === "approved") {
    if (!exportScopeMatches) {
      return {
        tone: "attention",
        title: "Select the approved site scope",
        description: "The selected site does not match the scope stored with this approved preparation.",
        primaryAction: "select_scope",
      };
    }
    return {
      tone: "success",
      title: "Payroll is approved and ready to export",
      description: "Download the exact approved revision for this period and site scope.",
      primaryAction: canExport ? "export" : "none",
    };
  }
  if (reporting.run.status === "ready" && reporting.period.status === "open") {
    return {
      tone: "success",
      title: "Payroll is ready for approval",
      description: "The current preparation has no blockers and all warnings have been reviewed.",
      primaryAction: canPrepare ? "approve" : "none",
    };
  }
  return {
    tone: "neutral",
    title: "Payroll preparation is available",
    description: "Review the stored preparation details and available actions.",
    primaryAction: "none",
  };
}

const issueContent: Record<PayrollReadinessCode, { label: string; description: string }> = {
  missing_clock_in: {
    label: "Missing clock-in",
    description: "A worked day does not have a safe starting clock event.",
  },
  missing_clock_out: {
    label: "Missing clock-out",
    description: "A worked day does not have a safe finishing clock event.",
  },
  malformed_sequence: {
    label: "Clock events need correction",
    description: "The clock event sequence cannot be paired safely.",
  },
  unresolved_exception: {
    label: "Attendance issue is unresolved",
    description: "An attendance exception still needs a manager decision.",
  },
  unreviewed_day: {
    label: "Worked day is not reviewed",
    description: "Recorded attendance has not received a manager review decision.",
  },
  pending_request: {
    label: "Staff correction request is pending",
    description: "A staff attendance request still needs a manager response.",
  },
  long_shift: {
    label: "Long shift needs review",
    description: "Recorded attendance is unusually long and should be checked.",
  },
  site_attribution: {
    label: "Work site needs confirming",
    description: "Payable time cannot be attributed safely to the selected site scope.",
  },
  stale_input: {
    label: "Payroll inputs changed",
    description: "The stored preparation no longer matches the current source data.",
  },
  manager_correction: {
    label: "Manager correction included",
    description: "The preparation includes corrected effective attendance.",
  },
  missing_pay_arrangement: {
    label: "Missing pay details",
    description: "A staff member has no pay arrangement covering this period.",
  },
};

export type PayrollReadinessIssuePresentation = PayrollReadinessIssue & {
  label: string;
  description: string;
  href: string | null;
  actionLabel: string | null;
};

function attendanceHref(issue: PayrollReadinessIssue): string {
  const query = new URLSearchParams({ view: "needs-attention" });
  if (issue.operationalDate) {
    query.set("date", issue.operationalDate);
    query.set("from", issue.operationalDate);
    query.set("to", issue.operationalDate);
  }
  if (issue.staffId) query.set("staffId", issue.staffId);
  return `/attendance?${query.toString()}`;
}

function presentIssue(issue: PayrollReadinessIssue): PayrollReadinessIssuePresentation {
  const content = issueContent[issue.code];
  if (issue.code === "missing_pay_arrangement") {
    return {
      ...issue,
      ...content,
      href: "/payroll/arrangements",
      actionLabel: "Review pay details",
    };
  }
  if (issue.code === "stale_input" || issue.code === "manager_correction") {
    return { ...issue, ...content, href: null, actionLabel: null };
  }
  return {
    ...issue,
    ...content,
    href: attendanceHref(issue),
    actionLabel: "Fix attendance",
  };
}

export function groupPayrollReadinessIssues(issues: PayrollReadinessIssue[]): {
  blockers: PayrollReadinessIssuePresentation[];
  warnings: PayrollReadinessIssuePresentation[];
  information: PayrollReadinessIssuePresentation[];
} {
  const grouped: Record<PayrollReadinessSeverity, PayrollReadinessIssuePresentation[]> = {
    blocker: [],
    warning: [],
    informational: [],
  };
  for (const issue of issues) grouped[issue.severity].push(presentIssue(issue));
  return {
    blockers: grouped.blocker,
    warnings: grouped.warning,
    information: grouped.informational,
  };
}
