export type RotaWeekStatus = "draft" | "published" | "archived";
export type RotaShiftStatus = "scheduled" | "cancelled" | "completed";

export type ProductionRotaWeek = {
  id: string;
  weekStartDate: string;
  status: RotaWeekStatus;
  title: string | null;
  notes: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
};

export type ProductionRotaStaff = {
  id: string;
  fullName: string;
  displayName: string;
  employmentRole: string;
  active: boolean;
};

export type ProductionRotaShift = {
  id: string;
  rotaWeekId: string;
  staffId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breakUnspecified: boolean;
  roomOrArea: string | null;
  roleOnShift: string | null;
  notes: string | null;
  status: RotaShiftStatus;
  inactiveStaffOverrideReason: string | null;
  leaveOverrideReason: string | null;
  overlapOverrideReason: string | null;
  archivedAt: string | null;
};

export type RotaLeaveWarning = {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  dayPart: "full_day" | "partial_day";
  startTime: string | null;
  endTime: string | null;
  status: "pending" | "approved";
};

export type ProductionRotaDataset = {
  weekStart: string;
  week: ProductionRotaWeek | null;
  shifts: ProductionRotaShift[];
  staff: ProductionRotaStaff[];
  leave: RotaLeaveWarning[];
  settings: {
    openingTime: string;
    closingTime: string;
    defaultBreakMinutes: number;
    shiftIntervalMinutes: number;
    availableRooms: string[];
    allowOverlapOverride: boolean;
    allowInactiveStaffOverride: boolean;
  };
};
