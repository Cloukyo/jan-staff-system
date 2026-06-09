export type PayType = "hourly" | "salaried";
export type EmploymentStatus = "employed" | "former" | "on_leave";
export type ShiftStatus = "working" | "off" | "holiday" | "sick" | "training";
export type ClockEventType = "clock_in" | "break_start" | "break_end" | "clock_out";
export type ClockEventSource = "kiosk" | "manager";
export type ReviewStatus = "needs_review" | "approved" | "draft";
export type PayStatus = "draft" | "reviewed" | "exported";
export type PayTreatment = "paid" | "unpaid" | "informational";

export interface StaffMember {
  id: string;
  fullName: string;
  displayName: string;
  role: string;
  employmentStatus: EmploymentStatus;
  payType: PayType;
  hourlyRatePence: number | null;
  monthlySalaryPence: number | null;
  contractedWeeklyMinutes: number;
  defaultBreakMinutes: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  pinHash: string;
  pinIsTemporary: boolean;
  failedPinAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayRateHistory {
  id: string;
  staffId: string;
  payType: PayType;
  hourlyRatePence: number | null;
  monthlySalaryPence: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface RotaShift {
  id: string;
  staffId: string;
  date: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  status: ShiftStatus;
  plannedBreakMinutes: number;
  payTreatment?: PayTreatment;
  creditedMinutes?: number;
  payableMinutes?: number;
  managerNote?: string;
  roomOrRole?: string;
  notes?: string;
}

export interface ClockEvent {
  id: string;
  staffId: string;
  timestamp: string;
  type: ClockEventType;
  source: ClockEventSource;
  createdAt: string;
}

export interface AttendanceAdjustment {
  id: string;
  staffId: string;
  date: string;
  originalRecordedMinutes: number;
  approvedMinutes: number;
  reason: string;
  managerName: string;
  managerNote?: string;
  createdAt: string;
}

export interface AttendanceApproval {
  id: string;
  staffId: string;
  date: string;
  approvedBy: string;
  approvedAt: string;
  approvalMethod: "individual" | "bulk_selected" | "bulk_range";
  recordedMinutesAtApproval: number;
  approvedMinutes: number;
  wasAdjusted: boolean;
  adjustmentReason: string | null;
  approvalVersion: number;
  previousApprovalId: string | null;
  managerName?: string;
  method?: "bulk_clean" | "individual_clean";
  createdAt: string;
}

export interface AttendanceDay {
  staffId: string;
  date: string;
  scheduledMinutes: number;
  creditedPaidMinutes: number;
  payableStatusMinutes: number;
  recordedMinutes: number;
  approvedPayableMinutes: number;
  provisionalPayableMinutes: number;
  firstClockIn: string | null;
  finalClockOut: string | null;
  breakMinutes: number;
  exceptionFlags: string[];
  approvalStatus: ReviewStatus;
  managerNote: string;
  adjustmentReason?: string;
  events: ClockEvent[];
  shift?: RotaShift;
}

export interface PayPeriodSummary {
  staffId: string;
  periodStart: string;
  periodEnd: string;
  payType: PayType;
  recordedMinutes: number;
  approvedMinutes: number;
  provisionalMinutes: number;
  workedApprovedMinutes: number;
  paidHolidayMinutes: number;
  paidSicknessMinutes: number;
  paidTrainingMinutes: number;
  otherPaidMinutes: number;
  unresolvedAttendanceCount: number;
  cleanUnapprovedCount: number;
  missingClockDataCount: number;
  applicableHourlyRatePence: number | null;
  calculatedHourlyPayPence: number | null;
  provisionalHourlyPayPence: number | null;
  standardSalaryPence: number | null;
  additionsPence: number;
  deductionsPence: number;
  finalGrossPayPence: number;
  managerNotes: string;
  status: PayStatus;
}

export interface NurserySettings {
  nurseryDisplayName: string;
  defaultBreakMinutes: number;
  lateArrivalThresholdMinutes: number;
  overtimeWarningThresholdMinutes: number;
  maximumShiftMinutes: number;
  showWeekends: boolean;
  kioskAutoReturnSeconds: number;
  attendanceDefaultRange: "current_week" | "current_month";
  attendanceDefaultTab: "needs_review" | "ready" | "approved" | "all";
  attendancePageSize: 25 | 50 | 100;
  materialPayAdjustmentThresholdPence: number;
  defaultHolidayPayTreatment: PayTreatment;
  defaultSicknessPayTreatment: PayTreatment;
  defaultTrainingPayTreatment: PayTreatment;
  allowBulkCleanApproval: boolean;
  showProvisionalHourlyPay: boolean;
  demoToday: string;
}

export interface DemoState {
  schemaVersion?: number;
  staff: StaffMember[];
  payRates: PayRateHistory[];
  rota: RotaShift[];
  clockEvents: ClockEvent[];
  attendanceAdjustments: AttendanceAdjustment[];
  attendanceApprovals: AttendanceApproval[];
  paySummaries: PayPeriodSummary[];
  settings: NurserySettings;
}
