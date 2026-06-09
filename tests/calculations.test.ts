import { describe, expect, it } from "vitest";
import type { AttendanceApproval, AttendanceAdjustment, ClockEvent, NurserySettings, PayRateHistory, RotaShift, StaffMember } from "@/types";
import { calculateAttendanceDay, isCleanApprovalCandidate } from "@/lib/calculations/attendance";
import { calculateHourlyPayPence, createPaySummary, lookupPayRate } from "@/lib/calculations/pay";
import { shiftPayableStatusMinutes, shiftScheduledMinutes, weeklyRotaTotal } from "@/lib/calculations/rota";
import { createCsvContent, escapeCsv } from "@/lib/exports/csv";
import { createPayWorkbook } from "@/lib/exports/xlsx";
import { formatDurationCompact } from "@/lib/dates/format";
import { createDemoClock } from "@/lib/dates/app-clock";
import { migrateState, repairContractedWeeklyMinutes } from "@/lib/repositories/demo-store";

const settings: NurserySettings = {
  nurseryDisplayName: "Jan Pre-School and Nursery",
  defaultBreakMinutes: 30,
  lateArrivalThresholdMinutes: 10,
  overtimeWarningThresholdMinutes: 30,
  maximumShiftMinutes: 720,
  showWeekends: false,
  kioskAutoReturnSeconds: 4,
  attendanceDefaultRange: "current_week",
  attendanceDefaultTab: "needs_review",
  attendancePageSize: 25,
  materialPayAdjustmentThresholdPence: 100,
  defaultHolidayPayTreatment: "paid",
  defaultSicknessPayTreatment: "unpaid",
  defaultTrainingPayTreatment: "paid",
  allowBulkCleanApproval: true,
  showProvisionalHourlyPay: true,
  demoToday: "2026-06-08",
};

const shift: RotaShift = {
  id: "shift",
  staffId: "staff",
  date: "2026-06-08",
  scheduledStart: "09:00",
  scheduledEnd: "17:00",
  status: "working",
  plannedBreakMinutes: 30,
};

function event(type: ClockEvent["type"], time: string): ClockEvent {
  return { id: `${type}-${time}`, staffId: "staff", type, timestamp: `2026-06-08T${time}:00+01:00`, source: "kiosk", createdAt: `2026-06-08T${time}:00+01:00` };
}

function day(events: ClockEvent[], rota: RotaShift | null = shift, adjustment?: AttendanceAdjustment, approval?: AttendanceApproval) {
  return calculateAttendanceDay("staff", "2026-06-08", events, rota ?? undefined, adjustment, approval, settings);
}

