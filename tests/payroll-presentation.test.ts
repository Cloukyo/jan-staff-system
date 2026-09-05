import { describe, expect, it } from "vitest";
import {
  buildPayrollWorkflowPresentation,
  groupPayrollReadinessIssues,
} from "@/components/payroll/payroll-presentation";
import type { CommercialPayrollReportingState } from "@/lib/payroll/reporting";
import type { PayrollReadinessIssue } from "@/lib/payroll/tenant-types";

function reporting(
  overrides: Partial<CommercialPayrollReportingState> = {},
): CommercialPayrollReportingState {
  return {
    selectedSiteId: null,
    selectedSiteDisplayName: null,
    period: { id: "period-1", status: "open", revision: 2 },
    run: {
      id: "run-1",
      status: "ready",
      revision: 2,
      blockerCount: 0,
      warningCount: 0,
      informationalCount: 0,
      siteFilterId: null,
      siteFilterDisplayName: null,
      warningsAcknowledged: false,
    },
    approval: null,
    lastExport: null,
    isFresh: true,
    staleCode: null,
    rows: [],
    adjustmentTargets: [],
    ...overrides,
  };
}

function presentation(
  state: CommercialPayrollReportingState,
  permissions: { canPrepare?: boolean; canExport?: boolean; exportScopeMatches?: boolean } = {},
) {
  return buildPayrollWorkflowPresentation({
    reporting: state,
    canPrepare: permissions.canPrepare ?? true,
    canExport: permissions.canExport ?? true,
    exportScopeMatches: permissions.exportScopeMatches ?? true,
  });
}

describe("commercial payroll workflow presentation", () => {
  it("guides a new period through creation and preparation", () => {
    expect(presentation(reporting({ period: null, run: null }))).toMatchObject({
      tone: "information",
      title: "Choose this pay period",
      primaryAction: "create_period",
    });
    expect(presentation(reporting({ run: null }))).toMatchObject({
      tone: "information",
      title: "Prepare payroll hours",
      primaryAction: "prepare",
    });
  });

  it("makes stale inputs and blockers interrupt the clean path", () => {
    expect(presentation(reporting({ isFresh: false }))).toMatchObject({
      tone: "blocking",
      title: "Payroll needs recalculating",
      primaryAction: "recalculate",
    });
    expect(presentation(reporting({
      run: { ...reporting().run!, status: "needs_review", blockerCount: 3 },
    }))).toMatchObject({
      tone: "blocking",
      title: "3 things must be fixed",
      primaryAction: "resolve_blockers",
    });
  });

  it("keeps warning acknowledgement distinct from approval", () => {
    expect(presentation(reporting({
      run: { ...reporting().run!, warningCount: 2, warningCodes: ["unreviewed_day", "long_shift"] },
    }))).toMatchObject({
      tone: "attention",
      title: "2 warnings need review",
      primaryAction: "acknowledge_warnings",
    });
    expect(presentation(reporting({
      run: { ...reporting().run!, warningCount: 2, warningsAcknowledged: true },
    }))).toMatchObject({
      tone: "success",
      title: "Payroll is ready for approval",
      primaryAction: "approve",
    });
  });

  it("makes export primary only for the fresh approved matching scope", () => {
    const approved = reporting({
      period: { id: "period-1", status: "closed", revision: 2 },
      run: { ...reporting().run!, status: "approved" },
      approval: { id: "approval-1", status: "approved" },
    });
    expect(presentation(approved)).toMatchObject({
      tone: "success",
      title: "Payroll is approved and ready to export",
      primaryAction: "export",
    });
    expect(presentation(approved, { exportScopeMatches: false })).toMatchObject({
      tone: "attention",
      title: "Select the approved site scope",
      primaryAction: "select_scope",
    });
  });

  it("never offers a mutation or export action without permission", () => {
    expect(presentation(reporting({ period: null, run: null }), {
      canPrepare: false,
      canExport: false,
    }).primaryAction).toBe("none");
    expect(presentation(reporting(), {
      canPrepare: false,
      canExport: false,
    })).toMatchObject({
      title: "Payroll is ready for approval",
      primaryAction: "none",
    });
  });
});

describe("commercial payroll readiness issue presentation", () => {
  function issue(overrides: Partial<PayrollReadinessIssue>): PayrollReadinessIssue {
    return {
      code: "manager_correction",
      severity: "informational",
      organisationId: "organisation-1",
      staffId: null,
      siteId: null,
      operationalDate: null,
      sourceId: null,
      ...overrides,
    };
  }

  it("groups issues by authoritative severity without changing their order", () => {
    const groups = groupPayrollReadinessIssues([
      issue({ code: "manager_correction", severity: "informational" }),
      issue({ code: "missing_clock_out", severity: "blocker", staffId: "staff-1", operationalDate: "2026-09-02" }),
      issue({ code: "unreviewed_day", severity: "warning", staffId: "staff-2", operationalDate: "2026-09-03" }),
      issue({ code: "missing_pay_arrangement", severity: "blocker", staffId: "staff-3" }),
    ]);

    expect(groups.blockers.map((item) => item.code)).toEqual([
      "missing_clock_out",
      "missing_pay_arrangement",
    ]);
    expect(groups.warnings.map((item) => item.code)).toEqual(["unreviewed_day"]);
    expect(groups.information.map((item) => item.code)).toEqual(["manager_correction"]);
  });

  it("provides plain-English labels and existing remediation routes", () => {
    const groups = groupPayrollReadinessIssues([
      issue({ code: "missing_clock_out", severity: "blocker", staffId: "staff-1", operationalDate: "2026-09-02" }),
      issue({ code: "missing_pay_arrangement", severity: "blocker", staffId: "staff-2" }),
      issue({ code: "manager_correction", severity: "informational" }),
    ]);

    expect(groups.blockers[0]).toMatchObject({
      label: "Missing clock-out",
      actionLabel: "Fix attendance",
    });
    expect(groups.blockers[0].href).toContain("/attendance?");
    expect(groups.blockers[0].href).toContain("date=2026-09-02");
    expect(groups.blockers[1]).toMatchObject({
      label: "Missing pay details",
      href: "/payroll/arrangements",
      actionLabel: "Review pay details",
    });
    expect(groups.information[0]).toMatchObject({
      label: "Manager correction included",
      href: null,
    });
  });
});
