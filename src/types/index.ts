export type PayType = "hourly" | "salaried";
export type EmploymentStatus = "employed" | "former" | "on_leave";
export type ShiftStatus = "working" | "off" | "holiday" | "sick" | "training";
export type ClockEventType = "clock_in" | "break_start" | "break_end" | "clock_out";
export type ClockEventSource = "kiosk" | "manager";
export type ReviewStatus = "needs_review" | "approved" | "draft";
export type PayStatus = "draft" | "reviewed" | "exported";
export type PayTreatment = "paid" | "unpaid" | "informational";
export type AppRole = "manager" | "staff";
export type LeaveType = "annual_leave" | "sickness" | "medical_appointment" | "unpaid_leave" | "training" | "other";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type LeaveDayPart = "full_day" | "partial_day";
export type CertificateStatus = "valid" | "expiring_90" | "expiring_60" | "expiring_30" | "expired" | "no_expiry" | "awaiting_evidence" | "expected";
export type ComplianceIndicator = "complete" | "attention" | "urgent" | "incomplete";
export type EvidenceStatus = "not_required" | "awaiting" | "received" | "verified";
export type ChecklistStatus = "complete" | "incomplete" | "not_applicable";

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

export interface StaffAccount {
  id: string;
  authUserId: string | null;
  staffId: string;
  fullName: string;
  email: string;
  role: AppRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffProfile {
  id: string;
  fullName: string;
  displayName: string;
  employmentRole: string;
  mainQualificationLevel: string | null;
  isApprentice: boolean;
  isCoverStaff: boolean;
  appointmentDate: string | null;
  active: boolean;
  authUserId: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffQualification {
  id: string;
  staffId: string;
  qualificationName: string;
  qualificationLevel: string | null;
  awardingOrganisation: string | null;
  awardDate: string | null;
  expectedCompletionDate: string | null;
  permanent: boolean;
  evidenceStatus: EvidenceStatus;
  evidenceReference: string | null;
  notes: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffCertificate {
  id: string;
  staffId: string;
  certificateType: string;
  customTitle: string | null;
  completionDate: string | null;
  expiryDate: string | null;
  validityMonths: number | null;
  permanent: boolean;
  evidenceStatus: EvidenceStatus;
  evidenceReference: string | null;
  notes: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffCentralRecord {
  id: string;
  staffId: string;
  appointmentInductionCompleted: boolean;
  appointmentInductionCheckedAt: string | null;
  contractForm: boolean;
  contractFormCheckedAt: string | null;
  idChecked: boolean;
  idCheckedAt: string | null;
  addressEvidenceChecked: boolean;
  addressEvidenceCheckedAt: string | null;
  additionalEmploymentTaxEvidenceChecked: boolean;
  additionalEmploymentTaxEvidenceCheckedAt: string | null;
  dbsRecorded: boolean;
  dbsUpdateService: boolean;
  dbsIssueDate: string | null;
  dbsLastCheckedAt: string | null;
  dbsNumberLast4: string | null;
  dbsNewCheckRequired: boolean;
  referencesComplete: boolean;
  referencesCheckedAt: string | null;
  starterForm: boolean;
  starterFormCheckedAt: string | null;
  suitabilityDeclaration: boolean;
  suitabilityDeclarationCheckedAt: string | null;
  medicalDeclaration: boolean;
  medicalDeclarationCheckedAt: string | null;
  employeeInformationForm: boolean;
  employeeInformationFormCheckedAt: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
  notes: string | null;
  itemStatuses?: Record<string, ChecklistStatus>;
  itemNotes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface StaffReferenceCheck {
  id: string;
  staffId: string;
  referenceType: "current_last_employer" | "previous_employer" | "alternative";
  referenceName: string | null;
  method: "written" | "telephone" | "email" | null;
  satisfactory: boolean | null;
  notes: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  staffId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  dayPart: LeaveDayPart;
  startTime: string | null;
  endTime: string | null;
  requestedMinutes: number;
  staffNote: string;
  status: LeaveStatus;
  managerNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  cancelledAt: string | null;
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
  staffAccounts: StaffAccount[];
  leaveRequests: LeaveRequest[];
  payRates: PayRateHistory[];
  rota: RotaShift[];
  clockEvents: ClockEvent[];
  attendanceAdjustments: AttendanceAdjustment[];
  attendanceApprovals: AttendanceApproval[];
  paySummaries: PayPeriodSummary[];
  settings: NurserySettings;
}
