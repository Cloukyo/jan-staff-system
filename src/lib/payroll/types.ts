export type ProductionPayType = "hourly" | "salaried";
export type PayrollHoursBasis = "contracted" | "variable_hours" | "casual" | "zero_hours" | "salaried_untracked";

export type PayArrangement = {
  id: string;
  staffId: string;
  payType: ProductionPayType;
  hourlyRate: number | null;
  annualSalary: number | null;
  monthlySalary: number | null;
  contractedWeeklyHours: number | null;
  hoursBasis: PayrollHoursBasis;
  standardDailyHours: number | null;
  overtimeMultiplier: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  managerNotes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ProductionStaffRow = {
  id: string;
  fullName: string;
  displayName: string;
  employmentRole: string;
  mainQualificationLevel: string | null;
  active: boolean;
  loginStatus: string;
  kioskStatus: string;
  isManager: boolean;
  payArrangements: PayArrangement[];
};

export type StaffDirectoryRow = {
  id: string;
  fullName: string;
  displayName: string;
  employmentRole: string;
  active: boolean;
  loginStatus: string;
  kioskStatus: string;
  hasQualification: boolean;
  hasCurrentPayArrangement: boolean;
  hasComplianceIssues: boolean;
};

export type ProductionClockEvent = {
  id: string;
  orderKey?: string;
  staffId: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  recordedDate: string;
  managerCorrection: boolean;
  ledger?: "original" | "effective";
};

export type ProductionClockCorrectionRecord = {
  id: string;
  batchId: string;
  correctionRole: "primary" | "consequential";
  staffId: string;
  kind: "add" | "replace" | "exclude";
  originalEventId: string | null;
  supersedesCorrectionId: string | null;
  eventType: ProductionClockEvent["eventType"] | null;
  eventTimestamp: string | null;
  recordedDate: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  sourceLabel: "Manager correction";
  status: "active" | "superseded";
};

export type ProductionAttendanceData = {
  effectiveEvents: ProductionClockEvent[];
  audit: {
    originalEvents: ProductionClockEvent[];
    correctionRecords: ProductionClockCorrectionRecord[];
  };
};

export type PayrollAttendanceReview = {
  staffId: string;
  reviewDate: string;
  status: "approved" | "corrected" | "ignored" | "needs_staff_clarification";
  reason: string | null;
};

export type PayrollRotaShift = {
  id: string;
  staffId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  status: "scheduled" | "cancelled" | "completed";
  archivedAt: string | null;
};

export type PayrollPlannedRow = {
  staffId: string;
  fullName: string;
  employmentRole: string;
  plannedMinutesByDate: Record<string, number>;
};

export type PayrollDailyRow = {
  staffId: string;
  fullName: string;
  employmentRole: string;
  date: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedBreakMinutes: number;
  plannedMinutes: number;
  originalClockIns: string[];
  originalClockOuts: string[];
  managerClockIns: string[];
  managerClockOuts: string[];
  correctionRecords: ProductionClockCorrectionRecord[];
  rawWorkedMinutes: number;
  workedMinutes: number;
  reviewStatus: PayrollAttendanceReview["status"] | "not_reviewed";
  reviewReason: string | null;
  warnings: string[];
};

export type PayrollExportDetail = {
  dates: string[];
  plannedRows: PayrollPlannedRow[];
  dailyRows: PayrollDailyRow[];
};

export type PayrollPreparationRow = {
  staffId: string;
  fullName: string;
  employmentRole: string;
  payType: ProductionPayType | null;
  contractedWeeklyHours: number | null;
  hoursBasis: PayrollHoursBasis | null;
  recordedMinutes: number;
  adjustedMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  hourlyRate: number | null;
  estimatedGross: number | null;
  salaryBasis: number | null;
  workedDays: number;
  reviewedDays: number;
  unresolvedDays: number;
  reviewStatus: "ready" | "unresolved" | "no_attendance";
  adjustmentNotes: string[];
  warnings: string[];
};

export type PayrollPreparationArithmetic = {
  ordinaryMinutes: number;
  overtimeMinutes: number;
  estimatedGross: number | null;
  salaryBasis: number | null;
};
