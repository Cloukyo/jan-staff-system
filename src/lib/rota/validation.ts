import { differenceInMinutes, parseISO } from "date-fns";
import type { ProductionRotaShift, RotaLeaveWarning } from "@/lib/rota/types";

export function shiftDurationMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime || endTime <= startTime) return 0;
  return differenceInMinutes(parseISO(`2000-01-01T${endTime}:00`), parseISO(`2000-01-01T${startTime}:00`));
}

export function leaveWarningsForShift(shift: Pick<ProductionRotaShift, "staffId" | "shiftDate" | "startTime" | "endTime">, leave: RotaLeaveWarning[]) {
  return leave.filter((item) => {
    if (item.staffId !== shift.staffId || shift.shiftDate < item.startDate || shift.shiftDate > item.endDate) return false;
    if (item.dayPart === "full_day") return true;
    return Boolean(item.startTime && item.endTime && shift.startTime < item.endTime && shift.endTime > item.startTime);
  });
}

export function overlapWarningsForShift(shift: Pick<ProductionRotaShift, "id" | "staffId" | "shiftDate" | "startTime" | "endTime">, shifts: ProductionRotaShift[]) {
  return shifts.filter((item) =>
    item.id !== shift.id &&
    item.staffId === shift.staffId &&
    item.shiftDate === shift.shiftDate &&
    item.status !== "cancelled" &&
    shift.startTime < item.endTime &&
    shift.endTime > item.startTime
  );
}
