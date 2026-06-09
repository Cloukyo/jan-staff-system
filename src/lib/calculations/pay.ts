import type { AttendanceDay, PayRateHistory, PayPeriodSummary, PayType, StaffMember } from "@/types";
import { hasSeriousException } from "@/lib/calculations/attendance";

export function calculateHourlyPayPence(approvedMinutes: number, hourlyRatePence: number): number {
  return Math.round((approvedMinutes * hourlyRatePence) / 60);
}

export function lookupPayRate(
  history: PayRateHistory[],
  staffId: string,
  asOfDate: string,
): PayRateHistory | undefined {
  return history
    .filter((rate) => rate.staffId === staffId && rate.effectiveFrom <= asOfDate && (!rate.effectiveTo || rate.effectiveTo >= asOfDate))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function createPaySummary(
  staff: StaffMember,
  days: AttendanceDay[],
  history: PayRateHistory[],
  periodStart: string,
  periodEnd: string,
  existing?: Partial<PayPeriodSummary>,
): PayPeriodSummary {
  const recordedMinutes = days.reduce((sum, day) => sum + day.recordedMinutes, 0);
  const approvedMinutes = days.reduce((sum, day) => sum + day.approvedPayableMinutes, 0);
  const provisionalMinutes = days.reduce((sum, day) => sum + day.provisionalPayableMinutes, 0);
  const workedApprovedMinutes = days.reduce((sum, day) => sum + (day.shift?.status === "working" ? day.approvedPayableMinutes : 0), 0);
  const paidHolidayMinutes = days.reduce((sum, day) => sum + (day.shift?.status === "holiday" ? day.approvedPayableMinutes : 0), 0);
  const paidSicknessMinutes = days.reduce((sum, day) => sum + (day.shift?.status === "sick" ? day.approvedPayableMinutes : 0), 0);
  const paidTrainingMinutes = days.reduce((sum, day) => sum + (day.shift?.status === "training" ? day.approvedPayableMinutes : 0), 0);
  const otherPaidMinutes = Math.max(0, approvedMinutes - workedApprovedMinutes - paidHolidayMinutes - paidSicknessMinutes - paidTrainingMinutes);
  const unresolvedAttendanceCount = days.filter((day) => day.approvalStatus === "needs_review" || hasSeriousException(day)).length;
  const cleanUnapprovedCount = days.filter((day) => day.approvalStatus === "draft" && day.provisionalPayableMinutes > 0).length;
  const missingClockDataCount = days.filter((day) => day.exceptionFlags.some((flag) => flag.includes("clock"))).length;
  const rate = lookupPayRate(history, staff.id, periodEnd);
  const payType: PayType = rate?.payType ?? staff.payType;
  const hourlyRate = rate?.hourlyRatePence ?? staff.hourlyRatePence;
  const salary = rate?.monthlySalaryPence ?? staff.monthlySalaryPence;
  const calculatedHourlyPayPence = payType === "hourly" && hourlyRate ? calculateHourlyPayPence(approvedMinutes, hourlyRate) : null;
  const provisionalHourlyPayPence = payType === "hourly" && hourlyRate ? calculateHourlyPayPence(provisionalMinutes, hourlyRate) : null;
  const standardSalaryPence = payType === "salaried" ? salary : null;
  const suggested = payType === "hourly" ? calculatedHourlyPayPence ?? 0 : standardSalaryPence ?? 0;
  const additionsPence = existing?.additionsPence ?? 0;
  const deductionsPence = existing?.deductionsPence ?? 0;

  return {
    staffId: staff.id,
    periodStart,
    periodEnd,
    payType,
    recordedMinutes,
    approvedMinutes,
    provisionalMinutes,
    workedApprovedMinutes,
    paidHolidayMinutes,
    paidSicknessMinutes,
    paidTrainingMinutes,
    otherPaidMinutes,
    unresolvedAttendanceCount,
    cleanUnapprovedCount,
    missingClockDataCount,
    applicableHourlyRatePence: payType === "hourly" ? hourlyRate : null,
    calculatedHourlyPayPence,
    provisionalHourlyPayPence,
    standardSalaryPence,
    additionsPence,
    deductionsPence,
    finalGrossPayPence: existing?.finalGrossPayPence ?? suggested + additionsPence - deductionsPence,
    managerNotes: existing?.managerNotes ?? "",
    status: existing?.status ?? "draft",
  };
}
