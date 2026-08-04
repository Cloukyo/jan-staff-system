import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildAttendanceExceptionResolutionPlan,
  mapAttendanceExceptionRows,
  normaliseAttendanceExceptionFilters,
} from "@/lib/attendance/exceptions-server";
import { londonLocalDateTimeToIso } from "@/lib/dates/format";

const databaseRow = {
  id: "exception-1",
  staff_id: "staff-1",
  full_name: "Maya Patel",
  operational_date: "2026-08-02",
  exception_type: "missing_clock_out",
  status: "open",
  source: "reconciliation",
  created_at: "2026-08-03T00:05:00Z",
  updated_at: "2026-08-03T00:05:00Z",
  state_revision: "revision-1",
  suggested_resolution_at: "2026-08-02T16:30:00+01:00",
  payroll_may_be_affected: true,
  original_events: [{
    id: "original-in",
    event_type: "clock_in",
    event_timestamp: "2026-08-02T08:31:00+01:00",
    kiosk_device_id: "device-1",
    event_source: "kiosk",
  }],
  effective_events: [{
    event_id: "original-in",
    event_order_key: "original-in:original",
    original_event_id: null,
    correction_id: null,
    event_type: "clock_in",
    event_timestamp: "2026-08-02T08:31:00+01:00",
    source: "kiosk",
  }],
  corrections: [],
  scheduled_shifts: [{ start_time: "08:30", end_time: "16:30", status: "scheduled" }],
  leave_context: [],
  operation_history: [],
  resolution_reason: null,
  dismissal_reason: null,
  resolved_at: null,
  dismissed_at: null,
  reviewing_manager_name: null,
};

describe("attendance exception server mapping", () => {
  it("keeps original evidence separate from the effective ledger", () => {
    const [issue] = mapAttendanceExceptionRows([databaseRow]);

    expect(issue.staffName).toBe("Maya Patel");
    expect(issue.originalEvents).toEqual([{
      id: "original-in",
      eventType: "clock_in",
      eventTimestamp: "2026-08-02T08:31:00+01:00",
      kioskDeviceId: "device-1",
      source: "kiosk",
    }]);
    expect(issue.effectiveEvents[0]).toMatchObject({
      eventId: "original-in",
      eventType: "clock_in",
    });
    expect(issue.suggestedResolutionAt).toBe("2026-08-02T16:30:00+01:00");
    expect(issue.payrollMayBeAffected).toBe(true);
  });

  it("normalises practical filters without accepting unknown values", () => {
    expect(normaliseAttendanceExceptionFilters({
      status: "resolved",
      type: "missing_clock_out",
      staffId: " staff-1 ",
      from: "2026-08-01",
      to: "2026-08-31",
    })).toEqual({
      status: "resolved",
      type: "missing_clock_out",
      staffId: "staff-1",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(normaliseAttendanceExceptionFilters({
      status: "deleted",
      type: "mystery",
      from: "invalid",
      to: "invalid",
    })).toMatchObject({ status: "open", type: undefined });
  });
});

describe("manager attendance exception interface", () => {
  const component = readFileSync(resolve("src/components/attendance/attendance-exceptions.tsx"), "utf8");
  const actions = readFileSync(resolve("src/lib/attendance/review-actions.ts"), "utf8");
  const kioskActions = readFileSync(resolve("src/lib/kiosk/actions.ts"), "utf8");

  it("shows filters, evidence, audit and payroll impact on the existing attendance screen", () => {
    expect(component).toContain("Open issues");
    expect(component).toContain("Original evidence");
    expect(component).toContain("Current effective ledger");
    expect(component).toContain("Correction history");
    expect(component).toContain("Payroll may be affected");
  });

  it("routes manager decisions through protected exception RPCs without direct event inserts", () => {
    expect(actions).toContain('supabase.rpc("resolve_attendance_exception"');
    expect(actions).toContain('supabase.rpc("dismiss_attendance_exception"');
    expect(kioskActions).not.toContain('from("clock_events").insert');
  });
});

describe("attendance exception correction plans", () => {
  it("converts manager-entered London times across daylight saving", () => {
    expect(londonLocalDateTimeToIso("2026-08-02T16:30"))
      .toBe("2026-08-02T15:30:00.000Z");
    expect(londonLocalDateTimeToIso("2026-12-02T16:30"))
      .toBe("2026-12-02T16:30:00.000Z");
  });
  it("adds a missing clock-out without changing the original clock-in", () => {
    const result = buildAttendanceExceptionResolutionPlan({
      operationId: "00000000-0000-4000-8000-000000000501",
      staffId: "staff-1",
      operationalDate: "2026-08-02",
      resolutionKind: "add_missing_clock_out",
      eventTimestamp: "2026-08-02T16:35:00+01:00",
    });

    expect(result).toEqual({
      primary: {
        id: "00000000-0000-4000-8000-000000000501",
        staff_id: "staff-1",
        recorded_date: "2026-08-02",
        correction_kind: "add",
        original_event_id: null,
        supersedes_correction_id: null,
        event_type: "clock_out",
        event_timestamp: "2026-08-02T16:35:00+01:00",
      },
      consequential: [],
    });
  });

  it("adds a missing clock-in without changing the original clock-out", () => {
    const result = buildAttendanceExceptionResolutionPlan({
      operationId: "00000000-0000-4000-8000-000000000504",
      staffId: "staff-1",
      operationalDate: "2026-08-02",
      resolutionKind: "add_missing_clock_in",
      eventTimestamp: "2026-08-02T08:30:00+01:00",
    });

    expect(result.primary).toMatchObject({
      correction_kind: "add",
      original_event_id: null,
      event_type: "clock_in",
    });
  });

  it("supersedes the active correction when correcting a corrected clock-in", () => {
    const result = buildAttendanceExceptionResolutionPlan({
      operationId: "00000000-0000-4000-8000-000000000502",
      staffId: "staff-1",
      operationalDate: "2026-08-02",
      resolutionKind: "correct_clock_in",
      eventTimestamp: "2026-08-02T08:45:00+01:00",
      effectiveEventId: "effective-correction",
      originalEventId: "original-in",
      correctionId: "active-correction",
    });

    expect(result.primary).toMatchObject({
      correction_kind: "replace",
      original_event_id: null,
      supersedes_correction_id: "active-correction",
      event_type: "clock_in",
    });
  });

  it("rejects a correction timestamp from another London operational date", () => {
    expect(() => buildAttendanceExceptionResolutionPlan({
      operationId: "00000000-0000-4000-8000-000000000503",
      staffId: "staff-1",
      operationalDate: "2026-08-02",
      resolutionKind: "add_missing_clock_out",
      eventTimestamp: "2026-08-03T00:05:00+01:00",
    })).toThrow(/same attendance date/i);
  });
});
