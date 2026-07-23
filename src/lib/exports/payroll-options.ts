export type PayrollExportHoursMode = "both" | "planned" | "clocked";

export function parsePayrollExportHoursMode(
  params: URLSearchParams,
): PayrollExportHoursMode {
  const value = params.get("hours");
  return value === "planned" || value === "clocked" || value === "both"
    ? value
    : "both";
}

export const payrollModeIncludesPlanned = (mode: PayrollExportHoursMode) =>
  mode !== "clocked";

export const payrollModeIncludesClocked = (mode: PayrollExportHoursMode) =>
  mode !== "planned";

export function payrollRowHasSelectedHours(
  mode: PayrollExportHoursMode,
  clockedMinutes: number,
  plannedMinutes: number,
) {
  return (
    (payrollModeIncludesClocked(mode) && clockedMinutes > 0) ||
    (payrollModeIncludesPlanned(mode) && plannedMinutes > 0)
  );
}
