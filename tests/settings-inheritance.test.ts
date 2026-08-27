import { describe, expect, it } from "vitest";
import { resolveOperationalSettings } from "@/lib/customer-domain/settings";

describe("organisation and site settings inheritance", () => {
  it("inherits organisation defaults and applies explicit site overrides", () => {
    expect(resolveOperationalSettings(
      {
        timezone: "Europe/London",
        workWeekStarts: 1,
        operatingHours: { openingTime: "07:30", closingTime: "18:30" },
        staffing: { defaultBreakMinutes: 30, minimumStaff: 2 },
      },
      {
        operatingHours: { closingTime: "20:00" },
        staffing: { minimumStaff: 3 },
      },
    )).toEqual({
      timezone: "Europe/London",
      workWeekStarts: 1,
      operatingHours: { openingTime: "07:30", closingTime: "20:00" },
      staffing: { defaultBreakMinutes: 30, minimumStaff: 3 },
    });
  });

  it("does not treat null or missing overrides as destructive values", () => {
    expect(resolveOperationalSettings(
      {
        timezone: "Europe/London",
        workWeekStarts: 1,
        operatingHours: { openingTime: "08:00", closingTime: "18:00" },
        staffing: { defaultBreakMinutes: 20, minimumStaff: 1 },
      },
      { timezone: null, operatingHours: { openingTime: null } },
    ).operatingHours).toEqual({ openingTime: "08:00", closingTime: "18:00" });
  });
});
