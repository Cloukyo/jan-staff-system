import { describe, expect, it } from "vitest";
import { deriveStaffOperationsStatus } from "@/lib/operations/staff-readiness";

describe("connected staff operations status", () => {
  it("keeps compliance, rota, attendance, leave and payroll states distinct", () => {
    const result = deriveStaffOperationsStatus({
      recruitmentStatus: "ready",
      plannedMinutes: 2100,
      attendanceBlockers: 0,
      attendanceWarnings: 1,
      pendingLeaveRequests: 0,
      payrollBlockers: 0,
      payrollWarnings: 1,
      payrollApproved: false,
    });
    expect(result.overall).toBe("needs_attention");
    expect(result.stages).toMatchObject({
      compliance: "ready",
      rota: "ready",
      attendance: "needs_attention",
      leave: "information",
      payroll: "needs_attention",
    });
  });

  it("never lets compliance status change payable minutes", () => {
    const input = {
      plannedMinutes: 480,
      attendanceBlockers: 0,
      attendanceWarnings: 0,
      pendingLeaveRequests: 0,
      payrollBlockers: 0,
      payrollWarnings: 0,
      payrollApproved: true,
    } as const;
    expect("payableMinutes" in deriveStaffOperationsStatus({ ...input, recruitmentStatus: "ready" })).toBe(false);
    expect("payableMinutes" in deriveStaffOperationsStatus({ ...input, recruitmentStatus: "blocked" })).toBe(false);
  });

  it("makes recruitment and attendance blockers authoritative", () => {
    expect(deriveStaffOperationsStatus({
      recruitmentStatus: "blocked",
      plannedMinutes: 0,
      attendanceBlockers: 2,
      attendanceWarnings: 0,
      pendingLeaveRequests: 1,
      payrollBlockers: 2,
      payrollWarnings: 0,
      payrollApproved: false,
    })).toMatchObject({
      overall: "blocked",
      stages: { compliance: "blocked", attendance: "blocked", leave: "needs_attention", payroll: "blocked" },
    });
  });
});
