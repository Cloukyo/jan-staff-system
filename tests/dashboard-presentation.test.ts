import { describe, expect, it } from "vitest";
import { buildDashboardActionItems } from "@/components/dashboard/dashboard-presentation";
import type { ProductionDashboardSummary } from "@/lib/dashboard/types";

function summary(
  overrides: Partial<ProductionDashboardSummary> = {},
): ProductionDashboardSummary {
  return {
    referenceDate: "2026-09-04",
    weekStartDate: "2026-08-31",
    activeStaff: 12,
    currentlyClockedIn: 3,
    todayScheduledShifts: 8,
    todayAttendanceExceptions: 2,
    unresolvedAttendanceIssues: 4,
    missingClockOuts: 1,
    longRunningShifts: 0,
    pendingCorrections: 2,
    pendingLeaveRequests: 3,
    approvedLeaveRotaConflicts: 1,
    expiredCertificates: 0,
    certificatesExpiring30Days: 0,
    incompleteCentralRecords: 0,
    staffMissingKioskPin: 0,
    staffMissingPayArrangement: 0,
    requiresManagerAction: true,
    currentRota: null,
    clockedInStaff: [],
    attendanceWarnings: [],
    upcomingShifts: [],
    ...overrides,
  };
}

describe("buildDashboardActionItems", () => {
  it("orders authoritative operational actions by consequence", () => {
    const data = summary();
    const items = buildDashboardActionItems(data);

    expect(items.map((item) => item.key)).toEqual([
      "attendance",
      "corrections",
      "rota-conflicts",
      "leave",
    ]);
    expect(items[0]).toMatchObject({
      count: data.unresolvedAttendanceIssues,
      tone: "blocking",
      href: "/attendance?view=needs-attention",
      actionLabel: "Review attendance",
    });
    expect(items[2]).toMatchObject({
      tone: "blocking",
      href: "/rota?week=2026-08-31&view=weekly",
    });
  });

  it("omits zero-count work instead of presenting false actions", () => {
    const items = buildDashboardActionItems(summary({
      unresolvedAttendanceIssues: 0,
      pendingCorrections: 0,
      pendingLeaveRequests: 0,
      approvedLeaveRotaConflicts: 0,
    }));

    expect(items).toEqual([]);
  });

  it("uses clear singular and plural labels", () => {
    const singular = buildDashboardActionItems(summary({
      unresolvedAttendanceIssues: 1,
      pendingCorrections: 1,
      pendingLeaveRequests: 1,
      approvedLeaveRotaConflicts: 1,
    }));
    const plural = buildDashboardActionItems(summary());

    expect(singular.map((item) => item.label)).toEqual([
      "attendance record requires review",
      "correction request awaits review",
      "approved leave conflict affects the rota",
      "leave request awaits a decision",
    ]);
    expect(plural.map((item) => item.label)).toEqual([
      "attendance records require review",
      "correction requests await review",
      "approved leave conflict affects the rota",
      "leave requests await a decision",
    ]);
  });
});
