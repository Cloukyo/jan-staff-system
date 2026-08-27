import type { CommercialApprovedPayrollExportRow } from "@/lib/exports/payroll-excel";
import type { CommercialAdjustmentTarget } from "@/lib/payroll/tenant-types";

export type CommercialPayrollReportingState = {
  selectedSiteId: string | null;
  selectedSiteDisplayName: string | null;
  period: null | { id: string; status: "open" | "closed"; revision: number };
  run: null | {
    id: string;
    status: "draft" | "needs_review" | "ready" | "approved" | "superseded";
    revision: number;
    blockerCount: number;
    warningCount: number;
    informationalCount: number;
    siteFilterId: string | null;
    siteFilterDisplayName: string | null;
    warningCodes?: string[];
    warningsAcknowledged?: boolean;
  };
  approval: null | { id: string; status: "approved" | "reopened" };
  lastExport: null | { fileName: string; createdAt: string; revision: number };
  isFresh: boolean;
  staleCode: string | null;
  rows: CommercialApprovedPayrollExportRow[];
  adjustmentTargets: Array<{
    key: string;
    label: string;
    target: CommercialAdjustmentTarget;
  }>;
  adjustments?: Array<{
    id: string;
    staffId: string;
    adjustmentMinutes: number;
    reason: string;
  }>;
};

export type CommercialPayrollReportingSummary = {
  sourceLabel: string;
  totalLabel: string;
  totalMinutes: number;
  adjustmentMinutes: number;
  blockerCount: number;
  warningCount: number;
  informationalCount: number;
  categoryCounts: Record<string, number>;
  siteTotals: Array<{
    siteId: string | null;
    siteDisplayName: string;
    payableMinutes: number;
  }>;
  staffRows: Array<{
    staffId: string;
    fullName: string;
    employmentRole: string;
    payType: "hourly" | "salaried" | null;
    payableMinutes: number;
    ordinaryMinutes: number;
    overtimeMinutes: number;
    estimatedGrossValue: number | null;
  }>;
};

export function summariseCommercialPayrollReporting(
  reporting: CommercialPayrollReportingState,
): CommercialPayrollReportingSummary {
  const siteTotals = new Map<string, CommercialPayrollReportingSummary["siteTotals"][number]>();
  const staffRows = new Map<string, CommercialPayrollReportingSummary["staffRows"][number]>();
  let totalMinutes = 0;
  let adjustmentMinutes = 0;
  for (const row of reporting.rows) {
    totalMinutes += row.payableMinutes;
    adjustmentMinutes += row.adjustmentMinutes;
    if (row.siteId !== null && row.sourceKind !== "staff_summary") {
      const siteKey = row.siteId ?? "unattributed";
      const site = siteTotals.get(siteKey) ?? {
        siteId: row.siteId,
        siteDisplayName: row.siteDisplayName ?? "Unattributed",
        payableMinutes: 0,
      };
      site.payableMinutes += row.payableMinutes;
      siteTotals.set(siteKey, site);
    }
    const staff = staffRows.get(row.staffId) ?? {
      staffId: row.staffId,
      fullName: row.fullName,
      employmentRole: row.employmentRole,
      payType: row.payType,
      payableMinutes: 0,
      ordinaryMinutes: 0,
      overtimeMinutes: 0,
      estimatedGrossValue: null,
    };
    staff.payableMinutes += row.payableMinutes;
    staff.ordinaryMinutes += row.ordinaryMinutes;
    staff.overtimeMinutes += row.overtimeMinutes;
    if (row.estimatedGrossValue !== null) {
      staff.estimatedGrossValue = (staff.estimatedGrossValue ?? 0) + row.estimatedGrossValue;
    }
    staffRows.set(row.staffId, staff);
  }
  const totalLabel = reporting.selectedSiteId
    ? `${reporting.selectedSiteDisplayName ?? "Selected site"} attributed total`
    : reporting.run?.siteFilterId
      ? `${reporting.run.siteFilterDisplayName ?? "Approved site"} total`
      : "Organisation total";
  const sortedStaffRows = [...staffRows.values()].sort((left, right) => (
    left.fullName.localeCompare(right.fullName)
  ));
  const categoryCounts = sortedStaffRows.reduce<Record<string, number>>((counts, row) => {
    const category = row.payType ?? "missing";
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});
  return {
    sourceLabel: reporting.run ? `Stored revision ${reporting.run.revision}` : "No stored revision",
    totalLabel,
    totalMinutes,
    adjustmentMinutes,
    blockerCount: reporting.run?.blockerCount ?? 0,
    warningCount: reporting.run?.warningCount ?? 0,
    informationalCount: reporting.run?.informationalCount ?? 0,
    categoryCounts,
    siteTotals: [...siteTotals.values()].sort((left, right) => (
      left.siteDisplayName.localeCompare(right.siteDisplayName)
    )),
    staffRows: sortedStaffRows,
  };
}
