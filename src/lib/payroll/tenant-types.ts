import type { AttendanceExceptionStatus } from "@/lib/attendance/types";
import type {
  PayArrangement,
  PayrollAttendanceReview,
  ProductionPayType,
} from "@/lib/payroll/types";

export type CommercialEffectiveClockEvent = {
  organisationId: string | null;
  siteId: string | null;
  eventId: string;
  eventOrderKey: string;
  originalEventId: string | null;
  correctionId: string | null;
  staffId: string;
  eventType: "clock_in" | "clock_out";
  eventTimestamp: string;
  recordedDate: string;
  source: "kiosk" | "legacy_manager" | "manager_correction";
};

export type CommercialPayArrangement = PayArrangement & {
  organisationId: string | null;
};

export type CommercialPayrollStaff = {
  organisationId: string | null;
  id: string;
  fullName: string;
  employmentRole: string;
  currentSiteId: string | null;
};

export type CommercialStaffSiteAssignment = {
  organisationId: string;
  staffId: string;
  siteId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isPrimary: boolean;
};

export type CommercialAttendanceReview = {
  organisationId: string | null;
  staffId: string;
  operationalDate: string;
  status: PayrollAttendanceReview["status"];
};

export type CommercialAttendanceException = {
  organisationId: string | null;
  siteId: string | null;
  id: string;
  staffId: string;
  operationalDate: string;
  status: AttendanceExceptionStatus;
};

export type CommercialAttendanceRequest = {
  organisationId: string | null;
  siteId: string | null;
  id: string;
  staffId: string;
  operationalDate: string;
  status: "pending" | "applied" | "rejected" | "cancelled";
};

export type PayrollReadinessSeverity = "blocker" | "warning" | "informational";

export type PayrollReadinessCode =
  | "missing_clock_in"
  | "missing_clock_out"
  | "malformed_sequence"
  | "unresolved_exception"
  | "unreviewed_day"
  | "pending_request"
  | "long_shift"
  | "site_attribution"
  | "stale_input"
  | "manager_correction"
  | "missing_pay_arrangement";

export type PayrollReadinessIssue = {
  code: PayrollReadinessCode;
  severity: PayrollReadinessSeverity;
  organisationId: string;
  staffId: string | null;
  siteId: string | null;
  operationalDate: string | null;
  sourceId: string | null;
};

export type CommercialPayrollReadiness = {
  issues: PayrollReadinessIssue[];
  counts: Record<PayrollReadinessSeverity, number>;
};

export type CommercialPayrollSnapshotInput = {
  organisationId: string;
  periodStart: string;
  periodEnd: string;
  staff: CommercialPayrollStaff[];
  effectiveEvents: CommercialEffectiveClockEvent[];
  payArrangements: CommercialPayArrangement[];
  attendanceReviews?: CommercialAttendanceReview[];
  unresolvedExceptions?: CommercialAttendanceException[];
  pendingRequests?: CommercialAttendanceRequest[];
  assignments?: CommercialStaffSiteAssignment[];
  selectedSiteId?: string | null;
  staleInput?: boolean;
};

export type CommercialAdjustmentTarget =
  | {
    kind: "attendance";
    staffId: string;
    siteId: string;
    operationalDate: string;
  }
  | {
    kind: "organisation_summary";
    staffId: string;
    siteId: null;
    operationalDate: null;
  }
  | {
    kind: "site_summary";
    staffId: string;
    siteId: string;
    operationalDate: null;
  };

export type CommercialPayrollPreparationRow = {
  organisationId: string;
  staffId: string;
  sourceKind: "attendance" | "staff_summary" | "adjustment_summary";
  siteId: string | null;
  payArrangementId: string | null;
  operationalDate: string;
  sourceKey: string;
  payType: ProductionPayType | null;
  rawMinutes: number;
  adjustmentMinutes: number;
  payableMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  hourlyRate: number | null;
  annualSalary: number | null;
  monthlySalary: number | null;
  overtimeMultiplier: number | null;
  estimatedGrossValue: number | null;
  salaryBasis: number | null;
  currencyCode: "GBP";
  warnings: PayrollReadinessCode[];
};

export type CommercialPayrollStaffSummary = {
  staffId: string;
  fullName: string;
  employmentRole: string;
  currentSiteId: string | null;
  payType: ProductionPayType | null;
  payableMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  estimatedGrossValue: number | null;
  salaryBasis: number | null;
};

export type CommercialPayrollSnapshot = {
  organisationId: string;
  periodStart: string;
  periodEnd: string;
  inputFingerprint: string;
  attendanceFingerprint: string;
  payArrangementFingerprint: string;
  rows: CommercialPayrollPreparationRow[];
  staff: CommercialPayrollStaffSummary[];
  readiness: CommercialPayrollReadiness;
};
