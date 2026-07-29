import { describe, expect, it } from "vitest";
import {
  createPayrollExportDetail,
  plannedShiftMinutes,
  splitPayrollDatesIntoWeeks,
} from "@/lib/exports/payroll-detail";
import { buildProductionAttendanceData } from "@/lib/payroll/server";
import type {
  PayrollAttendanceReview,
  PayrollRotaShift,
  ProductionAttendanceData,
  ProductionClockEvent,
  ProductionClockCorrectionRecord,
  ProductionStaffRow,
} from "@/lib/payroll/types";

const staff: ProductionStaffRow = {
  id: "staff-1",
  fullName: "Staff Member",
  displayName: "Staff",
  employmentRole: "Practitioner",
  mainQualificationLevel: null,
  active: true,
  loginStatus: "Active login",
  kioskStatus: "Enabled",
  isManager: false,
  payArrangements: [],
};

const shift = (
  id: string,
  shiftDate: string,
  startTime: string,
  endTime: string,
  breakMinutes: number,
  overrides: Partial<PayrollRotaShift> = {},
): PayrollRotaShift => ({
  id,
  staffId: staff.id,
  shiftDate,
  startTime,
  endTime,
  breakMinutes,
  status: "scheduled",
  archivedAt: null,
  ...overrides,
});

const event = (
  id: string,
  eventType: ProductionClockEvent["eventType"],
  eventTimestamp: string,
  managerCorrection = false,
): ProductionClockEvent => ({
  id,
  staffId: staff.id,
  eventType,
  eventTimestamp,
  recordedDate: eventTimestamp.slice(0, 10),
  managerCorrection,
});

function attendanceData(events: ProductionClockEvent[]): ProductionAttendanceData {
  const correctionRecords: ProductionClockCorrectionRecord[] = events
    .filter((item) => item.managerCorrection)
    .map((item) => ({
      id: item.id,
      batchId: `batch-${item.id}`,
      correctionRole: "primary",
      staffId: item.staffId,
      kind: "add",
      originalEventId: null,
      supersedesCorrectionId: null,
      eventType: item.eventType,
      eventTimestamp: item.eventTimestamp,
      recordedDate: item.recordedDate,
      reason: "Manager correction",
      createdBy: "manager",
      createdAt: item.eventTimestamp,
      sourceLabel: "Manager correction",
      status: "active",
    }));
  return {
    effectiveEvents: events,
    audit: {
      originalEvents: events.filter((item) => !item.managerCorrection),
      correctionRecords,
    },
  };
}

