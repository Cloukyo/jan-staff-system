import type { ProductionRotaShift, ProductionRotaStaff } from "@/lib/rota/types";
import { shiftWarningSummary } from "@/lib/rota/grid";
import type { RotaLeaveWarning } from "@/lib/rota/types";

export type RotaAttentionItem = {
  label: string;
  tone: "danger" | "warning" | "information";
};

export function shiftAttentionItems(
  shift: ProductionRotaShift,
  shifts: ProductionRotaShift[],
  leave: RotaLeaveWarning[],
): RotaAttentionItem[] {
  const warnings = shiftWarningSummary(shift, shifts, leave);
  return [
    warnings.approvedLeave ? { label: "Conflicts with approved leave", tone: "danger" as const } : null,
    warnings.overlap ? { label: "Overlaps another shift", tone: "danger" as const } : null,
    warnings.pendingLeave ? { label: "Pending leave request", tone: "warning" as const } : null,
    shift.breakUnspecified ? { label: "Break duration needs review", tone: "information" as const } : null,
  ].filter((item): item is RotaAttentionItem => item !== null);
}

export function staffMayBeginWorkOn(staff: ProductionRotaStaff, date: string): boolean | null {
  const value = staff.operationalReadiness?.[date];
  return typeof value === "boolean" ? value : null;
}

export function rotaWeekScopeLabel(siteName: string, weekStart: string, weekEnd: string): string {
  return `${siteName}, ${weekStart} to ${weekEnd}`;
}
