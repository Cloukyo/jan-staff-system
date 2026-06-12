import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dashboardRepositorySource, mapDashboardSummary } from "@/lib/dashboard/server";
import { isoDateInLondon, weekStart, isoDate } from "@/lib/dates/format";

const migration = readFileSync(resolve("supabase/migrations/202606120005_production_dashboard_summary.sql"), "utf8");
const alignment = readFileSync(resolve("supabase/migrations/202606120006_dashboard_summary_alignment.sql"), "utf8");

describe("production dashboard separation", () => {
  it("uses Supabase only in production and preserves explicit demo mode", () => {
    expect(dashboardRepositorySource("production")).toBe("supabase");
    expect(dashboardRepositorySource("demo")).toBe("demo");
    const page = readFileSync(resolve("src/app/dashboard/page.tsx"), "utf8");
    expect(page).toContain('getAppMode() === "demo"');
    expect(page).toContain("loadProductionDashboard");
    expect(page).not.toContain("useDemoRepository");
    expect(page).not.toContain("localStorage");
  });

  it("shows a clear production error instead of placeholder values", () => {
    const screen = readFileSync(resolve("src/components/dashboard/production-dashboard.tsx"), "utf8");
    expect(screen).toContain("Live dashboard unavailable");
    expect(screen).toContain("No demo or placeholder figures have been shown");
    expect(screen).not.toContain("Amelia");
    expect(screen).not.toContain("Priya");
    expect(screen).not.toContain("estimated payroll");
  });
});

describe("manager dashboard summary mapping", () => {
  it("maps Supabase counts and current rota status", () => {
    const summary = mapDashboardSummary({
      reference_date: "2026-06-12",
      week_start_date: "2026-06-08",
      active_staff: 16,
      currently_clocked_in: 2,
      today_scheduled_shifts: 8,
      today_attendance_exceptions: 1,
      missing_clock_outs: 1,
      pending_leave_requests: 3,
      approved_leave_rota_conflicts: 2,
      expired_certificates: 4,
      certificates_expiring_30_days: 5,
      incomplete_central_records: 6,
      staff_missing_kiosk_pin: 7,
      staff_missing_pay_arrangement: 8,
      current_rota: { id: "week-1", status: "published", week_start_date: "2026-06-08", published_at: "2026-06-08T09:00:00Z" },
      clocked_in_staff: [],
      attendance_warnings: [],
      upcoming_shifts: [],
    });
    expect(summary.activeStaff).toBe(16);
    expect(summary.currentlyClockedIn).toBe(2);
    expect(summary.pendingLeaveRequests).toBe(3);
    expect(summary.expiredCertificates).toBe(4);
    expect(summary.incompleteCentralRecords).toBe(6);
    expect(summary.staffMissingPayArrangement).toBe(8);
    expect(summary.currentRota?.status).toBe("published");
  });

  it("uses Europe/London dates and Monday week boundaries", () => {
    expect(isoDateInLondon(new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-30");
    expect(isoDate(weekStart("2026-06-12"))).toBe("2026-06-08");
  });
});

describe("production dashboard database safeguards", () => {
  it("counts live staff, rota, clock, leave, compliance, kiosk and pay data", () => {
    expect(migration).toContain("from public.staff_profiles");
    expect(migration).toContain("from public.clock_events");
    expect(migration).toContain("from public.rota_shifts");
    expect(migration).toContain("from public.leave_requests");
    expect(migration).toContain("from public.staff_certificates");
    expect(migration).toContain("public.staff_central_record_items");
    expect(migration).toContain("public.staff_kiosk_settings");
    expect(migration).toContain("public.staff_pay_arrangements");
  });

  it("restricts the summary to managers and does not expose private values", () => {
    expect(migration).toContain("manager_account.id is null or manager_account.role <> 'manager'");
    expect(migration).toContain("revoke all on function public.get_manager_dashboard_summary(date) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.get_manager_dashboard_summary(date) to authenticated");
    expect(migration).not.toMatch(/pin_hash['",)]/i);
    expect(migration).not.toMatch(/hourly_rate['",)]/i);
    expect(migration).not.toMatch(/annual_salary['",)]/i);
    expect(migration).not.toMatch(/dbs_number/i);
    expect(migration).not.toMatch(/date_of_birth/i);
  });

  it("derives attendance from immutable events and pending leave from production status", () => {
    expect(migration).toContain("distinct on (ce.staff_id)");
    expect(migration).toContain("ce.recorded_date = dashboard_date");
    expect(migration).toContain("where status = 'pending'");
    expect(migration).toContain("latest.event_type = 'clock_in'");
  });

  it("aligns checklist and payroll counts with their manager screens", () => {
    expect(alignment).toContain("items.item_count < 12 or items.completed_count < 12");
    expect(alignment).toContain("account.role = 'manager'");
    expect(alignment).toContain("get_manager_dashboard_summary_base");
  });
});
