import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAttendanceReviewRow,
  buildAttendanceReviewRows,
  mapManagerHoursPreview,
} from "@/lib/attendance/review-server";
import { parseAttendanceManagerView } from "@/lib/attendance/manager-view";
import {
  buildStaffHoursRange,
  loadAllPages,
  normaliseStaffHoursRange,
  previousLondonDate,
} from "@/lib/attendance/staff-hours";
import { mapEffectiveManagerStatuses } from "@/lib/kiosk/server";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("production attendance review", () => {
  it("resolves Yesterday from the Europe/London calendar date", () => {
    expect(previousLondonDate(new Date("2026-07-28T23:30:00.000Z"))).toBe("2026-07-28");
    expect(previousLondonDate(new Date("2026-01-01T00:30:00.000Z"))).toBe("2025-12-31");
  });

  it("defaults staff hours to the configured current work week", () => {
    expect(normaliseStaffHoursRange(undefined, undefined, {
      start: "2026-07-26",
      end: "2026-08-01",
    })).toEqual({
      from: "2026-07-26",
      to: "2026-08-01",
    });
    expect(normaliseStaffHoursRange("2026-07-27", "2026-07-31", {
      start: "2026-07-26",
      end: "2026-08-01",
    })).toEqual({
      from: "2026-07-27",
      to: "2026-07-31",
    });
    expect(normaliseStaffHoursRange("2026-01-01", "2027-12-31", {
      start: "2026-07-26",
      end: "2026-08-01",
    })).toEqual({
      from: "2026-01-01",
      to: "2027-01-01",
    });
  });

  it("loads every PostgREST page within a bounded staff-hours range", async () => {
    const rows = Array.from({ length: 2_105 }, (_, index) => index);
    const requestedPages: Array<[number, number]> = [];
    const loaded = await loadAllPages(async (from, to) => {
      requestedPages.push([from, to]);
      return {
        data: rows.slice(from, to + 1),
        error: null,
      };
    });

    expect(loaded).toEqual(rows);
    expect(requestedPages).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("builds issue-first staff hours while preserving split rota and audit records", () => {
    const range = buildStaffHoursRange({
      from: "2026-07-27",
      to: "2026-08-02",
      currentWeekStart: "2026-07-27",
      currentWeekEnd: "2026-08-02",
      profiles: [
        { id: "alice", display_name: "Alice", full_name: "Alice Adams" },
        { id: "zoe", display_name: "Zoe", full_name: "Zoe Zaman" },
      ],
      shifts: [
        { id: "am", staff_id: "alice", shift_date: "2026-07-28", start_time: "08:30:00", end_time: "12:00:00", break_minutes: 0 },
        { id: "pm", staff_id: "alice", shift_date: "2026-07-28", start_time: "13:00:00", end_time: "17:30:00", break_minutes: 0 },
        { id: "zoe-shift", staff_id: "zoe", shift_date: "2026-07-28", start_time: "09:00:00", end_time: "17:00:00", break_minutes: 30 },
      ],
      originals: [
        { id: "alice-in", staff_id: "alice", event_type: "clock_in", event_timestamp: "2026-07-28T08:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
        { id: "alice-lunch-out", staff_id: "alice", event_type: "clock_out", event_timestamp: "2026-07-28T12:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
        { id: "alice-lunch-in", staff_id: "alice", event_type: "clock_in", event_timestamp: "2026-07-28T13:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
        { id: "alice-out", staff_id: "alice", event_type: "clock_out", event_timestamp: "2026-07-28T18:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
        { id: "zoe-in", staff_id: "zoe", event_type: "clock_in", event_timestamp: "2026-07-28T09:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
      ],
      corrections: [
        { id: "alice-in-fix", batch_id: "batch", correction_role: "primary", staff_id: "alice", correction_kind: "replace", original_event_id: "alice-in", supersedes_correction_id: null, event_type: "clock_in", event_timestamp: "2026-07-28T08:30:00+01:00", recorded_date: "2026-07-28", reason: "Use planned start", created_by: "manager", created_at: "2026-07-29T08:00:00Z" },
        { id: "alice-out-fix", batch_id: "batch", correction_role: "consequential", staff_id: "alice", correction_kind: "replace", original_event_id: "alice-out", supersedes_correction_id: null, event_type: "clock_out", event_timestamp: "2026-07-28T17:30:00+01:00", recorded_date: "2026-07-28", reason: "Use planned finish", created_by: "manager", created_at: "2026-07-29T08:00:01Z" },
      ],
      reviews: [],
      totals: [
        { staff_id: "alice", completed_minutes: 480, open_shift_count: 0 },
        { staff_id: "zoe", completed_minutes: 0, open_shift_count: 1 },
      ],
    });

    expect(range.staff.map((row) => row.staffId)).toEqual(["zoe", "alice"]);
    expect(range.staff[0]).toMatchObject({ daysNeedingAttention: 1, hasOpenShift: true });
    expect(range.staff[1]).toMatchObject({ completedMinutes: 480, daysNeedingAttention: 0 });

    const alice = range.days.find((day) => day.staffId === "alice")!;
    expect(alice.plannedPeriods).toEqual([
      { id: "am", startTime: "08:30", endTime: "12:00", breakMinutes: 0 },
      { id: "pm", startTime: "13:00", endTime: "17:30", breakMinutes: 0 },
    ]);
    expect(alice.audit.originals).toHaveLength(4);
    expect(alice.audit.corrections).toHaveLength(2);
    expect(alice.effectiveEvents.map((event) => event.eventTimestamp)).toEqual([
      "2026-07-28T08:30:00+01:00",
      "2026-07-28T12:00:00+01:00",
      "2026-07-28T13:00:00+01:00",
      "2026-07-28T17:30:00+01:00",
    ]);
    expect(alice.completedMinutes).toBe(480);
    expect(JSON.stringify(range)).not.toMatch(/hourlyRate|annualSalary|monthlySalary|estimatedGross/);
  });

  it("maps manager kiosk status from effective open shifts", () => {
    const statuses = mapEffectiveManagerStatuses([
      { staff_id: "open", current_status: "clocked_in" },
      { staff_id: "closed", current_status: "clocked_out" },
    ]);
    expect(statuses.get("open")).toBe("clocked_in");
    expect(statuses.get("closed")).toBe("clocked_out");
  });

  it("uses latest duplicate clock-in as the staff-hours open start", () => {
    const range = buildStaffHoursRange({
      from: "2026-07-28",
      to: "2026-07-28",
      currentWeekStart: "2026-07-27",
      currentWeekEnd: "2026-08-02",
      profiles: [{ id: "staff", display_name: "Staff", full_name: "Staff Member" }],
      shifts: [{
        id: "shift",
        staff_id: "staff",
        shift_date: "2026-07-28",
        start_time: "08:00:00",
        end_time: "17:00:00",
        break_minutes: 0,
      }],
      originals: [
        { id: "in-08", staff_id: "staff", event_type: "clock_in", event_timestamp: "2026-07-28T08:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
        { id: "in-09", staff_id: "staff", event_type: "clock_in", event_timestamp: "2026-07-28T09:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
        { id: "out-17", staff_id: "staff", event_type: "clock_out", event_timestamp: "2026-07-28T17:00:00+01:00", recorded_date: "2026-07-28", event_source: "kiosk", manager_correction: false, correction_reason: null },
      ],
      corrections: [],
      reviews: [],
    });

    expect(range.days[0].completedMinutes).toBe(480);
    expect(range.days[0].warnings).toContain("duplicate_clock_in");
  });

  it("defaults unknown attendance views to needs attention", () => {
    expect(parseAttendanceManagerView()).toBe("needs-attention");
    expect(parseAttendanceManagerView("add-event")).toBe("add-event");
    expect(parseAttendanceManagerView("unknown")).toBe("needs-attention");
  });

  it("puts the missing clock event command before attendance review", () => {
    const page = source("src/app/attendance/page.tsx");
    expect(page).toContain("Add a missing clock-in or clock-out");
    expect(page.indexOf("Add a missing clock-in or clock-out"))
      .toBeLessThan(page.indexOf("<AttendanceReview"));
    expect(page).toContain("<AttendancePageNav");
  });

  it("leaves the mobile attendance submenu unset for the add-event workflow", () => {
    const attendanceNav = source("src/components/attendance/attendance-page-nav.tsx");
    const pageNav = source("src/components/layout/manager-page-nav.tsx");
    expect(attendanceNav).toContain('activeView === "add-event" ? "" : activeView');
    expect(pageNav).toContain('{!activeItem ? <option value="">Choose a section</option> : null}');
  });

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

  it("accepts a complete effective sequence with an unpaid lunchtime clock-out", () => {
    const row = buildAttendanceReviewRow({
      staffId: "staff",
      fullName: "Staff Member",
      scheduledStart: "08:30",
      scheduledEnd: "17:30",
      events: [
        { staff_id: "staff", event_type: "clock_in", event_timestamp: "2026-07-28T08:30:00+01:00", manager_correction: true },
        { staff_id: "staff", event_type: "clock_out", event_timestamp: "2026-07-28T12:00:00+01:00", manager_correction: false },
        { staff_id: "staff", event_type: "clock_in", event_timestamp: "2026-07-28T13:00:00+01:00", manager_correction: false },
        { staff_id: "staff", event_type: "clock_out", event_timestamp: "2026-07-28T17:30:00+01:00", manager_correction: true },
      ],
    });

    expect(row.recordedMinutes).toBe(480);
    expect(row.exceptions).not.toContain("Overlapping or duplicate events");
    expect(row.managerCorrection).toBe(true);
  });

  it("retains a request-only staff row in attendance review", () => {
    const rows = buildAttendanceReviewRows(
      [],
      [{ id: "staff", full_name: "Staff Member" }],
      new Map([["staff", [{
        id: "request",
        issueType: "missing_clock_in",
        staffNote: "I could not use the kiosk.",
      }]]]),
    );

    expect(rows).toEqual([
      expect.objectContaining({
        staffId: "staff",
        fullName: "Staff Member",
        pendingClarificationCount: 1,
      }),
    ]);
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
