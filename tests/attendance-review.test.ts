import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAttendanceReviewRow } from "@/lib/attendance/review-server";

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

  it("keeps payroll export blocked while attendance review is unresolved", () => {
    const payroll = source("src/components/payroll/production-payroll-screen.tsx");
    expect(payroll).toContain("Attendance review is incomplete");
    expect(payroll).toContain("disabled={reviewReadiness.unresolved > 0 || reviewReadiness.pendingRequests > 0}");
  });

  it("lets staff request corrections without editing clock events", () => {
    const server = source("src/lib/attendance/review-actions.ts");
    const form = source("src/components/staff-self-service/attendance-correction-request.tsx");
    expect(server).toContain('requireAccount(["staff"])');
    expect(server).toContain('from("attendance_correction_requests").insert');
    expect(form).toContain("It does not alter the original clock events.");
    expect(server).not.toMatch(/from\("clock_events"\)\.update/);
  });
});
