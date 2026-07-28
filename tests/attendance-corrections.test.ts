import { describe, expect, it } from "vitest";
import {
  resolveEffectiveEvents,
  type AttendanceCorrection,
  type OriginalClockEvent,
} from "@/lib/attendance/effective-events";
import { analyseAttendanceDay, planAlternatingEventTypes } from "@/lib/attendance/sequence";

const date = "2026-07-28";

function original(
  id: string,
  eventType: "clock_in" | "clock_out",
  time: string,
  overrides: Partial<OriginalClockEvent> = {},
): OriginalClockEvent {
  return {
    id,
    staffId: "staff-1",
    eventType,
    eventTimestamp: `${date}T${time}:00+01:00`,
    recordedDate: date,
    source: "kiosk",
    ...overrides,
  };
}

function correction(
  id: string,
  kind: AttendanceCorrection["kind"],
  overrides: Partial<AttendanceCorrection> = {},
): AttendanceCorrection {
  return {
    id,
    staffId: "staff-1",
    kind,
    originalEventId: null,
    eventType: null,
    eventTimestamp: null,
    recordedDate: date,
    supersedesCorrectionId: null,
    ...overrides,
  };
}

describe("resolveEffectiveEvents", () => {
  it("keeps unchanged original events and orders equal timestamps by ID", () => {
    const result = resolveEffectiveEvents([
      original("out", "clock_out", "16:00"),
      original("in-b", "clock_in", "08:00"),
      original("in-a", "clock_in", "08:00"),
    ], []);

    expect(result.effective.map((event) => event.id)).toEqual(["in-a", "in-b", "out"]);
    expect(result.effective.every((event) => event.correctionId === null)).toBe(true);
    expect(result.audit.originals.map((item) => item.status)).toEqual(["active", "active", "active"]);
  });

  it("replaces an original while retaining its audit record", () => {
    const result = resolveEffectiveEvents([original("original", "clock_out", "08:01")], [
      correction("fix", "replace", {
        originalEventId: "original",
        eventType: "clock_in",
        eventTimestamp: `${date}T08:01:00+01:00`,
      }),
    ]);

    expect(result.effective.map(({ eventType }) => eventType)).toEqual(["clock_in"]);
    expect(result.effective[0]).toMatchObject({
      id: "fix",
      source: "manager_correction",
      originalEventId: "original",
      correctionId: "fix",
    });
    expect(result.audit.originals[0].status).toBe("replaced");
  });

  it("adds an independent correction event", () => {
    const result = resolveEffectiveEvents([original("in", "clock_in", "08:00")], [
      correction("add-out", "add", {
        eventType: "clock_out",
        eventTimestamp: `${date}T16:00:00+01:00`,
      }),
    ]);

    expect(result.effective.map((event) => event.id)).toEqual(["in", "add-out"]);
    expect(result.effective[1]).toMatchObject({
      source: "manager_correction",
      originalEventId: null,
      correctionId: "add-out",
    });
  });

  it("excludes an original without deleting it", () => {
    const result = resolveEffectiveEvents([original("in", "clock_in", "08:00")], [
      correction("exclude-in", "exclude", { originalEventId: "in" }),
    ]);

    expect(result.effective).toEqual([]);
    expect(result.audit.originals[0]).toMatchObject({ status: "excluded", correctionId: "exclude-in" });
  });

  it("uses only active leaf corrections in a supersession chain", () => {
    const result = resolveEffectiveEvents([original("in", "clock_in", "08:00")], [
      correction("replace-first", "replace", {
        originalEventId: "in",
        eventType: "clock_out",
        eventTimestamp: `${date}T08:00:00+01:00`,
      }),
      correction("replace-final", "replace", {
        eventType: "clock_in",
        eventTimestamp: `${date}T08:05:00+01:00`,
        supersedesCorrectionId: "replace-first",
      }),
    ]);

    expect(result.effective).toHaveLength(1);
    expect(result.effective[0]).toMatchObject({ id: "replace-final", eventType: "clock_in" });
    expect(result.audit.originals[0]).toMatchObject({ status: "replaced", correctionId: "replace-final" });
    expect(result.audit.corrections).toEqual([
      expect.objectContaining({ correctionId: "replace-first", status: "superseded" }),
      expect.objectContaining({ correctionId: "replace-final", status: "active" }),
    ]);
  });

  it("retains legacy manager events as effective audit-safe originals", () => {
    const result = resolveEffectiveEvents([
      original("legacy", "clock_in", "08:00", { source: "legacy_manager" }),
    ], []);

    expect(result.effective[0]).toMatchObject({ id: "legacy", source: "legacy_manager", correctionId: null });
    expect(result.audit.originals[0].status).toBe("active");
  });
});

