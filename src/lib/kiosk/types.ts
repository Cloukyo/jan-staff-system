import type { OfflineCapability } from "@/lib/kiosk/offline/types";

export type KioskStatus = "clocked_in" | "clocked_out";

export type KioskRosterEntry = {
  staffId: string;
  displayName: string;
  fullName: string;
  employmentRole: string;
  currentStatus: KioskStatus;
  pinReady: boolean;
};

export type KioskActionResult = {
  ok: boolean;
  code: string;
  message: string;
  currentStatus?: KioskStatus;
  recordedAt?: string;
  offlineCapability?: OfflineCapability;
  weeklyHours?: {
    weekStartDate: string;
    weekEndDate: string;
    completedMinutes: number;
    openShiftInProgress: boolean;
  };
};
