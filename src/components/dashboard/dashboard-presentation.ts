import type { ActionSummaryItem } from "@/components/ui/semantic-primitives";
import type { ProductionDashboardSummary } from "@/lib/dashboard/types";

export function buildDashboardActionItems(
  data: ProductionDashboardSummary,
): ActionSummaryItem[] {
  const rotaHref = `/rota?week=${data.weekStartDate}&view=weekly`;
  const items: ActionSummaryItem[] = [
    {
      key: "attendance",
      label: data.unresolvedAttendanceIssues === 1
        ? "attendance record requires review"
        : "attendance records require review",
      count: data.unresolvedAttendanceIssues,
      tone: "blocking",
      href: "/attendance?view=needs-attention",
      actionLabel: "Review attendance",
    },
    {
      key: "corrections",
      label: data.pendingCorrections === 1
        ? "correction request awaits review"
        : "correction requests await review",
      count: data.pendingCorrections,
      tone: "attention",
      href: "/attendance?view=needs-attention",
      actionLabel: "Review requests",
    },
    {
      key: "rota-conflicts",
      label: data.approvedLeaveRotaConflicts === 1
        ? "approved leave conflict affects the rota"
        : "approved leave conflicts affect the rota",
      count: data.approvedLeaveRotaConflicts,
      tone: "blocking",
      href: rotaHref,
      actionLabel: "Open rota",
    },
    {
      key: "leave",
      label: data.pendingLeaveRequests === 1
        ? "leave request awaits a decision"
        : "leave requests await a decision",
      count: data.pendingLeaveRequests,
      tone: "attention",
      href: "/leave/requests",
      actionLabel: "Review leave",
    },
  ];

  return items.filter((item) => item.count > 0);
}