describe("analyseAttendanceDay", () => {
  it("returns completed sessions without inferring missing times", () => {
    const result = analyseAttendanceDay({
      events: resolveEffectiveEvents([
        original("in", "clock_in", "08:00"),
        original("out", "clock_out", "16:30"),
      ], []).effective,
      plannedShift: { start: "08:00", end: "16:30" },
    });

    expect(result.sessions).toEqual([
      expect.objectContaining({ clockIn: expect.objectContaining({ id: "in" }), clockOut: expect.objectContaining({ id: "out" }), minutes: 510 }),
    ]);
    expect(result).toMatchObject({ completedMinutes: 510, hasOpenShift: false, warnings: [], suggestedMissingType: "clock_in" });
  });

  it("identifies an open shift and the missing clock-out type", () => {
    const result = analyseAttendanceDay({
      events: resolveEffectiveEvents([original("in", "clock_in", "08:00")], []).effective,
      plannedShift: { start: "08:00", end: "16:00" },
    });

    expect(result).toMatchObject({
      completedMinutes: 0,
      hasOpenShift: true,
      warnings: ["missing_clock_out"],
      suggestedMissingType: "clock_out",
    });
  });

  it("identifies a missing clock-in for a planned shift with no events", () => {
    const result = analyseAttendanceDay({
      events: [],
      plannedShift: { start: "08:00", end: "16:00" },
    });

    expect(result).toMatchObject({
      completedMinutes: 0,
      hasOpenShift: false,
      warnings: ["missing_clock_in"],
      suggestedMissingType: "clock_in",
    });
  });

  it("detects out-before-in and duplicate ordering warnings", () => {
    const result = analyseAttendanceDay({
      events: resolveEffectiveEvents([
        original("out-first", "clock_out", "08:00"),
        original("in-first", "clock_in", "08:30"),
        original("in-duplicate", "clock_in", "09:00"),
        original("out", "clock_out", "16:00"),
        original("out-duplicate", "clock_out", "16:30"),
      ], []).effective,
      plannedShift: null,
    });

    expect(result.completedMinutes).toBe(450);
    expect(result.warnings).toEqual([
      "missing_clock_in",
      "clock_out_before_clock_in",
      "events_wrong_order",
      "duplicate_clock_in",
      "duplicate_clock_out",
      "no_planned_shift",
    ]);
    expect(result.suggestedMissingType).toBe("clock_in");
  });
});

describe("planAlternatingEventTypes", () => {
  it("plans only later same-day mismatches and preserves their timestamps", () => {
    const effective = resolveEffectiveEvents([
      original("selected", "clock_in", "08:00"),
      original("later-in", "clock_in", "09:00"),
      original("later-out", "clock_out", "16:00"),
      original("other-date", "clock_in", "08:00", {
        recordedDate: "2026-07-29",
        eventTimestamp: "2026-07-29T08:00:00+01:00",
      }),
    ], []).effective;

    expect(planAlternatingEventTypes({
      events: effective,
      selectedEventId: "selected",
      selectedEventType: "clock_in",
    })).toEqual([
      {
        targetEventId: "later-in",
        originalEventId: "later-in",
        supersedesCorrectionId: null,
        eventType: "clock_out",
        eventTimestamp: `${date}T09:00:00+01:00`,
        recordedDate: date,
      },
      {
        targetEventId: "later-out",
        originalEventId: "later-out",
        supersedesCorrectionId: null,
        eventType: "clock_in",
        eventTimestamp: `${date}T16:00:00+01:00`,
        recordedDate: date,
      },
    ]);
  });
});
