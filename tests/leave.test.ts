import { describe, expect, it } from "vitest";
import type { LeaveRequest, RotaShift } from "@/types";
import { calculateLeaveMinutes, findOverlappingLeave, findRotaLeaveWarnings, validateLeaveRequestInput } from "@/lib/calculations/leave";
import { rotaWarnings } from "@/lib/calculations/rota";

const baseRequest: LeaveRequest = {
  id: "leave-1",
  staffId: "staff",
  leaveType: "annual_leave",
  startDate: "2026-06-08",
  endDate: "2026-06-09",
  dayPart: "full_day",
  startTime: null,
  endTime: null,
  requestedMinutes: 900,
  staffNote: "",
  status: "pending",
  managerNote: null,
  reviewedBy: null,
  reviewedAt: null,
  cancelledAt: null,
  createdAt: "2026-06-01T09:00:00+01:00",
  updatedAt: "2026-06-01T09:00:00+01:00",
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

describe("leave request validation", () => {
  it("calculates full working days and excludes weekends", () => {
    expect(calculateLeaveMinutes({ startDate: "2026-06-05", endDate: "2026-06-08", dayPart: "full_day" })).toBe(900);
  });

  it("calculates partial-day hours for a single day", () => {
    expect(calculateLeaveMinutes({ startDate: "2026-06-08", endDate: "2026-06-08", dayPart: "partial_day", startTime: "10:00", endTime: "12:30" })).toBe(150);
  });

  it("rejects invalid date ranges and invalid partial-day times", () => {
    expect(validateLeaveRequestInput({ leaveType: "annual_leave", startDate: "2026-06-10", endDate: "2026-06-09", dayPart: "full_day" })).toContain("Start date cannot be after end date.");
    expect(validateLeaveRequestInput({ leaveType: "medical_appointment", startDate: "2026-06-10", endDate: "2026-06-10", dayPart: "partial_day", startTime: "12:00", endTime: "11:00" })).toContain("End time must be after start time.");
  });
});

describe("leave request permissions and conflicts", () => {
  it("blocks overlapping pending or approved requests", () => {
    expect(findOverlappingLeave([baseRequest], { staffId: "staff", startDate: "2026-06-09", endDate: "2026-06-10" })).toHaveLength(1);
    expect(findOverlappingLeave([{ ...baseRequest, status: "rejected" }], { staffId: "staff", startDate: "2026-06-09", endDate: "2026-06-10" })).toHaveLength(0);
    expect(findOverlappingLeave([{ ...baseRequest, status: "cancelled" }], { staffId: "staff", startDate: "2026-06-09", endDate: "2026-06-10" })).toHaveLength(0);
  });

  it("treats approved leave as a rota conflict and pending leave as a warning", () => {
    expect(findRotaLeaveWarnings(shift, [{ ...baseRequest, status: "approved" }])).toHaveLength(1);
    expect(rotaWarnings(shift, undefined, [{ ...baseRequest, status: "approved" }])).toContain("Approved leave conflict");
    expect(rotaWarnings(shift, undefined, [baseRequest])).toContain("Pending leave request");
  });

  it("does not block rota assignment for rejected or cancelled leave", () => {
    expect(rotaWarnings(shift, undefined, [{ ...baseRequest, status: "cancelled" }, { ...baseRequest, id: "leave-2", status: "rejected" }])).not.toContain("Approved leave conflict");
  });
});
