import { describe, expect, it } from "vitest";
import { pairAttendanceByOperationalDay } from "@/lib/attendance/pairing";
import type { EffectiveAttendanceEvent } from "@/lib/attendance/types";

let eventSequence = 0;

function event(
  eventType: EffectiveAttendanceEvent["eventType"],
  eventTimestamp: string,
  staffId = "staff-a",
): EffectiveAttendanceEvent {
  eventSequence += 1;
  const eventId = `event-${eventSequence}`;

  return {
    eventId,
    eventOrderKey: `${eventTimestamp}:${eventId}`,
    originalEventId: eventId,
    correctionId: null,
    staffId,
    eventType,
    eventTimestamp,
    source: "kiosk",
  };
}

describe("pairAttendanceByOperationalDay", () => {
  it("returns one valid same-day pair", () => {
    const result = pairAttendanceByOperationalDay([
      event("clock_in", "2026-07-30T08:00:00+01:00"),
      event("clock_out", "2026-07-30T16:00:00+01:00"),
    ]);

    expect(result).toEqual([
      {
        staffId: "staff-a",
        operationalDate: "2026-07-30",
        completedMinutes: 480,
        pairs: [
          expect.objectContaining({
            minutes: 480,
          }),
        ],
        anomalies: [],
      },
    ]);
  });

  it("never pairs a clock-in and clock-out across operational dates", () => {
    const result = pairAttendanceByOperationalDay([
      event("clock_in", "2026-07-29T23:30:00+01:00"),
      event("clock_out", "2026-07-30T00:30:00+01:00"),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        operationalDate: "2026-07-29",
        completedMinutes: 0,
        pairs: [],
        anomalies: ["missing_clock_out"],
      }),
      expect.objectContaining({
        operationalDate: "2026-07-30",
        completedMinutes: 0,
        pairs: [],
        anomalies: ["unmatched_clock_out"],
      }),
    ]);
  });

  it("does not invent a pair for consecutive clock-ins", () => {
    const result = pairAttendanceByOperationalDay([
      event("clock_in", "2026-07-30T08:00:00+01:00"),
      event("clock_in", "2026-07-30T09:00:00+01:00"),
      event("clock_out", "2026-07-30T16:00:00+01:00"),
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        completedMinutes: 0,
        pairs: [],
      }),
    );
    expect(result[0].anomalies).toContain("consecutive_clock_in");
  });

  it("returns zero minutes for an unmatched clock-out", () => {
    const result = pairAttendanceByOperationalDay([
      event("clock_out", "2026-07-30T16:00:00+01:00"),
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        completedMinutes: 0,
        pairs: [],
        anomalies: ["unmatched_clock_out"],
      }),
    );
  });

  it("sums two independent valid pairs on the same day", () => {
    const result = pairAttendanceByOperationalDay([
      event("clock_in", "2026-07-30T08:00:00+01:00"),
      event("clock_out", "2026-07-30T12:00:00+01:00"),
      event("clock_in", "2026-07-30T13:00:00+01:00"),
      event("clock_out", "2026-07-30T17:00:00+01:00"),
    ]);

    expect(result[0].completedMinutes).toBe(480);
    expect(result[0].pairs).toHaveLength(2);
    expect(result[0].anomalies).toEqual([]);
  });

  it("keeps actual long-shift minutes and reports the anomaly", () => {
    const result = pairAttendanceByOperationalDay([
      event("clock_in", "2026-07-30T06:00:00+01:00"),
      event("clock_out", "2026-07-30T19:00:00+01:00"),
    ]);

    expect(result[0].completedMinutes).toBe(780);
    expect(result[0].anomalies).toEqual(["unusually_long_shift"]);
  });

  it("keeps staff members in independent partitions", () => {
    const result = pairAttendanceByOperationalDay([
      event("clock_in", "2026-07-30T08:00:00+01:00", "staff-a"),
      event("clock_in", "2026-07-30T09:00:00+01:00", "staff-b"),
      event("clock_out", "2026-07-30T10:00:00+01:00", "staff-b"),
      event("clock_out", "2026-07-30T12:00:00+01:00", "staff-a"),
    ]);

    expect(result).toEqual([
      expect.objectContaining({ staffId: "staff-a", completedMinutes: 240 }),
      expect.objectContaining({ staffId: "staff-b", completedMinutes: 60 }),
    ]);
  });
});
