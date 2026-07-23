import { describe, expect, it } from "vitest";
import {
  createPayrollExportDetail,
  plannedShiftMinutes,
  splitPayrollDatesIntoWeeks,
} from "@/lib/exports/payroll-detail";
import type {
  PayrollAttendanceReview,
  PayrollRotaShift,
  ProductionClockEvent,
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
      events: [],
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
      events,
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

  it("adds incomplete-review warnings to clocked dates without reviews", () => {
    const detail = createPayrollExportDetail({
      staff: [staff],
      shifts: [],
      events: [
        event("in", "clock_in", "2026-07-01T08:00:00+01:00"),
        event("out", "clock_out", "2026-07-01T16:00:00+01:00"),
      ],
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
      events: [
        event("morning-in", "clock_in", "2026-07-01T08:00:00+01:00"),
        event("break-out", "clock_out", "2026-07-01T12:00:00+01:00"),
        event("afternoon-in", "clock_in", "2026-07-01T13:00:00+01:00"),
        event("day-out", "clock_out", "2026-07-01T17:00:00+01:00"),
        event("manager-in", "clock_in", "2026-07-01T07:45:00+01:00", true),
      ],
      reviews: [],
      periodStart: "2026-07-01",
      periodEnd: "2026-07-01",
    });

    expect(detail.dailyRows[0].rawWorkedMinutes).toBe(480);
  });
});
