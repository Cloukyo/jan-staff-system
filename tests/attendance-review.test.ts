import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAttendanceReviewRow, mapManagerHoursPreview } from "@/lib/attendance/review-server";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("production attendance review", () => {
  it("detects daily attendance exceptions", () => {
    const row = buildAttendanceReviewRow({
      staffId: "staff",
      fullName: "Staff Member",
      scheduledStart: "08:30",
      scheduledEnd: "16:30",
      events: [
        { staff_id: "staff", event_type: "clock_in", event_timestamp: "2026-06-13T08:45:00+01:00", manager_correction: false },
      ],
    });
    expect(row.exceptions).toContain("Late arrival");
    expect(row.exceptions).toContain("Missing clock-out");
    expect(row.reviewStatus).toBe("unreviewed");
  });

  it("keeps corrected events visible without mutating originals", () => {
    const row = buildAttendanceReviewRow({
      staffId: "staff",
      fullName: "Staff Member",
      scheduledStart: null,
      scheduledEnd: null,
      events: [
        { staff_id: "staff", event_type: "clock_in", event_timestamp: "2026-06-13T08:00:00+01:00", manager_correction: true },
        { staff_id: "staff", event_type: "clock_out", event_timestamp: "2026-06-13T16:00:00+01:00", manager_correction: false },
      ],
    });
    expect(row.managerCorrection).toBe(true);
    expect(row.recordedMinutes).toBe(480);
    expect(row.exceptions).toContain("Clock-in without rota shift");
  });

  it("stores reviews and staff requests behind RLS", () => {
    const migration = source("supabase/migrations/202606130007_attendance_exception_review.sql");
    expect(migration).toContain("alter table public.attendance_day_reviews enable row level security");
    expect(migration).toContain("Managers can manage attendance reviews");
    expect(migration).toContain("Staff can create own correction requests");
    expect(migration).toContain("staff_id = public.current_staff_profile_id()");
    expect(migration).not.toMatch(/alter table public\.clock_events disable row level security/i);
  });

  it("keeps the incomplete-review warning while allowing confirmed export", () => {
    const payroll = source("src/components/payroll/production-payroll-screen.tsx");
    expect(payroll).toContain("Attendance review is incomplete");
    expect(payroll).not.toContain("disabled={reviewReadiness.unresolved > 0 || reviewReadiness.pendingRequests > 0}");
    expect(payroll).toContain("Export unreviewed Excel");
  });

  it("lets staff request corrections without editing clock events", () => {
    const server = source("src/lib/attendance/review-actions.ts");
    const form = source("src/components/staff-self-service/attendance-correction-request.tsx");
    expect(server).toContain('requireAccount(["staff"])');
    expect(server).toContain('from("attendance_correction_requests").insert');
    expect(form).toContain("It does not alter the original clock events.");
    expect(server).not.toMatch(/from\("clock_events"\)\.update/);
  });

  it("maps manager date-range hours with empty staff rows as 0 minutes", () => {
    const rows = mapManagerHoursPreview([
      { staff_id: "staff-a", display_name: "Areeg", full_name: "Areeg Shahzadi", completed_minutes: 450, open_shift_count: 0 },
      { staff_id: "staff-b", display_name: "Maya", full_name: "Maya Patel", completed_minutes: null, open_shift_count: 1 },
    ]);
    expect(rows).toEqual([
      { staffId: "staff-a", displayName: "Areeg", fullName: "Areeg Shahzadi", completedMinutes: 450, openShiftCount: 0 },
      { staffId: "staff-b", displayName: "Maya", fullName: "Maya Patel", completedMinutes: 0, openShiftCount: 1 },
    ]);
  });

  it("keeps manager hours preview manager-only and uses the configured work-week start", () => {
    const migration = source("supabase/migrations/202607060001_kiosk_lockout_weekly_hours.sql");
    expect(migration).toContain("work_week_starts_on");
    expect(migration).toContain("default 1");
    expect(migration).toContain("public.get_manager_hours_preview");
    expect(migration).toContain("manager_account.role <> 'manager'");
    expect(migration).toContain("public.get_current_work_week_range");
    expect(migration).toContain("grant execute on function public.get_manager_hours_preview(date, date) to authenticated");
    expect(migration).not.toMatch(/grant execute on function public\.get_manager_hours_preview\(date, date\) to anon/i);
  });

  it("renders a manager date range control for hours preview", () => {
    const attendancePage = source("src/app/attendance/page.tsx");
    const attendance = source("src/components/attendance/production-attendance.tsx");
    expect(attendancePage).toContain("loadManagerHoursPreview");
    expect(attendance).toContain('name="hoursFrom"');
    expect(attendance).toContain('name="hoursTo"');
    expect(attendance).toContain("Current work week");
    expect(attendance).toContain("formatHours");
  });
});