const hourly: StaffMember = {
  id: "staff",
  fullName: "Test Staff",
  displayName: "Test",
  role: "Practitioner",
  employmentStatus: "employed",
  payType: "hourly",
  hourlyRatePence: 1275,
  monthlySalaryPence: null,
  contractedWeeklyMinutes: 1800,
  defaultBreakMinutes: 30,
  startDate: "2026-01-01",
  endDate: null,
  active: true,
  pinHash: "x",
  pinIsTemporary: false,
  failedPinAttempts: 0,
  lockedUntil: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

describe("attendance calculations", () => {
  it("calculates a standard completed shift as ready to approve", () => {
    const result = day([event("clock_in", "09:00"), event("clock_out", "17:00")]);
    expect(result.recordedMinutes).toBe(480);
    expect(result.approvalStatus).toBe("draft");
    expect(isCleanApprovalCandidate(result)).toBe(true);
  });

  it("subtracts one unpaid break", () => {
    const result = day([event("clock_in", "09:00"), event("break_start", "12:00"), event("break_end", "12:30"), event("clock_out", "17:00")]);
    expect(result.recordedMinutes).toBe(450);
    expect(result.breakMinutes).toBe(30);
  });

  it("subtracts multiple breaks", () => {
    const result = day([event("clock_in", "09:00"), event("break_start", "11:00"), event("break_end", "11:15"), event("break_start", "14:00"), event("break_end", "14:20"), event("clock_out", "17:00")]);
    expect(result.breakMinutes).toBe(35);
    expect(result.recordedMinutes).toBe(445);
  });

  it("flags missing clock-out and excludes it from bulk approval", () => {
    const result = day([event("clock_in", "09:00")]);
    expect(result.recordedMinutes).toBe(0);
    expect(result.exceptionFlags).toContain("Missing clock-out");
    expect(isCleanApprovalCandidate(result)).toBe(false);
  });

  it("flags invalid event ordering", () => {
    const result = day([event("break_end", "12:30"), event("clock_in", "09:00"), event("clock_out", "17:00")]);
    expect(result.exceptionFlags).toContain("Break end without break start");
  });

  it("flags duplicate clock-in", () => {
    const result = day([event("clock_in", "09:00"), event("clock_in", "09:01"), event("clock_out", "17:00")]);
    expect(result.exceptionFlags).toContain("Duplicate clock in");
  });

  it("flags unscheduled attendance", () => {
    const result = day([event("clock_in", "09:00"), event("clock_out", "12:00")], null);
    expect(result.exceptionFlags).toContain("Unscheduled attendance");
  });

  it("uses approval metadata without creating an adjustment", () => {
    const approval: AttendanceApproval = { id: "apr", staffId: "staff", date: "2026-06-08", approvedBy: "Nursery Manager", approvedAt: "2026-06-08", approvalMethod: "bulk_selected", recordedMinutesAtApproval: 480, approvedMinutes: 480, wasAdjusted: false, adjustmentReason: null, approvalVersion: 1, previousApprovalId: null, createdAt: "2026-06-08" };
    const result = day([event("clock_in", "09:00"), event("clock_out", "17:00")], shift, undefined, approval);
    expect(result.approvalStatus).toBe("approved");
    expect(result.approvedPayableMinutes).toBe(480);
  });

  it("flags approved minutes differing from recorded minutes", () => {
    const adjustment: AttendanceAdjustment = { id: "a", staffId: "staff", date: "2026-06-08", originalRecordedMinutes: 480, approvedMinutes: 450, reason: "Manager correction", managerName: "Manager", createdAt: "2026-06-08T17:30:00+01:00" };
    const result = day([event("clock_in", "09:00"), event("clock_out", "17:00")], shift, adjustment);
    expect(result.approvedPayableMinutes).toBe(450);
    expect(result.exceptionFlags).toContain("Approved differs from recorded");
  });
});

describe("rota and status pay", () => {
  it("formats contracted hours correctly and repairs legacy hour values", () => {
    expect(formatDurationCompact(2400)).toBe("40 hrs");
    expect(formatDurationCompact(2250)).toBe("37h 30m");
    expect(repairContractedWeeklyMinutes(40)).toBe(2400);
    expect(repairContractedWeeklyMinutes(2400)).toBe(2400);
    expect(migrateState({ staff: [{ ...hourly, contractedWeeklyMinutes: 40 }] }).staff[0].contractedWeeklyMinutes).toBe(2400);
  });

  it("includes paid holiday and excludes unpaid holiday", () => {
    const paid: RotaShift = { ...shift, status: "holiday", scheduledStart: null, scheduledEnd: null, payTreatment: "paid", creditedMinutes: 450, payableMinutes: 450 };
    const unpaid: RotaShift = { ...paid, payTreatment: "unpaid", payableMinutes: 0 };
    expect(shiftPayableStatusMinutes(paid)).toBe(450);
    expect(shiftPayableStatusMinutes(unpaid)).toBe(0);
  });

  it("handles paid sickness and paid training", () => {
    const sick: RotaShift = { ...shift, status: "sick", scheduledStart: null, scheduledEnd: null, payTreatment: "paid", creditedMinutes: 450, payableMinutes: 450 };
    const training: RotaShift = { ...shift, status: "training", scheduledStart: null, scheduledEnd: null, payTreatment: "paid", creditedMinutes: 360, payableMinutes: 360 };
    expect(shiftPayableStatusMinutes(sick)).toBe(450);
    expect(shiftPayableStatusMinutes(training)).toBe(360);
  });

  it("calculates weekly rota totals", () => {
    expect(shiftScheduledMinutes(shift)).toBe(450);
    expect(weeklyRotaTotal("staff", [shift, { ...shift, id: "shift-2", date: "2026-06-09" }])).toBe(900);
  });
});

describe("pay calculations", () => {
  it("calculates hourly pay using integer pence and minute rounding", () => {
    expect(calculateHourlyPayPence(455, 1275)).toBe(9669);
  });

  it("keeps salaried pay unchanged by attendance variance", () => {
    const salaried = { ...hourly, payType: "salaried" as const, hourlyRatePence: null, monthlySalaryPence: 250000 };
    const summary = createPaySummary(salaried, [{ ...day([]), recordedMinutes: 120, approvedPayableMinutes: 120, exceptionFlags: [], approvalStatus: "approved" }], [], "2026-06-01", "2026-06-30");
    expect(summary.finalGrossPayPence).toBe(250000);
  });

  it("calculates provisional hourly pay and category totals", () => {
    const clean = day([event("clock_in", "09:00"), event("clock_out", "17:00")]);
    const holiday = { ...day([], { ...shift, status: "holiday", scheduledStart: null, scheduledEnd: null, payTreatment: "paid", creditedMinutes: 450, payableMinutes: 450 }, undefined, { id: "apr", staffId: "staff", date: "2026-06-08", approvedBy: "Nursery Manager", approvedAt: "2026-06-08", approvalMethod: "bulk_selected", recordedMinutesAtApproval: 450, approvedMinutes: 450, wasAdjusted: false, adjustmentReason: null, approvalVersion: 1, previousApprovalId: null, createdAt: "x" }), approvedPayableMinutes: 450 };
    const summary = createPaySummary(hourly, [clean, holiday], [], "2026-06-01", "2026-06-30");
    expect(summary.provisionalMinutes).toBe(480);
    expect(summary.paidHolidayMinutes).toBe(450);
    expect(summary.provisionalHourlyPayPence).toBe(10200);
  });

  it("preserves effective pay-rate lookup", () => {
    const history: PayRateHistory[] = [
      { id: "old", staffId: "staff", payType: "hourly", hourlyRatePence: 1200, monthlySalaryPence: null, effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31", createdAt: "2026-01-01" },
      { id: "new", staffId: "staff", payType: "hourly", hourlyRatePence: 1300, monthlySalaryPence: null, effectiveFrom: "2026-06-01", effectiveTo: null, createdAt: "2026-06-01" },
    ];
    expect(lookupPayRate(history, "staff", "2026-05-01")?.hourlyRatePence).toBe(1200);
    expect(lookupPayRate(history, "staff", "2026-06-08")?.hourlyRatePence).toBe(1300);
  });

  it("supports final gross pay summary totals and material change threshold checks", () => {
    const summary = createPaySummary(hourly, [], [], "2026-06-01", "2026-06-30", { finalGrossPayPence: 5000, additionsPence: 100, deductionsPence: 0 });
    expect(summary.finalGrossPayPence).toBe(5000);
    expect(Math.abs(summary.finalGrossPayPence - 100) >= settings.materialPayAdjustmentThresholdPence).toBe(true);
  });
});

describe("exports", () => {
  it("creates UTF-8 BOM CSV and preserves pound signs", () => {
    const csv = createCsvContent([["Amount"], ["£3,250.00"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("£3,250.00");
    expect(csv).toContain("\r\n");
  });

  it("escapes commas and quotes safely", () => {
    expect(escapeCsv('A value, with "quotes"')).toBe('"A value, with ""quotes"""');
  });

  it("creates a two-sheet XLSX workbook", () => {
    const summary = createPaySummary(hourly, [], [], "2026-06-01", "2026-06-30");
    const workbook = createPayWorkbook([summary], [], [hourly], "2026-06-01", "2026-06-30");
    expect(workbook.SheetNames).toEqual(["Pay Summary", "Attendance Detail"]);
    expect(workbook.Sheets["Pay Summary"]["!autofilter"]).toBeTruthy();
  });

  it("supports export preview counts", () => {
    const clean = day([event("clock_in", "09:00"), event("clock_out", "17:00")]);
    const unresolved = day([event("clock_in", "09:00")]);
    const days = [clean, unresolved];
    expect(days.filter((item) => item.provisionalPayableMinutes > 0).length).toBe(1);
    expect(days.filter((item) => item.approvalStatus === "needs_review").length).toBe(1);
  });
});

describe("app clock", () => {
  it("uses the configured demo date for today, week and month", () => {
    const clock = createDemoClock("2026-06-10");
    expect(clock.today()).toBe("2026-06-10");
    expect(clock.currentWeekStart()).toBe("2026-06-08");
    expect(clock.currentMonthRange()).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
});
