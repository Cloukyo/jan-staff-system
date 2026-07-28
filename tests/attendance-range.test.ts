import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_RANGE_MAX_DAYS,
  validateAttendanceDateRange,
} from "@/lib/attendance/date-range";

describe("shared attendance date ranges", () => {
  it("accepts at most 366 inclusive calendar days", () => {
    expect(ATTENDANCE_RANGE_MAX_DAYS).toBe(366);
    expect(validateAttendanceDateRange("2026-01-01", "2027-01-01")).toEqual({
      ok: true,
      range: { from: "2026-01-01", to: "2027-01-01" },
    });
    expect(validateAttendanceDateRange("2026-01-01", "2027-01-02")).toEqual({
      ok: false,
      error: "Choose a valid date range of up to 366 days.",
    });
  });

  it("rejects reversed and impossible calendar dates", () => {
    expect(validateAttendanceDateRange("2026-07-02", "2026-07-01").ok).toBe(false);
    expect(validateAttendanceDateRange("2026-02-30", "2026-03-01").ok).toBe(false);
  });
});
