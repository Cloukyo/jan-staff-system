import type { ActionSummaryItem } from "@/components/ui/semantic-primitives";
import type { ProductionDashboardSummary } from "@/lib/dashboard/types";

export function dashboardHasNoImmediateActions(data: ProductionDashboardSummary): boolean {
  return !data.requiresManagerAction;
}

export function buildDashboardActionItems(data: ProductionDashboardSummary): ActionSummaryItem[] {
  const rotaHref = `/rota?week=${data.weekStartDate}&view=weekly`;
  const items: Array<ActionSummaryItem & { count: number }> = [
    { key: "attendance", label: data.unresolvedAttendanceIssues === 1 ? "attendance record requires review" : "attendance records require review", count: data.unresolvedAttendanceIssues, tone: "blocking", href: "/attendance?view=needs-attention", actionLabel: "Review attendance" },
    { key: "corrections", label: data.pendingCorrections === 1 ? "correction request awaits review" : "correction requests await review", count: data.pendingCorrections, tone: "attention", href: "/attendance?view=needs-attention", actionLabel: "Review requests" },
    { key: "rota-conflicts", label: data.approvedLeaveRotaConflicts === 1 ? "approved leave conflict affects the rota" : "approved leave conflicts affect the rota", count: data.approvedLeaveRotaConflicts ?? 0, tone: "blocking", href: rotaHref, actionLabel: "Open rota" },
    { key: "leave", label: data.pendingLeaveRequests === 1 ? "leave request awaits a decision" : "leave requests await a decision", count: data.pendingLeaveRequests ?? 0, tone: "attention", href: "/leave/requests", actionLabel: "Review leave" },
    { key: "recruitment", label: "Staff cannot yet begin operational work", count: data.incompleteCentralRecords ?? 0, tone: "blocking", href: "/staff?filter=needs-checks", actionLabel: "Review staff checks" },
    { key: "pay", label: "Staff need current pay details", count: data.staffMissingPayArrangement ?? 0, tone: "blocking", href: "/payroll/arrangements", actionLabel: "Review pay details" },
    { key: "expired-certificates", label: "Staff certificates have expired", count: data.expiredCertificates ?? 0, tone: "blocking", href: "/staff?filter=needs-checks", actionLabel: "Review certificates" },
    { key: "certificates-due", label: "Staff certificates expire within 30 days", count: data.certificatesExpiring30Days ?? 0, tone: "attention", href: "/staff?filter=needs-checks", actionLabel: "Review certificates" },
    { key: "kiosk", label: "Staff need clocking-in setup", count: data.staffMissingKioskPin ?? 0, tone: "attention", href: "/staff?filter=needs-setup", actionLabel: "Review clocking setup" },
  ];
  return items.filter((item) => item.count > 0);
}
