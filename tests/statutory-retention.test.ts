import { describe, expect, it } from "vitest";
import {
  canDeleteRetainedRecord,
  statutoryRetentionUntil,
} from "@/lib/retention/statutory-records";

describe("annual leave and holiday-pay retention", () => {
  it("retains applicable records for six years from creation", () => {
    expect(statutoryRetentionUntil("2026-04-06T23:30:00.000Z"))
      .toBe("2032-04-06T23:30:00.000Z");
  });

  it("does not treat pre-commencement records as subject to the new statutory rule", () => {
    expect(statutoryRetentionUntil("2026-04-05T22:59:59.999Z")).toBeNull();
  });

  it("uses the Europe/London calendar-date boundary", () => {
    expect(statutoryRetentionUntil("2026-04-05T23:00:00.000Z"))
      .toBe("2032-04-05T23:00:00.000Z");
  });

  it("prevents deletion before retention expiry or while an active hold exists", () => {
    expect(canDeleteRetainedRecord({ retainedUntil: "2032-04-06T12:00:00.000Z", activeHold: false }, new Date("2032-04-06T11:59:59.000Z"))).toBe(false);
    expect(canDeleteRetainedRecord({ retainedUntil: "2032-04-06T12:00:00.000Z", activeHold: false }, new Date("2032-04-06T12:00:00.000Z"))).toBe(true);
    expect(canDeleteRetainedRecord({ retainedUntil: "2032-04-06T12:00:00.000Z", activeHold: true }, new Date("2033-01-01T00:00:00.000Z"))).toBe(false);
  });
});
