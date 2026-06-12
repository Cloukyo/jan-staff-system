export type DashboardRotaStatus = "draft" | "published";

export type ProductionDashboardSummary = {
  referenceDate: string;
  weekStartDate: string;
  activeStaff: number;
  currentlyClockedIn: number;
  todayScheduledShifts: number;
  todayAttendanceExceptions: number;
  missingClockOuts: number;
  pendingLeaveRequests: number;
  approvedLeaveRotaConflicts: number;
  expiredCertificates: number;
  certificatesExpiring30Days: number;
  incompleteCentralRecords: number;
  staffMissingKioskPin: number;
  staffMissingPayArrangement: number;
  currentRota: {
    id: string;
    status: DashboardRotaStatus;
    weekStartDate: string;
    publishedAt: string | null;
  } | null;
  clockedInStaff: Array<{
    staffId: string;
    displayName: string;
    clockedInAt: string;
    scheduledEnd: string | null;
  }>;
  attendanceWarnings: Array<{
    staffId: string;
    displayName: string;
    warning: string;
    warningDate: string;
  }>;
  upcomingShifts: Array<{
    id: string;
    shiftDate: string;
    displayName: string;
    startTime: string;
    endTime: string;
    roomOrArea: string | null;
    roleOnShift: string | null;
    rotaStatus: DashboardRotaStatus;
  }>;
};
