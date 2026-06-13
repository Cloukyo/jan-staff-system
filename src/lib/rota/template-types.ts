import type { ProductionRotaStaff } from "@/lib/rota/types";

export type RotaTemplateStatus = "active" | "archived";
export type RotaTemplateSourceType = "manual" | "saved_from_rota" | "private_import";
export type RotaTemplateApplyMode = "empty_days" | "replace" | "alongside";

export type RotaTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: RotaTemplateStatus;
  sourceType: RotaTemplateSourceType;
  createdAt: string;
  updatedAt: string;
};

export type RotaTemplateShift = {
  id: string;
  templateId: string;
  staffId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  roomOrArea: string | null;
  roleOnShift: string | null;
  notes: string | null;
  sortOrder: number;
  archivedAt: string | null;
};

export type RotaTemplateDataset = {
  templates: RotaTemplate[];
  selected: RotaTemplate | null;
  shifts: RotaTemplateShift[];
  staff: ProductionRotaStaff[];
};

export type TemplatePreviewRow = {
  templateShiftId: string;
  staffId: string;
  staffName: string;
  shiftDate: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  outcome: "create" | "skip_empty_day" | "skip_duplicate" | "replace";
  warnings: string[];
};

export type TemplateApplicationPreview = {
  template: RotaTemplate;
  mode: RotaTemplateApplyMode;
  rows: TemplatePreviewRow[];
  shiftsToCreate: number;
  existingShiftsToArchive: number;
  approvedLeaveConflicts: number;
  pendingLeaveWarnings: number;
  inactiveStaff: number;
  overlappingShifts: number;
  duplicateShifts: number;
  missingStaffProfiles: number;
  expiredCertificateWarnings: number;
  canApply: boolean;
};
