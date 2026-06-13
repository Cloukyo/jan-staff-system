export type WorkbookCellValue = string | number | Date | null | undefined;

export function isWorkbookStaffRow(value: WorkbookCellValue): boolean {
  const name = String(value ?? "").trim().toLowerCase();
  return Boolean(name && name !== "staff" && !name.includes("sign in/out"));
}

export function normaliseWorkbookTime(value: WorkbookCellValue): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  if (typeof value === "number") {
    const minutes = Math.round((value % 1) * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseWorkbookShiftPair(start: WorkbookCellValue, end: WorkbookCellValue, hasFormulaError = false) {
  if (hasFormulaError) return { shift: null, warning: "formula_error" as const };
  const startTime = normaliseWorkbookTime(start);
  const endTime = normaliseWorkbookTime(end);
  if (Boolean(startTime) !== Boolean(endTime)) return { shift: null, warning: "incomplete_shift" as const };
  if (!startTime || !endTime) return { shift: null, warning: null };
  return { shift: { startTime, endTime }, warning: null };
}

export function isIncompleteWorkbookWeek(populatedStaffByDay: number[]): boolean {
  return populatedStaffByDay.length >= 5 && populatedStaffByDay.slice(2).every((count) => count === 0);
}

export function importedRowIsReady(mappingStatus: "confirmed" | "suggested" | "ambiguous" | "unmatched"): boolean {
  return mappingStatus === "confirmed";
}
