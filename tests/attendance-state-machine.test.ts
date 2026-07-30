import { describe, expect, it } from "vitest";
import {
  attendanceOperationalDate,
  deriveAttendanceState,
} from "@/lib/attendance/state-machine";
import type {
  AttendanceExceptionSummary,
  EffectiveAttendanceEvent,
} from "@/lib/attendance/types";

let eventSequence = 0;

function event(
  eventType: EffectiveAttendanceEvent["eventType"],
  eventTimestamp: string,
  overrides: Partial<EffectiveAttendanceEvent> = {},
): EffectiveAttendanceEvent {
  eventSequence += 1;
  const id = `event-${eventSequence}`;

  return {
    eventId: id,
    eventOrderKey: `${eventTimestamp}:${id}`,
    originalEventId: id,
    correctionId: null,
    staffId: "staff-a",
    eventType,
    eventTimestamp,
    source: "kiosk",
    ...overrides,
  };
}

function exception(
  overrides: Partial<AttendanceExceptionSummary> = {},
): AttendanceExceptionSummary {
  return {
    id: "exception-1",
    staffId: "staff-a",
    operationalDate: "2026-07-29",
    type: "missing_clock_out",
    status: "open",
    ...overrides,
  };
}

describe("deriveAttendanceState", () => {
  it.each([
    {
      name: "empty ledger",
      events: [],
      now: "2026-07-30T09:00:00+01:00",
      state: "clocked_out",
      actions: ["clock_in"],
    },
    {
      name: "current open shift",
      events: [event("clock_in", "2026-07-30T08:58:00+01:00")],
      now: "2026-07-30T09:00:00+01:00",
      state: "clocked_in",
      actions: ["clock_out"],
    },
    {
      name: "previous day open shift",
      events: [event("clock_in", "2026-07-29T08:58:00+01:00")],
      now: "2026-07-30T09:00:00+01:00",
      state: "missing_clock_out",
      actions: ["start_new_shift"],
    },
  ] as const)("$name", ({ events, now, state, actions }) => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: now,
      events: [...events],
    });

    expect(result.state).toBe(state);
    expect(result.allowedActions).toEqual(actions);
  });

  it("blocks an ambiguous consecutive clock-in sequence", () => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [
        event("clock_in", "2026-07-30T08:00:00+01:00"),
        event("clock_in", "2026-07-30T09:00:00+01:00"),
      ],
    });

    expect(result.state).toBe("awaiting_manager_review");
    expect(result.allowedActions).toEqual([]);
    expect(result.warnings.map((warning) => warning.type)).toContain(
      "consecutive_clock_in",
    );
  });

  it("does not fabricate a clock-in for an unmatched clock-out", () => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [event("clock_out", "2026-07-30T09:00:00+01:00")],
    });

    expect(result.state).toBe("missing_clock_in");
    expect(result.allowedActions).toEqual([]);
    expect(result.currentEvent).toBeNull();
    expect(result.warnings.map((warning) => warning.type)).toContain(
      "unmatched_clock_out",
    );
  });

  it("requires manager review for multiple current-day anomalies", () => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [
        event("clock_out", "2026-07-30T07:30:00+01:00"),
        event("clock_in", "2026-07-30T08:00:00+01:00"),
        event("clock_in", "2026-07-30T09:00:00+01:00"),
      ],
    });

    expect(result.state).toBe("awaiting_manager_review");
    expect(result.allowedActions).toEqual([]);
  });

  it("keeps a valid current shift actionable when an older issue is open", () => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [event("clock_in", "2026-07-30T09:00:00+01:00")],
      unresolvedExceptions: [exception()],
    });

    expect(result.state).toBe("clocked_in");
    expect(result.allowedActions).toEqual(["clock_out"]);
    expect(result.unresolvedExceptions).toHaveLength(1);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        type: "missing_clock_out",
        operationalDate: "2026-07-29",
        exceptionId: "exception-1",
      }),
    );
  });

  it("ignores resolved exception history when deriving live state", () => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [],
      unresolvedExceptions: [exception({ status: "resolved" })],
    });

    expect(result.state).toBe("clocked_out");
    expect(result.unresolvedExceptions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("uses the replacement correction returned by the effective ledger", () => {
    const replacement = event("clock_in", "2026-07-30T09:15:00+01:00", {
      eventId: "correction-final",
      eventOrderKey: "2026-07-30T09:15:00+01:00:correction-final",
      originalEventId: "original-clock-in",
      correctionId: "correction-final",
      source: "manager_correction",
    });
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [replacement],
    });

    expect(result.currentEvent).toEqual(replacement);
    expect(result.state).toBe("clocked_in");
  });

  it("treats an excluded original as absent from effective output", () => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [],
    });

    expect(result.state).toBe("clocked_out");
    expect(result.currentEvent).toBeNull();
  });

  it("includes final correction lineage in its deterministic revision", () => {
    const base = event("clock_in", "2026-07-30T09:00:00+01:00", {
      eventId: "effective-event",
      originalEventId: "original-event",
      correctionId: "correction-final",
      source: "manager_correction",
    });
    const first = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [base],
    });
    const second = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T10:00:00+01:00",
      events: [{ ...base, correctionId: "correction-newer" }],
    });

    expect(first.revision).not.toBe(second.revision);
    expect(first.revision).toContain("correction-final");
  });

  it("keeps a long same-day shift open and adds a warning", () => {
    const result = deriveAttendanceState({
      staffId: "staff-a",
      evaluatedAt: "2026-07-30T21:00:00+01:00",
      events: [event("clock_in", "2026-07-30T08:00:00+01:00")],
    });

    expect(result.state).toBe("clocked_in");
    expect(result.allowedActions).toEqual(["clock_out"]);
    expect(result.warnings.map((warning) => warning.type)).toContain(
      "unusually_long_shift",
    );
  });
});

describe("attendanceOperationalDate", () => {
  it.each([
    ["2026-03-29T00:30:00Z", "2026-03-29"],
    ["2026-03-29T23:30:00Z", "2026-03-30"],
    ["2026-10-25T00:30:00Z", "2026-10-25"],
    ["2026-07-29T23:30:00Z", "2026-07-30"],
  ])("maps %s to the London operational date %s", (value, expected) => {
    expect(attendanceOperationalDate(value)).toBe(expected);
  });
});
