export const ATTENDANCE_RANGE_MAX_DAYS = 366;
export const ATTENDANCE_RANGE_VALIDATION_MESSAGE =
  "Choose a valid date range of up to 366 days.";

export type AttendanceDateRange = {
  from: string;
  to: string;
};

export type AttendanceDateRangeValidation =
  | { ok: true; range: AttendanceDateRange }
  | { ok: false; error: typeof ATTENDANCE_RANGE_VALIDATION_MESSAGE };

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return parsed;
}

export function validateAttendanceDateRange(
  from: string,
  to: string,
): AttendanceDateRangeValidation {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate || !toDate || toDate < fromDate) {
    return { ok: false, error: ATTENDANCE_RANGE_VALIDATION_MESSAGE };
  }
  const inclusiveDays =
    Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > ATTENDANCE_RANGE_MAX_DAYS) {
    return { ok: false, error: ATTENDANCE_RANGE_VALIDATION_MESSAGE };
  }
  return { ok: true, range: { from, to } };
}

export function requireAttendanceDateRange(from: string, to: string): AttendanceDateRange {
  const validation = validateAttendanceDateRange(from, to);
  if (!validation.ok) throw new Error(validation.error);
  return validation.range;
}