describe("payroll export detail calculations", () => {
  it("splits selected dates into partial and complete UK calendar weeks", () => {
    expect(splitPayrollDatesIntoWeeks([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
    ])).toEqual([
      ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"],
      ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"],
    ]);
  });

  it("calculates net planned minutes for ordinary and overnight shifts", () => {
    expect(plannedShiftMinutes(shift("day", "2026-07-01", "08:00", "17:00", 60))).toBe(480);
    expect(plannedShiftMinutes(shift("night", "2026-07-01", "20:00", "04:00", 30))).toBe(450);
  });

  it("includes future rota hours while excluding cancelled and archived shifts", () => {
    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [
        shift("first", "2026-07-02", "08:00", "13:00", 30),
        shift("second", "2026-07-02", "14:00", "18:00", 0),
        shift("cancelled", "2026-07-03", "08:00", "17:00", 60, { status: "cancelled" }),
        shift("archived", "2026-07-03", "09:00", "17:00", 30, { archivedAt: "2026-06-20T12:00:00Z" }),
      ],
      attendance: attendanceData([]),
      reviews: [],
      periodStart: "2026-07-01",
      periodEnd: "2026-07-03",
    });

    expect(detail.dates).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
    expect(detail.plannedRows[0].plannedMinutesByDate).toEqual({
      "2026-07-01": 0,
      "2026-07-02": 510,
      "2026-07-03": 0,
    });
    expect(detail.dailyRows).toHaveLength(1);
    expect(detail.dailyRows[0]).toMatchObject({
      date: "2026-07-02",
      plannedStart: "08:00, 14:00",
      plannedEnd: "13:00, 18:00",
      plannedBreakMinutes: 30,
      plannedMinutes: 510,
      rawWorkedMinutes: 0,
      workedMinutes: 0,
    });
  });

  it("keeps original and manager correction events separate in daily rows", () => {
    const reviews: PayrollAttendanceReview[] = [{
      staffId: staff.id,
      reviewDate: "2026-07-01",
      status: "corrected",
      reason: "Manager corrected arrival",
    }];
    const events = [
      event("original-in", "clock_in", "2026-07-01T08:00:00+01:00"),
      event("manager-in", "clock_in", "2026-07-01T08:15:00+01:00", true),
      event("original-out", "clock_out", "2026-07-01T16:00:00+01:00"),
      event("manager-out", "clock_out", "2026-07-01T16:00:00+01:00", true),
    ];

    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [shift("rota", "2026-07-01", "08:00", "16:30", 30)],
      attendance: attendanceData(events),
      reviews,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-01",
    });

    expect(detail.dailyRows).toHaveLength(1);
    expect(detail.dailyRows[0]).toMatchObject({
      originalClockIns: ["2026-07-01T08:00:00+01:00"],
      originalClockOuts: ["2026-07-01T16:00:00+01:00"],
      managerClockIns: ["2026-07-01T08:15:00+01:00"],
      managerClockOuts: ["2026-07-01T16:00:00+01:00"],
      rawWorkedMinutes: 480,
      workedMinutes: 465,
      reviewStatus: "corrected",
      reviewReason: "Manager corrected arrival",
    });
    expect(detail.dailyRows[0].warnings).toContain("Manager correction");
  });

  it("excludes legacy manager-entered originals from raw kiosk hours", () => {
    const rawIn = event("raw-in", "clock_in", "2026-07-01T08:00:00+01:00");
    const rawOut = event("raw-out", "clock_out", "2026-07-01T17:00:00+01:00");
    const legacyIn = event("legacy-in", "clock_in", "2026-07-01T18:00:00+01:00", true);
    const legacyOut = event("legacy-out", "clock_out", "2026-07-01T20:00:00+01:00", true);
    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [],
      attendance: {
        effectiveEvents: [rawIn, rawOut],
        audit: {
          originalEvents: [rawIn, rawOut, legacyIn, legacyOut],
          correctionRecords: [],
        },
      },
      reviews: [],
      periodStart: "2026-07-01",
      periodEnd: "2026-07-01",
    });

    expect(detail.dailyRows[0].rawWorkedMinutes).toBe(540);
    expect(detail.dailyRows[0].originalClockIns).toEqual([rawIn.eventTimestamp]);
    expect(detail.dailyRows[0].originalClockOuts).toEqual([rawOut.eventTimestamp]);
  });

  it("exports replaced originals separately while calculating from effective corrections", () => {
    const attendance = buildProductionAttendanceData(
      [{
        id: "original-in",
        staff_id: staff.id,
        event_type: "clock_in",
        event_timestamp: "2026-07-01T08:00:00+01:00",
        recorded_date: "2026-07-01",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }, {
        id: "original-out",
        staff_id: staff.id,
        event_type: "clock_out",
        event_timestamp: "2026-07-01T16:00:00+01:00",
        recorded_date: "2026-07-01",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }],
      [{
        id: "replacement-in",
        batch_id: "batch",
        correction_role: "primary",
        staff_id: staff.id,
        correction_kind: "replace",
        original_event_id: "original-in",
        supersedes_correction_id: null,
        event_type: "clock_in",
        event_timestamp: "2026-07-01T09:00:00+01:00",
        recorded_date: "2026-07-01",
        reason: "Confirmed late arrival",
        created_by: "manager",
        created_at: "2026-07-02T09:00:00Z",
      }],
    );

    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [],
      attendance,
      reviews: [],
      periodStart: "2026-07-01",
      periodEnd: "2026-07-01",
    });

    expect(detail.dailyRows[0]).toMatchObject({
      originalClockIns: ["2026-07-01T08:00:00+01:00"],
      originalClockOuts: ["2026-07-01T16:00:00+01:00"],
      managerClockIns: ["2026-07-01T09:00:00+01:00"],
      rawWorkedMinutes: 480,
      workedMinutes: 420,
      correctionRecords: [
        expect.objectContaining({
          id: "replacement-in",
          kind: "replace",
          status: "active",
        }),
      ],
    });
  });

  it("exports reset planned hours with a manager-added lunch separately from malformed originals", () => {
    const attendance = buildProductionAttendanceData(
      [{
        id: "original-in",
        staff_id: staff.id,
        event_type: "clock_in",
        event_timestamp: "2026-07-28T08:00:00+01:00",
        recorded_date: "2026-07-28",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }, {
        id: "original-lunch-out",
        staff_id: staff.id,
        event_type: "clock_out",
        event_timestamp: "2026-07-28T12:00:00+01:00",
        recorded_date: "2026-07-28",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }, {
        id: "original-lunch-in",
        staff_id: staff.id,
        event_type: "clock_in",
        event_timestamp: "2026-07-28T14:00:00+01:00",
        recorded_date: "2026-07-28",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }, {
        id: "original-out",
        staff_id: staff.id,
        event_type: "clock_out",
        event_timestamp: "2026-07-28T18:00:00+01:00",
        recorded_date: "2026-07-28",
        event_source: "kiosk",
        manager_correction: false,
        correction_reason: null,
      }],
      [{
        id: "reset-in",
        batch_id: "reset-batch",
        correction_role: "primary",
        staff_id: staff.id,
        correction_kind: "add",
        original_event_id: null,
        supersedes_correction_id: null,
        event_type: "clock_in",
        event_timestamp: "2026-07-28T08:00:00+01:00",
        recorded_date: "2026-07-28",
        reason: "Reset to planned hours",
        created_by: "manager",
        created_at: "2026-07-29T09:00:00Z",
      }, {
        id: "exclude-original-in",
        batch_id: "reset-batch",
        correction_role: "consequential",
        staff_id: staff.id,
        correction_kind: "exclude",
        original_event_id: "original-in",
        supersedes_correction_id: null,
        event_type: null,
        event_timestamp: null,
        recorded_date: "2026-07-28",
        reason: "Reset to planned hours",
        created_by: "manager",
        created_at: "2026-07-29T09:00:01Z",
      }, {
        id: "exclude-original-lunch-out",
        batch_id: "reset-batch",
        correction_role: "consequential",
        staff_id: staff.id,
        correction_kind: "exclude",
        original_event_id: "original-lunch-out",
        supersedes_correction_id: null,
        event_type: null,
        event_timestamp: null,
        recorded_date: "2026-07-28",
        reason: "Reset to planned hours",
        created_by: "manager",
        created_at: "2026-07-29T09:00:02Z",
      }, {
        id: "exclude-original-lunch-in",
        batch_id: "reset-batch",
        correction_role: "consequential",
        staff_id: staff.id,
        correction_kind: "exclude",
        original_event_id: "original-lunch-in",
        supersedes_correction_id: null,
        event_type: null,
        event_timestamp: null,
        recorded_date: "2026-07-28",
        reason: "Reset to planned hours",
        created_by: "manager",
        created_at: "2026-07-29T09:00:03Z",
      }, {
        id: "exclude-original-out",
        batch_id: "reset-batch",
        correction_role: "consequential",
        staff_id: staff.id,
        correction_kind: "exclude",
        original_event_id: "original-out",
        supersedes_correction_id: null,
        event_type: null,
        event_timestamp: null,
        recorded_date: "2026-07-28",
        reason: "Reset to planned hours",
        created_by: "manager",
        created_at: "2026-07-29T09:00:04Z",
      }, {
        id: "reset-out",
        batch_id: "reset-batch",
        correction_role: "consequential",
        staff_id: staff.id,
        correction_kind: "add",
        original_event_id: null,
        supersedes_correction_id: null,
        event_type: "clock_out",
        event_timestamp: "2026-07-28T18:00:00+01:00",
        recorded_date: "2026-07-28",
        reason: "Reset to planned hours",
        created_by: "manager",
        created_at: "2026-07-29T09:00:05Z",
      }, {
        id: "lunch-out",
        batch_id: "lunch-out-batch",
        correction_role: "primary",
        staff_id: staff.id,
        correction_kind: "add",
        original_event_id: null,
        supersedes_correction_id: null,
        event_type: "clock_out",
        event_timestamp: "2026-07-28T12:00:00+01:00",
        recorded_date: "2026-07-28",
        reason: "Add lunch",
        created_by: "manager",
        created_at: "2026-07-29T09:05:00Z",
      }, {
        id: "lunch-in",
        batch_id: "lunch-in-batch",
        correction_role: "primary",
        staff_id: staff.id,
        correction_kind: "add",
        original_event_id: null,
        supersedes_correction_id: null,
        event_type: "clock_in",
        event_timestamp: "2026-07-28T13:00:00+01:00",
        recorded_date: "2026-07-28",
        reason: "Add lunch",
        created_by: "manager",
        created_at: "2026-07-29T09:06:00Z",
      }],
    );

    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [],
      attendance,
      reviews: [],
      periodStart: "2026-07-28",
      periodEnd: "2026-07-28",
    });
    const row = detail.dailyRows[0];

    expect(row.rawWorkedMinutes).toBe(480);
    expect(row.workedMinutes).toBe(540);
    expect(row.originalClockIns).toContain("2026-07-28T08:00:00+01:00");
    expect(row.correctionRecords).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "exclude" })]),
    );
  });

  it("adds incomplete-review warnings to clocked dates without reviews", () => {
    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [],
      attendance: attendanceData([
        event("in", "clock_in", "2026-07-01T08:00:00+01:00"),
        event("out", "clock_out", "2026-07-01T16:00:00+01:00"),
      ]),
      reviews: [],
      periodStart: "2026-07-01",
      periodEnd: "2026-07-01",
    });

    expect(detail.dailyRows[0].reviewStatus).toBe("not_reviewed");
    expect(detail.dailyRows[0].warnings).toContain("Attendance review incomplete");
  });

  it("sums completed sessions and excludes the clocked-out break", () => {
    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [],
      attendance: attendanceData([
        event("morning-in", "clock_in", "2026-07-01T08:00:00+01:00"),
        event("break-out", "clock_out", "2026-07-01T12:00:00+01:00"),
        event("afternoon-in", "clock_in", "2026-07-01T13:00:00+01:00"),
        event("day-out", "clock_out", "2026-07-01T17:00:00+01:00"),
        event("manager-in", "clock_in", "2026-07-01T07:45:00+01:00", true),
      ]),
      reviews: [],
      periodStart: "2026-07-01",
      periodEnd: "2026-07-01",
    });

    expect(detail.dailyRows[0].rawWorkedMinutes).toBe(480);
  });
});
