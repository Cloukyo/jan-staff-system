import { addDays, parseISO } from "date-fns";
import { isoDate } from "@/lib/dates/format";
import type { ProductionRotaDataset } from "@/lib/rota/types";
import type {
  RotaTemplate,
  RotaTemplateApplyMode,
  RotaTemplateShift,
  TemplateApplicationPreview,
  TemplatePreviewRow,
} from "@/lib/rota/template-types";

export function templateShiftDate(weekStart: string, dayOfWeek: number): string {
  return isoDate(addDays(parseISO(weekStart), dayOfWeek - 1));
}

export function buildTemplateApplicationPreview({
  template,
  templateShifts,
  rota,
  mode,
  expiredCertificateStaffIds = new Set<string>(),
}: {
  template: RotaTemplate;
  templateShifts: RotaTemplateShift[];
  rota: ProductionRotaDataset;
  mode: RotaTemplateApplyMode;
  expiredCertificateStaffIds?: Set<string>;
}): TemplateApplicationPreview {
  const staffById = new Map(rota.staff.map((person) => [person.id, person]));
  let approvedLeaveConflicts = 0;
  let pendingLeaveWarnings = 0;
  let inactiveStaff = 0;
  let overlappingShifts = 0;
  let duplicateShifts = 0;
  let missingStaffProfiles = 0;
  let expiredCertificateWarnings = 0;

  const rows = templateShifts.map((shift) => {
    const shiftDate = templateShiftDate(rota.weekStart, shift.dayOfWeek);
    const staff = staffById.get(shift.staffId);
    const existingOnDay = rota.shifts.filter((item) => item.shiftDate === shiftDate && item.status !== "cancelled");
    const duplicate = existingOnDay.some((item) =>
      item.staffId === shift.staffId && item.startTime === shift.startTime && item.endTime === shift.endTime
    );
    const overlap = existingOnDay.some((item) =>
      item.staffId === shift.staffId && shift.startTime < item.endTime && shift.endTime > item.startTime
    );
    const leave = rota.leave.filter((item) =>
      item.staffId === shift.staffId &&
      shiftDate >= item.startDate &&
      shiftDate <= item.endDate &&
      (item.dayPart === "full_day" || Boolean(item.startTime && item.endTime && shift.startTime < item.endTime && shift.endTime > item.startTime))
    );
    const warnings: string[] = [];
    if (!staff) {
      missingStaffProfiles += 1;
      warnings.push("Missing staff profile");
    } else if (!staff.active) {
      inactiveStaff += 1;
      warnings.push("Inactive staff");
    }
    const approved = leave.filter((item) => item.status === "approved").length;
    const pending = leave.filter((item) => item.status === "pending").length;
    approvedLeaveConflicts += approved;
    pendingLeaveWarnings += pending;
    if (approved) warnings.push("Approved leave conflict");
    if (pending) warnings.push("Pending leave warning");
    if (overlap && !duplicate && mode !== "replace") {
      overlappingShifts += 1;
      warnings.push("Overlaps an existing shift");
    }
    if (duplicate) {
      duplicateShifts += 1;
      warnings.push("Identical shift already exists");
    }
    if (expiredCertificateStaffIds.has(shift.staffId)) {
      expiredCertificateWarnings += 1;
      warnings.push("Expired certificate recorded");
    }
    const outcome: TemplatePreviewRow["outcome"] = duplicate && mode !== "replace"
      ? "skip_duplicate"
      : mode === "empty_days" && existingOnDay.length
        ? "skip_empty_day"
        : mode === "replace" && existingOnDay.length
          ? "replace"
          : "create";
    return {
      templateShiftId: shift.id,
      staffId: shift.staffId,
      staffName: staff?.displayName || staff?.fullName || "Missing staff profile",
      shiftDate,
      dayOfWeek: shift.dayOfWeek,
      startTime: shift.startTime,
      endTime: shift.endTime,
      outcome,
      warnings,
    };
  });

  const replaceDates = new Set(rows.filter((row) => row.outcome === "replace").map((row) => row.shiftDate));
  return {
    template,
    mode,
    rows,
    shiftsToCreate: rows.filter((row) => row.outcome === "create" || row.outcome === "replace").length,
    existingShiftsToArchive: mode === "replace"
      ? rota.shifts.filter((shift) => replaceDates.has(shift.shiftDate) && shift.status !== "cancelled").length
      : 0,
    approvedLeaveConflicts,
    pendingLeaveWarnings,
    inactiveStaff,
    overlappingShifts,
    duplicateShifts,
    missingStaffProfiles,
    expiredCertificateWarnings,
    canApply: missingStaffProfiles === 0 && inactiveStaff === 0,
  };
}
