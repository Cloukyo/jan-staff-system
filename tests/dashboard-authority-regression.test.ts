import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDashboardActionItems,
  dashboardHasNoImmediateActions,
} from "@/components/dashboard/dashboard-presentation";
import type { ProductionDashboardSummary } from "@/lib/dashboard/types";

function summary(overrides: Partial<ProductionDashboardSummary> = {}): ProductionDashboardSummary {
  return {
    referenceDate: "2026-09-10",
    weekStartDate: "2026-09-07",
    activeStaff: 2,
    currentlyClockedIn: 0,
    todayScheduledShifts: 0,
    todayAttendanceExceptions: 0,
    unresolvedAttendanceIssues: 0,
    missingClockOuts: 0,
    longRunningShifts: 0,
    pendingCorrections: 0,
    pendingLeaveRequests: 0,
    approvedLeaveRotaConflicts: 0,
    expiredCertificates: 0,
    certificatesExpiring30Days: 0,
    incompleteCentralRecords: 0,
    staffMissingKioskPin: 0,
    staffMissingPayArrangement: 0,
    requiresManagerAction: false,
    currentRota: null,
    clockedInStaff: [],
    attendanceWarnings: [],
    upcomingShifts: [],
    ...overrides,
  };
}

describe("commercial dashboard authority regression", () => {
  it("does not show all-clear when authoritative pay readiness needs action", () => {
    const data = summary({ staffMissingPayArrangement: 1, requiresManagerAction: true });

    expect(dashboardHasNoImmediateActions(data)).toBe(false);
    expect(buildDashboardActionItems(data)).toContainEqual(expect.objectContaining({
      key: "pay",
      count: 1,
      href: "/payroll/arrangements",
    }));
  });

  it("includes operationally actionable kiosk and recruitment/compliance states", () => {
    const items = buildDashboardActionItems(summary({
      staffMissingKioskPin: 1,
      incompleteCentralRecords: 1,
      expiredCertificates: 1,
      certificatesExpiring30Days: 1,
      requiresManagerAction: true,
    }));

    expect(items.map((item) => item.key)).toEqual(expect.arrayContaining([
      "recruitment",
      "expired-certificates",
      "certificates-due",
      "kiosk",
    ]));
  });

  it("uses the database-derived all-clear result rather than the rendered item list", () => {
    expect(dashboardHasNoImmediateActions(summary({ requiresManagerAction: false }))).toBe(true);
    expect(dashboardHasNoImmediateActions(summary({ requiresManagerAction: true }))).toBe(false);
  });

  it("ships a forward migration that replaces every placeholder dashboard signal", () => {
    const sql = readFileSync(join(
      process.cwd(),
      "supabase/migrations/20260910120000_authoritative_commercial_dashboard.sql",
    ), "utf8");

    expect(sql).toContain("create or replace function public.get_commercial_attendance_dashboard");
    expect(sql).toContain("'requires_manager_action'");
    expect(sql).toContain("public.rota_shifts");
    expect(sql).toContain("public.leave_requests");
    expect(sql).toContain("public.staff_pay_arrangements");
    expect(sql).toContain("public.staff_kiosk_settings");
    expect(sql).toContain("public.staff_recruitment_readiness");
    expect(sql).toContain("public.staff_certificates");
    expect(sql).not.toMatch(/'today_scheduled_shifts'\s*,\s*0/);
    expect(sql).not.toMatch(/'upcoming_shifts'\s*,\s*'\[\]'::jsonb/);
  });
});
