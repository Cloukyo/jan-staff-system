import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveEffectiveEvents,
  type AttendanceCorrection,
  type OriginalClockEvent,
} from "@/lib/attendance/effective-events";
import { analyseAttendanceDay, planAlternatingEventTypes } from "@/lib/attendance/sequence";
import {
  buildAttendanceDayReturnTo,
  previewManualCorrectionChanges,
  previewPlannedHoursChanges,
} from "@/components/attendance/attendance-correction-controls";
import { planManualCorrectionConsequences } from "@/lib/attendance/manual-correction-plan";

const date = "2026-07-28";
const migrationPath = "supabase/migrations/202607280001_clock_event_corrections.sql";

function migrationSql() {
  return readFileSync(resolve(migrationPath), "utf8");
}

function sqlFunction(sql: string, name: string) {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\b[\\s\\S]*?\\n\\$\\$;`,
    "i",
  ));
  expect(match, `Expected SQL function public.${name}`).not.toBeNull();
  return match?.[0] ?? "";
}

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
    createdAt: `${date}T12:00:00+01:00`,
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

  it("uses the newest leaf when a correction chain forks", () => {
    const result = resolveEffectiveEvents([original("in", "clock_in", "08:00")], [
      correction("root", "replace", {
        originalEventId: "in",
        eventType: "clock_out",
        eventTimestamp: `${date}T08:00:00+01:00`,
        createdAt: `${date}T10:00:00+01:00`,
      }),
      correction("z-exclude-newer", "exclude", {
        supersedesCorrectionId: "root",
        createdAt: `${date}T12:00:00+01:00`,
      }),
      correction("a-replace-older", "replace", {
        eventType: "clock_in",
        eventTimestamp: `${date}T08:05:00+01:00`,
        supersedesCorrectionId: "root",
        createdAt: `${date}T11:00:00+01:00`,
      }),
    ]);

    expect(result.effective).toEqual([]);
    expect(result.audit.originals[0]).toMatchObject({
      status: "excluded",
      correctionId: "z-exclude-newer",
    });
    expect(result.audit.corrections).toEqual([
      expect.objectContaining({ correctionId: "root", status: "superseded" }),
      expect.objectContaining({ correctionId: "z-exclude-newer", status: "active" }),
      expect.objectContaining({ correctionId: "a-replace-older", status: "superseded" }),
    ]);
  });

  it("uses correction ID as the final tie-breaker for equally new fork leaves", () => {
    const result = resolveEffectiveEvents([original("in", "clock_in", "08:00")], [
      correction("root", "replace", {
        originalEventId: "in",
        eventType: "clock_out",
        eventTimestamp: `${date}T08:00:00+01:00`,
        createdAt: `${date}T10:00:00+01:00`,
      }),
      correction("z-replace", "replace", {
        eventType: "clock_in",
        eventTimestamp: `${date}T08:05:00+01:00`,
        supersedesCorrectionId: "root",
        createdAt: `${date}T12:00:00+01:00`,
      }),
      correction("a-exclude", "exclude", {
        supersedesCorrectionId: "root",
        createdAt: `${date}T12:00:00+01:00`,
      }),
    ]);

    expect(result.effective.map((event) => event.id)).toEqual(["z-replace"]);
    expect(result.audit.originals[0]).toMatchObject({
      status: "replaced",
      correctionId: "z-replace",
    });
    expect(result.audit.corrections.find((item) => item.correctionId === "a-exclude")?.status).toBe("superseded");
    expect(result.audit.corrections.find((item) => item.correctionId === "z-replace")?.status).toBe("active");
  });

  it("retains legacy manager events as effective audit-safe originals", () => {
    const result = resolveEffectiveEvents([
      original("legacy", "clock_in", "08:00", { source: "legacy_manager" }),
    ], []);

    expect(result.effective[0]).toMatchObject({ id: "legacy", source: "legacy_manager", correctionId: null });
    expect(result.audit.originals[0].status).toBe("active");
  });

  it("orders the BST clock-in before the later GMT clock-out by instant", () => {
    const events = resolveEffectiveEvents([
      original("gmt-out", "clock_out", "01:15", {
        recordedDate: "2026-10-25",
        eventTimestamp: "2026-10-25T01:15:00+00:00",
      }),
      original("bst-in", "clock_in", "01:30", {
        recordedDate: "2026-10-25",
        eventTimestamp: "2026-10-25T01:30:00+01:00",
      }),
    ], []).effective;

    expect(events.map((event) => event.id)).toEqual(["bst-in", "gmt-out"]);
    expect(analyseAttendanceDay({
      events,
      plannedShift: { start: "01:30", end: "01:15" },
    })).toMatchObject({
      completedMinutes: 45,
      hasOpenShift: false,
      warnings: [],
    });
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

    expect(result.completedMinutes).toBe(420);
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

  it("replaces the open start when a duplicate clock-in is followed by clock-out", () => {
    const result = analyseAttendanceDay({
      events: resolveEffectiveEvents([
        original("in-08", "clock_in", "08:00"),
        original("in-09", "clock_in", "09:00"),
        original("out-17", "clock_out", "17:00"),
      ], []).effective,
      plannedShift: { start: "08:00", end: "17:00" },
    });

    expect(result.completedMinutes).toBe(480);
    expect(result.warnings).toContain("duplicate_clock_in");
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

describe("attendance correction control contracts", () => {
  const effectiveEvents = [
    {
      id: "event-1",
      staffId: "staff-1",
      eventType: "clock_in" as const,
      eventTimestamp: "2026-07-28T07:00:00.000Z",
      recordedDate: date,
      source: "kiosk" as const,
      originalEventId: null,
      correctionId: null,
    },
    {
      id: "event-2",
      staffId: "staff-1",
      eventType: "clock_in" as const,
      eventTimestamp: "2026-07-28T11:00:00.000Z",
      recordedDate: date,
      source: "kiosk" as const,
      originalEventId: null,
      correctionId: null,
    },
  ];

  it("builds a return URL that keeps the staff week and open day", () => {
    expect(buildAttendanceDayReturnTo({
      staffId: "staff-1",
      from: "2026-07-27",
      to: "2026-08-02",
      day: date,
    })).toBe("/attendance?view=hours&hoursFrom=2026-07-27&hoursTo=2026-08-02&staffId=staff-1&day=2026-07-28");
  });

  it("previews the same-day event type changes for a fix without moving their timestamps", () => {
    expect(previewManualCorrectionChanges({
      events: effectiveEvents,
      selectedEventId: "event-1",
      selectedEventType: "clock_in",
    })).toEqual([
      {
        targetEventId: "event-2",
        eventType: "clock_out",
        eventTimestamp: "2026-07-28T11:00:00.000Z",
      },
    ]);
  });

  it("previews later same-day changes for an added event without moving timestamps", () => {
    expect(previewManualCorrectionChanges({
      events: effectiveEvents,
      selectedEventId: null,
      selectedEventType: "clock_in",
      localDateTime: "2026-07-28T08:00",
      staffId: "staff-1",
    })).toEqual([
      {
        targetEventId: "event-2",
        eventType: "clock_out",
        eventTimestamp: "2026-07-28T11:00:00.000Z",
      },
    ]);
  });

  it("leaves the added-event preview empty while its date and time are incomplete", () => {
    expect(previewManualCorrectionChanges({
      events: effectiveEvents,
      selectedEventId: null,
      selectedEventType: "clock_in",
      localDateTime: "",
      staffId: "staff-1",
    })).toEqual([]);
  });

  it("shares a projected, re-sorted crossing-event plan with the manual preview", () => {
    const crossingEvents = [
      { id: "selected", staffId: "staff-1", eventType: "clock_in" as const, eventTimestamp: "2026-07-28T07:00:00.000Z", recordedDate: date, source: "kiosk" as const, originalEventId: null, correctionId: null },
      { id: "out-09", staffId: "staff-1", eventType: "clock_out" as const, eventTimestamp: "2026-07-28T08:00:00.000Z", recordedDate: date, source: "kiosk" as const, originalEventId: null, correctionId: null },
      { id: "in-10", staffId: "staff-1", eventType: "clock_in" as const, eventTimestamp: "2026-07-28T09:00:00.000Z", recordedDate: date, source: "kiosk" as const, originalEventId: null, correctionId: null },
      { id: "out-12", staffId: "staff-1", eventType: "clock_out" as const, eventTimestamp: "2026-07-28T11:00:00.000Z", recordedDate: date, source: "kiosk" as const, originalEventId: null, correctionId: null },
    ];
    const input = {
      events: crossingEvents,
      selectedEventId: "selected",
      staffId: "staff-1",
      recordedDate: date,
      eventType: "clock_out" as const,
      eventTimestamp: "2026-07-28T10:30:00.000Z",
    };

    expect(planManualCorrectionConsequences(input)).toEqual([
      {
        targetEventId: "out-12",
        originalEventId: "out-12",
        supersedesCorrectionId: null,
        eventType: "clock_in",
        eventTimestamp: "2026-07-28T11:00:00.000Z",
        recordedDate: date,
      },
    ]);
    expect(previewManualCorrectionChanges({
      events: crossingEvents,
      selectedEventId: "selected",
      selectedEventType: "clock_out",
      localDateTime: "2026-07-28T11:30",
      staffId: "staff-1",
    })).toEqual([
      { targetEventId: "out-12", eventType: "clock_in", eventTimestamp: "2026-07-28T11:00:00.000Z" },
    ]);
  });

  it("previews planned start and finish changes while leaving lunchtime timestamps unchanged", () => {
    expect(previewPlannedHoursChanges({
      date,
      plannedPeriods: [
        { id: "morning", startTime: "08:00", endTime: "12:00", breakMinutes: 0 },
        { id: "afternoon", startTime: "13:00", endTime: "17:00", breakMinutes: 0 },
      ],
      effectiveEvents: [
        {
          id: "start", staffId: "staff-1", eventType: "clock_out", eventTimestamp: "2026-07-28T06:45:00.000Z", recordedDate: date, source: "kiosk", originalEventId: null, correctionId: null,
        },
        {
          id: "lunch-out", staffId: "staff-1", eventType: "clock_out", eventTimestamp: "2026-07-28T11:30:00.000Z", recordedDate: date, source: "kiosk", originalEventId: null, correctionId: null,
        },
        {
          id: "lunch-in", staffId: "staff-1", eventType: "clock_in", eventTimestamp: "2026-07-28T12:30:00.000Z", recordedDate: date, source: "kiosk", originalEventId: null, correctionId: null,
        },
        {
          id: "finish", staffId: "staff-1", eventType: "clock_in", eventTimestamp: "2026-07-28T17:15:00.000Z", recordedDate: date, source: "kiosk", originalEventId: null, correctionId: null,
        },
      ],
    })).toEqual({
      plannedStart: "08:00",
      plannedFinish: "17:00",
      changes: [
        { targetEventId: "start", originalEventType: "clock_out", eventType: "clock_in", originalEventTimestamp: "2026-07-28T06:45:00.000Z", eventTimestamp: "2026-07-28T07:00:00.000Z" },
        { targetEventId: "finish", originalEventType: "clock_in", eventType: "clock_out", originalEventTimestamp: "2026-07-28T17:15:00.000Z", eventTimestamp: "2026-07-28T16:00:00.000Z" },
      ],
      additions: [],
      canApply: true,
    });
  });

  it("uses the earliest start and independent latest finish for overlapping planned periods", () => {
    expect(previewPlannedHoursChanges({
      date,
      plannedPeriods: [
        { id: "late", startTime: "10:00", endTime: "16:00", breakMinutes: 0 },
        { id: "early", startTime: "08:00", endTime: "15:00", breakMinutes: 0 },
        { id: "long", startTime: "09:00", endTime: "17:00", breakMinutes: 0 },
      ],
      effectiveEvents: [],
    })).toEqual({
      plannedStart: "08:00",
      plannedFinish: "17:00",
      changes: [],
      additions: [
        { eventType: "clock_in", eventTimestamp: "2026-07-28T07:00:00.000Z" },
        { eventType: "clock_out", eventTimestamp: "2026-07-28T16:00:00.000Z" },
      ],
      canApply: true,
    });
  });
});

describe("append-only attendance correction migration", () => {
  it("creates an immutable correction table with manager insert and select policies", () => {
    const sql = migrationSql();

    expect(sql).toContain("create table public.clock_event_corrections");
    expect(sql).toContain("supersedes_correction_id");
    expect(sql).toContain("Managers can add clock event corrections");
    expect(sql).toContain("Managers can read clock event corrections");
    expect(sql).toMatch(/staff_id text not null references public\.staff_profiles\(id\)/i);
    expect(sql).toMatch(/original_event_id uuid references public\.clock_events\(id\)/i);
    expect(sql).toMatch(/supersedes_correction_id uuid references public\.clock_event_corrections\(id\)/i);
    expect(sql).toMatch(/created_by uuid not null references public\.staff_accounts\(id\)/i);
    expect(sql).toMatch(/length\(trim\(reason\)\) >= 5/i);
    expect(sql).toMatch(/correction_kind in \('add', 'replace', 'exclude'\)/i);
    expect(sql).not.toMatch(/update public\.clock_events|delete from public\.clock_events/i);
    expect(sql).not.toMatch(/clock_event_corrections for (update|delete)/i);
    expect(sql).toContain('drop policy if exists "Managers can add clock corrections"');
    expect(sql).toContain("revoke insert on public.clock_events from authenticated");
  });

  it("requires replacement and exclusion targets while keeping additions independent", () => {
    const sql = migrationSql();

    expect(sql).toMatch(/correction_kind = 'add'[\s\S]*original_event_id is null/i);
    expect(sql).toMatch(/correction_kind in \('replace', 'exclude'\)[\s\S]*original_event_id is not null[\s\S]*supersedes_correction_id is null/i);
    expect(sql).toMatch(/correction_kind in \('replace', 'exclude'\)[\s\S]*original_event_id is null[\s\S]*supersedes_correction_id is not null/i);
    expect(sql).toMatch(/correction_kind = 'exclude'[\s\S]*event_type is null[\s\S]*event_timestamp is null/i);
    expect(sql).toMatch(/correction_kind in \('add', 'replace'\)[\s\S]*event_type is not null[\s\S]*event_timestamp is not null/i);
  });

  it("resolves one deterministic active leaf per lineage and orders effective events deterministically", () => {
    const sql = migrationSql();
    const effectiveEvents = sqlFunction(sql, "get_effective_clock_events");

    expect(effectiveEvents).toMatch(/not exists[\s\S]*supersedes_correction_id\s*=\s*[a-z_.]*id/i);
    expect(effectiveEvents).toMatch(/partition by[\s\S]*original_event_id[\s\S]*root_correction_id/i);
    expect(effectiveEvents).toMatch(/order by[\s\S]*created_at desc[\s\S]*(?:correction_id|correction\.id) desc/i);
    expect(effectiveEvents).toMatch(/correction_kind not in \('replace', 'exclude'\)|correction_kind = 'add'/i);
    expect(effectiveEvents).toContain("'manager_correction'");
    expect(effectiveEvents).toMatch(/order by event_timestamp, event_id/i);
    expect(effectiveEvents).toMatch(/returns table \([\s\S]*original_event_id uuid[\s\S]*correction_id uuid[\s\S]*staff_id text[\s\S]*event_type text[\s\S]*event_timestamp timestamptz[\s\S]*recorded_date date[\s\S]*source text/i);
  });

  it("repairs only planned boundaries and preserves intermediate timestamps unless event types must alternate", () => {
    const sql = migrationSql();
    const plannedHours = sqlFunction(sql, "use_planned_hours");

    expect(sql).toContain("public.use_planned_hours");
    expect(plannedHours).toContain("security definer");
    expect(plannedHours).toMatch(/manager_account\.role <> 'manager'/i);
    expect(plannedHours).toMatch(/rw\.status = 'published'/i);
    expect(plannedHours).toMatch(/rs\.status <> 'cancelled'/i);
    expect(plannedHours).toMatch(/for update of rs/i);
    expect(plannedHours).toMatch(/min\(rs\.start_time\)/i);
    expect(plannedHours).toMatch(/max\(rs\.end_time\)/i);
    expect(plannedHours).toContain("at time zone 'Europe/London'");
    expect(plannedHours).toMatch(/effective_events jsonb[\s\S]*jsonb_agg/i);
    expect(plannedHours).toMatch(/jsonb_array_length\(effective_events\)/i);
    expect(plannedHours).toMatch(/event_timestamp <= planned_start_at/i);
    expect(plannedHours).toMatch(/event_timestamp > planned_start_at[\s\S]*event_timestamp < planned_finish_at/i);
    expect(plannedHours).toMatch(/event_timestamp >= planned_finish_at/i);
    expect(plannedHours).toMatch(/left_boundary_count \+ intermediate_count \+ right_boundary_count <> event_count/i);
    expect(plannedHours).toMatch(/left_boundary_count > 1 or right_boundary_count > 1/i);
    expect(plannedHours).toMatch(/intermediate_count % 2 = 1/i);
    expect(plannedHours).toMatch(/intermediate_position::integer % 2 = 1[\s\S]*clock_out[\s\S]*clock_in/i);
    expect(plannedHours).toMatch(/'event_timestamp', intermediate_event\.event_timestamp/i);
    expect(plannedHours).toMatch(/jsonb_array_length\(correction_actions\) = 0[\s\S]*return null/i);
    expect(plannedHours).toMatch(/case when action\.ordinal = 1 then 'primary'/i);
    expect(plannedHours).toMatch(/return batch_id|return correction_batch_id/i);
  });

  it("validates and saves one correction chain as a manager-owned batch", () => {
    const sql = migrationSql();
    const saveChain = sqlFunction(sql, "save_clock_event_correction_chain");

    expect(saveChain).toContain("security definer");
    expect(saveChain).toMatch(/manager_account\.role <> 'manager'/i);
    expect(saveChain).toMatch(/jsonb_array_elements/i);
    expect(saveChain).toMatch(/count\(distinct staff_id\)[\s\S]*count\(distinct recorded_date\)/i);
    expect(saveChain).toMatch(/insert into public\.clock_event_corrections/i);
    expect(saveChain).toMatch(/batch_id/i);
    expect(saveChain).toMatch(/primary[\s\S]*consequential/i);
    expect(saveChain).toContain("perform public.lock_attendance_staff_writes");
  });

  it("keeps original clock events immutable for manager correction actions", () => {
    const actions = readFileSync(
      resolve("src/lib/attendance/correction-actions.ts"),
      "utf8",
    );

    expect(actions).toContain("save_clock_event_correction_chain");
    expect(actions).toContain("use_planned_hours");
    expect(actions).not.toMatch(/clock_events[\s\S]{0,120}\.(update|delete)\b/i);
    expect(actions).toContain('revalidatePath("/attendance")');
    expect(actions).toContain('revalidatePath("/clock")');
    expect(actions).toContain('revalidatePath("/payroll")');
  });

  it("calculates staff and manager hours from effective events", () => {
    const sql = migrationSql();
    const staffHours = sqlFunction(sql, "get_staff_weekly_hours");
    const managerHours = sqlFunction(sql, "get_manager_hours_preview");

    expect(staffHours).toContain("public.get_effective_clock_events");
    expect(managerHours).toContain("public.get_effective_clock_events");
    expect(staffHours).not.toContain("from public.clock_events");
    expect(managerHours).not.toContain("from public.clock_events");
    expect(staffHours).toMatch(/order by ce\.event_timestamp, ce\.event_id/i);
    expect(managerHours).toMatch(/order by ce\.event_timestamp, ce\.event_id/i);
    expect(managerHours).toMatch(/from public\.staff_profiles profile/i);
    expect(managerHours).toMatch(/trim\(profile\.display_name\)/i);
  });
});
