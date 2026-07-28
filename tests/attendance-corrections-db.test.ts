// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  MANAGER_ACCOUNT_ID,
  STAFF_ACCOUNT_ID,
  createAttendanceTestDatabase,
  effectiveEvents,
  resetRole,
  seedClockEvent,
  seedStaffShift,
  setAuthenticatedRole,
  setCurrentAccount,
  usePlannedHours,
} from "./helpers/attendance-corrections-db";

const migration = readFileSync(
  resolve("supabase/migrations/202607280001_clock_event_corrections.sql"),
  "utf8",
);

describe("attendance correction PostgreSQL migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createAttendanceTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("repairs a day with no events using only planned boundaries", async () => {
    await seedStaffShift(db, { staffId: "zero-events", date: "2026-08-03" });

    const batchId = await usePlannedHours(db, "zero-events", "2026-08-03");

    expect(batchId).not.toBeNull();
    expect(await effectiveEvents(db, "zero-events", "2026-08-03")).toMatchObject([
      { event_type: "clock_in", local_time: "09:00" },
      { event_type: "clock_out", local_time: "17:00" },
    ]);
  });

  it("uses one eligible outside event as a boundary without inventing lunch", async () => {
    await seedStaffShift(db, { staffId: "one-outside", date: "2026-08-04" });
    await seedClockEvent(db, {
      staffId: "one-outside",
      timestamp: "2026-08-04T08:00:00+01:00",
      eventType: "clock_out",
    });

    await usePlannedHours(db, "one-outside", "2026-08-04");

    expect(await effectiveEvents(db, "one-outside", "2026-08-04")).toMatchObject([
      { event_type: "clock_in", local_time: "09:00" },
      { event_type: "clock_out", local_time: "17:00" },
    ]);
  });

  it("rejects one true intermediate event as an ambiguous odd sequence", async () => {
    await seedStaffShift(db, { staffId: "one-intermediate", date: "2026-08-05" });
    await seedClockEvent(db, {
      staffId: "one-intermediate",
      timestamp: "2026-08-05T12:00:00+01:00",
      eventType: "clock_out",
    });

    await expect(
      usePlannedHours(db, "one-intermediate", "2026-08-05"),
    ).rejects.toThrow(/manual correction/i);
  });

  it("constructs final order before correcting an even intermediate sequence", async () => {
    await seedStaffShift(db, { staffId: "even-reorder", date: "2026-08-06" });
    await seedClockEvent(db, {
      staffId: "even-reorder",
      timestamp: "2026-08-06T10:00:00+01:00",
      eventType: "clock_in",
    });
    await seedClockEvent(db, {
      staffId: "even-reorder",
      timestamp: "2026-08-06T12:00:00+01:00",
      eventType: "clock_out",
    });
    await seedClockEvent(db, {
      staffId: "even-reorder",
      timestamp: "2026-08-06T18:00:00+01:00",
      eventType: "clock_in",
    });

    await usePlannedHours(db, "even-reorder", "2026-08-06");

    expect(await effectiveEvents(db, "even-reorder", "2026-08-06")).toMatchObject([
      { event_type: "clock_in", local_time: "09:00" },
      { event_type: "clock_out", local_time: "10:00" },
      { event_type: "clock_in", local_time: "12:00" },
      { event_type: "clock_out", local_time: "17:00" },
    ]);
  });

  it("preserves even intermediate timestamps between replaced outside boundaries", async () => {
    await seedStaffShift(db, { staffId: "even-outside", date: "2026-08-07" });
    for (const [time, eventType] of [
      ["08:00", "clock_out"],
      ["12:00", "clock_in"],
      ["13:00", "clock_out"],
      ["18:00", "clock_in"],
    ] as const) {
      await seedClockEvent(db, {
        staffId: "even-outside",
        timestamp: `2026-08-07T${time}:00+01:00`,
        eventType,
      });
    }

    await usePlannedHours(db, "even-outside", "2026-08-07");

    expect(await effectiveEvents(db, "even-outside", "2026-08-07")).toMatchObject([
      { event_type: "clock_in", local_time: "09:00" },
      { event_type: "clock_out", local_time: "12:00" },
      { event_type: "clock_in", local_time: "13:00" },
      { event_type: "clock_out", local_time: "17:00" },
    ]);
  });

  it("rejects 08:00, 12:00, 18:00 against 09:00 to 17:00", async () => {
    await seedStaffShift(db, { staffId: "odd-outside", date: "2026-08-08" });
    for (const [time, eventType] of [
      ["08:00", "clock_in"],
      ["12:00", "clock_out"],
      ["18:00", "clock_in"],
    ] as const) {
      await seedClockEvent(db, {
        staffId: "odd-outside",
        timestamp: `2026-08-08T${time}:00+01:00`,
        eventType,
      });
    }

    await expect(
      usePlannedHours(db, "odd-outside", "2026-08-08"),
    ).rejects.toThrow(/manual correction/i);

    const correctionCount = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where staff_id = 'odd-outside'`,
    );
    expect(correctionCount.rows[0].count).toBe(0);
  });

  it("rejects multiple events outside either planned boundary", async () => {
    await seedStaffShift(db, { staffId: "ambiguous-outside", date: "2026-08-09" });
    for (const time of ["07:00", "08:00"]) {
      await seedClockEvent(db, {
        staffId: "ambiguous-outside",
        timestamp: `2026-08-09T${time}:00+01:00`,
        eventType: "clock_in",
      });
    }

    await expect(
      usePlannedHours(db, "ambiguous-outside", "2026-08-09"),
    ).rejects.toThrow(/manual correction/i);
  });

  it("returns null for no changes and gives every returned batch a primary row", async () => {
    await seedStaffShift(db, { staffId: "no-op", date: "2026-08-10" });
    for (const [time, eventType] of [
      ["09:00", "clock_in"],
      ["12:00", "clock_out"],
      ["13:00", "clock_in"],
      ["17:00", "clock_out"],
    ] as const) {
      await seedClockEvent(db, {
        staffId: "no-op",
        timestamp: `2026-08-10T${time}:00+01:00`,
        eventType,
      });
    }

    expect(await usePlannedHours(db, "no-op", "2026-08-10")).toBeNull();

    const invalidBatchCount = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from (
         select batch_id
         from public.clock_event_corrections
         group by batch_id
         having count(*) filter (where correction_role = 'primary') = 0
       ) invalid`,
    );
    expect(invalidBatchCount.rows[0].count).toBe(0);
  });

  it("rejects a persisted batch without a primary correction", async () => {
    await expect(
      db.query(
        `insert into public.clock_event_corrections (
           batch_id, correction_role, staff_id, correction_kind,
           event_type, event_timestamp, recorded_date, reason, created_by
         )
         values (
           gen_random_uuid(), 'consequential', 'staff-profile', 'add',
           'clock_out', '2026-08-14T17:00:00+01:00', '2026-08-14',
           'Missing primary', $1::uuid
         )`,
        [MANAGER_ACCOUNT_ID],
      ),
    ).rejects.toThrow(/primary correction/i);
  });

  it("uses Europe/London offsets on both sides of daylight-saving time", async () => {
    await seedStaffShift(db, { staffId: "spring-dst", date: "2026-03-29" });
    await seedStaffShift(db, { staffId: "autumn-dst", date: "2026-10-25" });

    await usePlannedHours(db, "spring-dst", "2026-03-29");
    await usePlannedHours(db, "autumn-dst", "2026-10-25");

    const spring = await effectiveEvents(db, "spring-dst", "2026-03-29");
    const autumn = await effectiveEvents(db, "autumn-dst", "2026-10-25");
    expect(spring.map((event) => event.local_time)).toEqual(["09:00", "17:00"]);
    expect(autumn.map((event) => event.local_time)).toEqual(["09:00", "17:00"]);
    expect(spring[0].event_timestamp).toContain("08:00:00+00");
    expect(autumn[0].event_timestamp).toContain("09:00:00+00");
  });

  it("removes manager base inserts while retaining history and kiosk RPC inserts", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await setAuthenticatedRole(db);

    await expect(
      db.query(
        `insert into public.clock_events (
           staff_id, event_type, event_timestamp, event_source,
           manager_correction, corrected_by, correction_reason
         )
         values (
           'staff-profile', 'clock_out', '2026-08-11T17:00:00+01:00',
           'manager', true, $1::uuid, 'Legacy manager path'
         )`,
        [MANAGER_ACCOUNT_ID],
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.query(
        `select public.test_kiosk_clock_event(
           'staff-profile',
           'clock_out',
           '2026-08-11T17:00:00+01:00'
         )`,
      ),
    ).resolves.toBeDefined();

    await resetRole(db);
    const effective = await effectiveEvents(db, "staff-profile", "2026-08-11");
    expect(effective.map((event) => event.source)).toEqual(["legacy_manager", "kiosk"]);
  });

  it("enforces correction RLS for manager and staff accounts", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await setAuthenticatedRole(db);
    await expect(
      db.query(
        `insert into public.clock_event_corrections (
           batch_id, correction_role, staff_id, correction_kind,
           event_type, event_timestamp, recorded_date, reason, created_by
         )
         values (
           gen_random_uuid(), 'primary', 'staff-profile', 'add',
           'clock_in', '2026-08-12T09:00:00+01:00', '2026-08-12',
           'Manager correction', $1::uuid
         )`,
        [MANAGER_ACCOUNT_ID],
      ),
    ).resolves.toBeDefined();

    await resetRole(db);
    await setCurrentAccount(db, STAFF_ACCOUNT_ID);
    await setAuthenticatedRole(db);
    const hidden = await db.query(
      `select * from public.clock_event_corrections where recorded_date = '2026-08-12'`,
    );
    expect(hidden.rows).toEqual([]);
    await expect(
      db.query(
        `insert into public.clock_event_corrections (
           batch_id, correction_role, staff_id, correction_kind,
           event_type, event_timestamp, recorded_date, reason, created_by
         )
         values (
           gen_random_uuid(), 'primary', 'staff-profile', 'add',
           'clock_out', '2026-08-12T17:00:00+01:00', '2026-08-12',
           'Staff correction', $1::uuid
         )`,
        [STAFF_ACCOUNT_ID],
      ),
    ).rejects.toThrow(/row-level security|policy/i);
    await resetRole(db);
  });

  it("saves one correction chain batch and resolves its active leaf", async () => {
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const originalId = await seedClockEvent(db, {
      staffId: "staff-profile",
      timestamp: "2026-08-13T08:00:00+01:00",
      eventType: "clock_out",
    });
    const plan = {
      reason: "Correct event chain",
      primary: {
        staff_id: "staff-profile",
        recorded_date: "2026-08-13",
        correction_kind: "replace",
        original_event_id: originalId,
        supersedes_correction_id: null,
        event_type: "clock_in",
        event_timestamp: "2026-08-13T09:00:00+01:00",
      },
      consequential: [{
        staff_id: "staff-profile",
        recorded_date: "2026-08-13",
        correction_kind: "add",
        original_event_id: null,
        supersedes_correction_id: null,
        event_type: "clock_out",
        event_timestamp: "2026-08-13T17:00:00+01:00",
      }],
    };

    const result = await db.query<{ batch_id: string }>(
      `select public.save_clock_event_correction_chain($1::jsonb)::text as batch_id`,
      [JSON.stringify(plan)],
    );
    const roles = await db.query<{ correction_role: string }>(
      `select correction_role
       from public.clock_event_corrections
       where batch_id = $1::uuid
       order by correction_role desc`,
      [result.rows[0].batch_id],
    );
    expect(roles.rows.map((row) => row.correction_role)).toEqual([
      "primary",
      "consequential",
    ]);
    const primary = await db.query<{ id: string }>(
      `select id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid
         and correction_role = 'primary'`,
      [result.rows[0].batch_id],
    );
    const supersedingPlan = {
      reason: "Refine event chain",
      primary: {
        staff_id: "staff-profile",
        recorded_date: "2026-08-13",
        correction_kind: "replace",
        original_event_id: null,
        supersedes_correction_id: primary.rows[0].id,
        event_type: "clock_in",
        event_timestamp: "2026-08-13T09:15:00+01:00",
      },
      consequential: [],
    };
    await db.query(
      `select public.save_clock_event_correction_chain($1::jsonb)`,
      [JSON.stringify(supersedingPlan)],
    );
    expect(await effectiveEvents(db, "staff-profile", "2026-08-13")).toMatchObject([
      { event_type: "clock_in", local_time: "09:15" },
      { event_type: "clock_out", local_time: "17:00" },
    ]);
  });

  it.each([
    { kind: "replace" as const, staffId: "kiosk-replaced" },
    { kind: "exclude" as const, staffId: "kiosk-excluded" },
  ])("uses an effective $kind of the latest event for anonymous kiosk status and next action", async ({
    kind,
    staffId,
  }) => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await db.query(
      `insert into public.staff_profiles (id, full_name)
       values ($1, $2)`,
      [staffId, staffId],
    );
    await db.query(
      `insert into public.staff_kiosk_settings (
         staff_id, kiosk_enabled, pin_hash, pin_reset_required
       )
       values ($1, true, '4827', false)`,
      [staffId],
    );
    await seedClockEvent(db, {
      staffId,
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      eventType: "clock_out",
    });
    const latestId = await seedClockEvent(db, {
      staffId,
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      eventType: "clock_in",
    });
    const latest = await db.query<{ recorded_date: string; event_timestamp: string }>(
      `select recorded_date::text, event_timestamp::text
       from public.clock_events
       where id = $1::uuid`,
      [latestId],
    );
    await db.query(
      `insert into public.clock_event_corrections (
         batch_id, correction_role, staff_id, correction_kind,
         original_event_id, event_type, event_timestamp, recorded_date,
         reason, created_by
       )
       values (
         gen_random_uuid(), 'primary', $1, $2, $3::uuid,
         case when $2 = 'replace' then 'clock_out' else null end,
         case when $2 = 'replace' then $4::timestamptz else null end,
         $5::date, 'Correct latest kiosk state', $6::uuid
       )`,
      [
        staffId,
        kind,
        latestId,
        latest.rows[0].event_timestamp,
        latest.rows[0].recorded_date,
        MANAGER_ACCOUNT_ID,
      ],
    );

    await setAuthenticatedRole(db);
    await db.exec("set role anon");
    await expect(db.query("select * from public.get_kiosk_roster()"))
      .rejects.toThrow(/permission denied/i);
    const roster = await db.query<{ current_status: string }>(
      `select current_status
       from public.get_device_kiosk_roster('device-token')
       where staff_id = $1`,
      [staffId],
    );
    const verification = await db.query<{ current_status: string }>(
      `select current_status
       from public.verify_device_kiosk_pin('device-token', $1, '4827')`,
      [staffId],
    );
    const clockIn = await db.query<{ ok: boolean; code: string; current_status: string }>(
      `select ok, code, current_status
       from public.record_device_kiosk_clock_event(
         'device-token', $1, '4827', 'clock_in'
       )`,
      [staffId],
    );

    expect(roster.rows[0].current_status).toBe("clocked_out");
    expect(verification.rows[0].current_status).toBe("clocked_out");
    expect(clockIn.rows[0]).toMatchObject({
      ok: true,
      code: "recorded",
      current_status: "clocked_in",
    });
    await resetRole(db);
  });

  it("bounds latest effective status to the requested 366-day lookback", async () => {
    await resetRole(db);
    await db.query(
      `insert into public.staff_profiles (id, full_name)
       values ('old-kiosk-event', 'Old kiosk event')`,
    );
    await db.query(
      `insert into public.clock_events (staff_id, event_type, event_timestamp)
       values ('old-kiosk-event', 'clock_in', '2025-01-01T09:00:00Z')`,
    );

    const latest = await db.query(
      `select *
       from public.get_latest_effective_clock_event(
         'old-kiosk-event',
         '2026-07-28'::date,
         366
       )`,
    );
    expect(latest.rows).toEqual([]);
  });

  it("pairs SQL totals from the latest duplicate clock-in", async () => {
    await resetRole(db);
    await db.query(
      `insert into public.staff_profiles (id, full_name)
       values ('sql-duplicate-in', 'SQL duplicate in')`,
    );
    for (const [time, eventType] of [
      ["08:00", "clock_in"],
      ["09:00", "clock_in"],
      ["17:00", "clock_out"],
    ] as const) {
      await seedClockEvent(db, {
        staffId: "sql-duplicate-in",
        timestamp: `2026-08-14T${time}:00+01:00`,
        eventType,
      });
    }

    const result = await db.query<{ completed_minutes: number }>(
      `select completed_minutes
       from public.get_staff_weekly_hours('sql-duplicate-in', '2026-08-14')`,
    );
    expect(result.rows[0].completed_minutes).toBe(480);
  });

  it("rejects manager hours RPC ranges above 366 inclusive days", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);

    await expect(db.query(
      `select *
       from public.get_manager_hours_preview('2026-01-01', '2027-01-02')`,
    )).rejects.toThrow(/up to 366 days/i);
  });

  it("retains a shared lock and one materialized event snapshot contract", () => {
    expect(migration).toContain("public.lock_attendance_staff_writes");
    expect(migration).toMatch(/before insert on public\.clock_events/i);
    expect(migration).toMatch(/before insert on public\.clock_event_corrections/i);
    expect(migration).toMatch(/save_clock_event_correction_chain[\s\S]*perform public\.lock_attendance_staff_writes/i);
    expect(migration).toMatch(/use_planned_hours[\s\S]*perform public\.lock_attendance_staff_writes/i);
    expect(migration).toMatch(/effective_events jsonb[\s\S]*jsonb_agg/i);
    expect(migration).toMatch(/jsonb_array_length\(effective_events\)/i);
    expect(migration).toMatch(/jsonb_to_recordset\(effective_events\)/i);
    expect(migration).toMatch(/constraint trigger clock_event_correction_batch_primary/i);
    expect(migration).toMatch(/record_kiosk_clock_event[\s\S]*perform public\.lock_attendance_staff_writes/i);
    expect(migration).toContain("get_latest_effective_clock_event");
  });
});
