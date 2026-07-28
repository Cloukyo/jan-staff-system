import { describe, expect, it } from "vitest";
import { londonLocalDateTimeToUtc } from "@/lib/dates/format";

describe("London local datetime conversion", () => {
  it("applies the BST offset without changing the intended London date", () => {
    const converted = londonLocalDateTimeToUtc("2026-07-28T23:30");

    expect(converted.recordedDate).toBe("2026-07-28");
    expect(converted.timestamp.toISOString()).toBe("2026-07-28T22:30:00.000Z");
  });

  it("applies the GMT offset without changing the intended London date", () => {
    const converted = londonLocalDateTimeToUtc("2026-01-28T23:30");

    expect(converted.recordedDate).toBe("2026-01-28");
    expect(converted.timestamp.toISOString()).toBe("2026-01-28T23:30:00.000Z");
  });

  it("rejects a local time skipped by the spring clock change", () => {
    expect(() => londonLocalDateTimeToUtc("2026-03-29T01:30"))
      .toThrow("Invalid local date and time.");
  });

  it("selects the later GMT occurrence during the autumn overlap", () => {
    const converted = londonLocalDateTimeToUtc("2026-10-25T01:30");

    expect(converted.recordedDate).toBe("2026-10-25");
    expect(converted.timestamp.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });
});
