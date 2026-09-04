export type OperationalStageStatus = "blocked" | "needs_attention" | "ready" | "information";
export type StaffOperationsInput = {
  recruitmentStatus: OperationalStageStatus;
  plannedMinutes: number;
  attendanceBlockers: number;
  attendanceWarnings: number;
  pendingLeaveRequests: number;
  payrollBlockers: number;
  payrollWarnings: number;
  payrollApproved: boolean;
};

export function deriveStaffOperationsStatus(input: StaffOperationsInput) {
  const stages = {
    compliance: input.recruitmentStatus,
    rota: input.plannedMinutes > 0 ? "ready" : "information",
    attendance: input.attendanceBlockers > 0 ? "blocked" : input.attendanceWarnings > 0 ? "needs_attention" : "ready",
    leave: input.pendingLeaveRequests > 0 ? "needs_attention" : "information",
    payroll: input.payrollBlockers > 0 ? "blocked" : input.payrollWarnings > 0 || !input.payrollApproved ? "needs_attention" : "ready",
  } satisfies Record<string, OperationalStageStatus>;
  const values = Object.values(stages);
  const overall: OperationalStageStatus = values.includes("blocked") ? "blocked" : values.includes("needs_attention") ? "needs_attention" : "ready";
  return { overall, stages };
}
