import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/demo-data/seed";
import { calculateAttendanceDay } from "@/lib/calculations/attendance";
import { createMemoryStorage, DEMO_STORAGE_KEY, loadDemoStateFromStorage, saveDemoStateToStorage } from "@/lib/repositories/local-persistence";
import { migrateState, repairContractedWeeklyMinutes } from "@/lib/repositories/demo-store";
import type { AttendanceApproval, ClockEvent, RotaShift } from "@/types";

describe("local repository persistence and migrations", () => {
  it("saves a staff member and reloads from persistence", () => {
    const state = createSeedState();
    state.staff.push({ ...state.staff[0], id: "stf-new", fullName: "New Staff", displayName: "New" });
    const storage = createMemoryStorage();
    expect(saveDemoStateToStorage(storage, state).ok).toBe(true);
    expect(loadDemoStateFromStorage(storage).state.staff.some((staff) => staff.id === "stf-new")).toBe(true);
  });

  it("preserves historic pay rates when a new rate is added", () => {
    const state = createSeedState();
    state.payRates.push({ id: "rate-new", staffId: "stf-003", payType: "hourly", hourlyRatePence: 1600, monthlySalaryPence: null, effectiveFrom: "2026-07-01", effectiveTo: null, createdAt: "2026-07-01" });
    const loaded = loadDemoStateFromStorage(createMemoryStorage({ [DEMO_STORAGE_KEY]: JSON.stringify(state) })).state;
    expect(loaded.payRates.filter((rate) => rate.staffId === "stf-003").length).toBeGreaterThan(1);
  });

  it("marks staff inactive while preserving historic attendance", () => {
    const state = createSeedState();
    state.staff[2].active = false;
    const eventCount = state.clockEvents.filter((event) => event.staffId === state.staff[2].id).length;
    const loaded = loadDemoStateFromStorage(createMemoryStorage({ [DEMO_STORAGE_KEY]: JSON.stringify(state) })).state;
    expect(loaded.staff[2].active).toBe(false);
    expect(loaded.clockEvents.filter((event) => event.staffId === loaded.staff[2].id).length).toBe(eventCount);
  });

  it("persists rota shifts and special-status pay treatment", () => {
    const state = createSeedState();
    const shift: RotaShift = { id: "scenario-holiday", staffId: "stf-003", date: "2026-06-10", status: "holiday", scheduledStart: null, scheduledEnd: null, plannedBreakMinutes: 0, payTreatment: "paid", creditedMinutes: 450, payableMinutes: 450 };
    state.rota.push(shift);
    const loaded = loadDemoStateFromStorage(createMemoryStorage({ [DEMO_STORAGE_KEY]: JSON.stringify(state) })).state;
    expect(loaded.rota.find((item) => item.id === "scenario-holiday")?.payTreatment).toBe("paid");
  });

  it("persists clock events, approvals, adjustments and pay edits after reload", () => {
    const state = createSeedState();
    const event: ClockEvent = { id: "scenario-clock", staffId: "stf-003", timestamp: "2026-06-08T08:00:00+01:00", type: "clock_in", source: "kiosk", createdAt: "2026-06-08T08:00:00+01:00" };
    state.clockEvents.push(event);
    state.attendanceApprovals.push({
      id: "apr-test",
      staffId: "stf-003",
      date: "2026-06-08",
      approvedBy: "Nursery Manager",
      approvedAt: "2026-06-08T17:00:00+01:00",
      approvalMethod: "bulk_selected",
      recordedMinutesAtApproval: 450,
      approvedMinutes: 450,
      wasAdjusted: false,
      adjustmentReason: null,
      approvalVersion: 1,
      previousApprovalId: null,
      createdAt: "2026-06-08T17:00:00+01:00",
    });
    state.attendanceAdjustments.push({ id: "adj-test", staffId: "stf-004", date: "2026-06-08", originalRecordedMinutes: 0, approvedMinutes: 420, reason: "Manager note", managerName: "Nursery Manager", createdAt: "2026-06-08" });
    state.paySummaries.push({ staffId: "stf-003", periodStart: "2026-06-01", periodEnd: "2026-06-30", payType: "hourly", recordedMinutes: 0, approvedMinutes: 0, provisionalMinutes: 0, workedApprovedMinutes: 0, paidHolidayMinutes: 0, paidSicknessMinutes: 0, paidTrainingMinutes: 0, otherPaidMinutes: 0, unresolvedAttendanceCount: 0, cleanUnapprovedCount: 0, missingClockDataCount: 0, applicableHourlyRatePence: 1475, calculatedHourlyPayPence: 0, provisionalHourlyPayPence: 0, standardSalaryPence: null, additionsPence: 100, deductionsPence: 0, finalGrossPayPence: 100, managerNotes: "Tea money", status: "reviewed" });
    const loaded = loadDemoStateFromStorage(createMemoryStorage({ [DEMO_STORAGE_KEY]: JSON.stringify(state) })).state;
    expect(loaded.clockEvents.some((item) => item.id === "scenario-clock")).toBe(true);
    expect(loaded.attendanceApprovals[0].approvalMethod).toBe("bulk_selected");
    expect(loaded.attendanceAdjustments.some((item) => item.id === "adj-test")).toBe(true);
    expect(loaded.paySummaries.some((item) => item.managerNotes === "Tea money")).toBe(true);
  });

  it("migrates schema version, legacy contract hours and partial old-schema defaults", () => {
    const migrated = migrateState({ staff: [{ ...createSeedState().staff[0], contractedWeeklyMinutes: 40 }], settings: { nurseryDisplayName: "Old" } as never });
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.staff[0].contractedWeeklyMinutes).toBe(2400);
    expect(migrated.settings.attendancePageSize).toBe(25);
    expect(repairContractedWeeklyMinutes(38)).toBe(2280);
  });

  it("handles missing and corrupted localStorage data", () => {
    expect(loadDemoStateFromStorage(createMemoryStorage()).state.staff.length).toBeGreaterThan(0);
    const result = loadDemoStateFromStorage(createMemoryStorage({ [DEMO_STORAGE_KEY]: "{broken" }));
    expect(result.error).toBeTruthy();
    expect(result.state.staff.length).toBeGreaterThan(0);
  });

  it("reset and reseed restores staff count", () => {
    const seed = createSeedState();
    expect(createSeedState().staff.length).toBe(seed.staff.length);
  });

  it("inactive staff can still appear in historic reports", () => {
    const state = createSeedState();
    const former = state.staff.find((staff) => !staff.active);
    expect(former?.active).toBe(false);
    expect(state.staff.some((staff) => !staff.active)).toBe(true);
  });

  it("scenario data can be identified and removed without unrelated records", () => {
    const state = createSeedState();
    const originalClockEvents = state.clockEvents.length;
    state.clockEvents.push({ id: "scenario-missing-out", staffId: "stf-003", timestamp: "2026-06-08T08:00:00+01:00", type: "clock_in", source: "manager", createdAt: "2026-06-08" });
    const cleaned = state.clockEvents.filter((event) => !event.id.startsWith("scenario-"));
    expect(cleaned.length).toBe(originalClockEvents);
  });

  it("approval history links previous approval ids", () => {
    const previous: AttendanceApproval = { id: "old", staffId: "stf-003", date: "2026-06-08", approvedBy: "Nursery Manager", approvedAt: "2026-06-08", approvalMethod: "bulk_selected", recordedMinutesAtApproval: 450, approvedMinutes: 450, wasAdjusted: false, adjustmentReason: null, approvalVersion: 1, previousApprovalId: null, createdAt: "2026-06-08" };
    const current: AttendanceApproval = { ...previous, id: "new", approvalVersion: 2, previousApprovalId: "old", approvalMethod: "individual" };
    expect(current.previousApprovalId).toBe(previous.id);
  });

  it("duplicate consecutive clock events remain visible for review", () => {
    const seed = createSeedState();
    const staffId = "stf-003";
    const events = [
      { id: "a", staffId, timestamp: "2026-06-08T08:00:00+01:00", type: "clock_in", source: "kiosk", createdAt: "x" },
      { id: "b", staffId, timestamp: "2026-06-08T08:01:00+01:00", type: "clock_in", source: "kiosk", createdAt: "x" },
    ] satisfies ClockEvent[];
    const day = calculateAttendanceDay(staffId, "2026-06-08", events, seed.rota.find((shift) => shift.staffId === staffId && shift.date === "2026-06-08"), undefined, undefined, seed.settings);
    expect(day.exceptionFlags).toContain("Duplicate clock in");
  });
});
