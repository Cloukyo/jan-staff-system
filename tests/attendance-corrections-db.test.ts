// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  MANAGER_ACCOUNT_ID,
  STAFF_ACCOUNT_ID,
  attendanceRevision,
  createAttendanceTestDatabase,
  effectiveEvents,
  resetRole,
  resetAttendanceToPlannedHours,
  saveManualCorrection,
  seedClockEvent,
  seedStaffShift,
  setAuthenticatedRole,
  setCurrentAccount,
  usePlannedHours,
} from "./helpers/attendance-corrections-db";

const migration = readFileSync(
  resolve("supabase/migrations/20260728230702_clock_event_corrections.sql"),
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

  it("blocks direct authenticated correction inserts but keeps the manager RPC authoritative", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const managerRevision = await attendanceRevision(db, "staff-profile", "2026-08-12");
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
    ).rejects.toThrow(/permission denied/i);

    const managerRpc = await db.query<{ batch_id: string }>(
      `select public.save_manual_clock_event_correction(
         'staff-profile',
         '2026-08-12',
         null,
         '10000000-0000-0000-0000-000000000012',
         'clock_in',
         '2026-08-12T09:00:00+01:00',
         'Manager correction through RPC',
         $1
       )::text as batch_id`,
      [managerRevision],
    );
    expect(managerRpc.rows[0].batch_id).toMatch(/^[0-9a-f-]{36}$/i);

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
    ).rejects.toThrow(/permission denied/i);
    await resetRole(db);
  });

  it("keeps replacement ordering and kiosk latest status stable at the same instant", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await db.query(
      `insert into public.staff_profiles (id, full_name)
       values ('equal-instant-order', 'Equal instant order')`,
    );
    await db.query(
      `insert into public.clock_events (
         id, staff_id, event_type, event_timestamp
       )
       values
         (
           '10000000-0000-0000-0000-000000000000',
           'equal-instant-order',
           'clock_in',
           '2026-08-23T09:00:00+01:00'
         ),
         (
           '20000000-0000-0000-0000-000000000000',
           'equal-instant-order',
           'clock_out',
           '2026-08-23T09:00:00+01:00'
         )`,
    );

    await saveManualCorrection(db, {
      staffId: "equal-instant-order",
      date: "2026-08-23",
      targetEventId: "10000000-0000-0000-0000-000000000000",
      primaryCorrectionId: "f0000000-0000-0000-0000-000000000000",
      eventType: "clock_in",
      timestamp: "2026-08-23T09:00:00+01:00",
    });

    const effective = await db.query<{
      event_id: string;
      event_order_key: string;
      event_type: string;
    }>(
      `select event_id::text, event_order_key::text, event_type
       from public.get_effective_clock_events(
         '2026-08-23',
         '2026-08-23',
         'equal-instant-order'
       )
       order by event_timestamp, event_order_key`,
    );
    const latest = await db.query<{ event_type: string }>(
      `select event_type
       from public.get_latest_effective_clock_event(
         'equal-instant-order',
         '2026-08-23',
         1
       )`,
    );

    expect(effective.rows).toEqual([
      {
        event_id: "f0000000-0000-0000-0000-000000000000",
        event_order_key: "10000000-0000-0000-0000-000000000000:original",
        event_type: "clock_in",
      },
      {
        event_id: "20000000-0000-0000-0000-000000000000",
        event_order_key: "20000000-0000-0000-0000-000000000000:original",
        event_type: "clock_out",
      },
    ]);
    expect(latest.rows[0].event_type).toBe("clock_out");
  });

  it("persists equal-instant add consequences in the same order as the preview", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await db.query(
      `insert into public.staff_profiles (id, full_name)
       values ('equal-instant-add', 'Equal instant add')`,
    );
    await db.query(
      `insert into public.clock_events (
         id, staff_id, event_type, event_timestamp
       )
       values
         (
           '10000000-0000-0000-0000-000000000001',
           'equal-instant-add',
           'clock_out',
           '2026-08-24T09:00:00+01:00'
         ),
         (
           '20000000-0000-0000-0000-000000000001',
           'equal-instant-add',
           'clock_in',
           '2026-08-24T09:00:00+01:00'
         ),
         (
           '30000000-0000-0000-0000-000000000001',
           'equal-instant-add',
           'clock_out',
           '2026-08-24T09:00:00+01:00'
         )`,
    );

    const batchId = await saveManualCorrection(db, {
      staffId: "equal-instant-add",
      date: "2026-08-24",
      primaryCorrectionId: "15000000-0000-4000-8000-000000000001",
      eventType: "clock_in",
      timestamp: "2026-08-24T09:00:00+01:00",
    });
    const corrections = await db.query<{
      correction_role: string;
      original_event_id: string | null;
      event_type: string;
    }>(
      `select
         correction_role,
         original_event_id::text,
         event_type
       from public.clock_event_corrections
       where batch_id = $1::uuid
       order by
         case when correction_role = 'primary' then 0 else 1 end,
         original_event_id nulls first`,
      [batchId],
    );
    const effective = await db.query<{
      event_order_key: string;
      event_type: string;
    }>(
      `select event_order_key, event_type
       from public.get_effective_clock_events(
         '2026-08-24',
         '2026-08-24',
         'equal-instant-add'
       )
       order by event_timestamp, event_order_key, event_id`,
    );

    expect(corrections.rows).toEqual([
      {
        correction_role: "primary",
        original_event_id: null,
        event_type: "clock_in",
      },
      {
        correction_role: "consequential",
        original_event_id: "20000000-0000-0000-0000-000000000001",
        event_type: "clock_out",
      },
      {
        correction_role: "consequential",
        original_event_id: "30000000-0000-0000-0000-000000000001",
        event_type: "clock_in",
      },
    ]);
    expect(effective.rows.map((row) => row.event_type)).toEqual([
      "clock_out",
      "clock_in",
      "clock_out",
      "clock_in",
    ]);
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

  it("fixes an active manager-added correction by superseding that correction", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "fix-added-correction", date: "2026-08-15" });

    const firstBatch = await saveManualCorrection(db, {
      staffId: "fix-added-correction",
      date: "2026-08-15",
      eventType: "clock_in",
      timestamp: "2026-08-15T09:00:00+01:00",
    });
    const first = await db.query<{ id: string }>(
      `select id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid and correction_role = 'primary'`,
      [firstBatch],
    );

    const secondBatch = await saveManualCorrection(db, {
      staffId: "fix-added-correction",
      date: "2026-08-15",
      targetEventId: first.rows[0].id,
      eventType: "clock_in",
      timestamp: "2026-08-15T09:15:00+01:00",
    });
    const second = await db.query<{
      original_event_id: string | null;
      supersedes_correction_id: string | null;
    }>(
      `select original_event_id::text, supersedes_correction_id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid and correction_role = 'primary'`,
      [secondBatch],
    );

    expect(second.rows[0]).toEqual({
      original_event_id: null,
      supersedes_correction_id: first.rows[0].id,
    });
    expect(await effectiveEvents(db, "fix-added-correction", "2026-08-15"))
      .toMatchObject([{ event_type: "clock_in", local_time: "09:15" }]);
  });

  it("re-fixes an original by superseding its active leaf instead of forking the chain", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "refix-original", date: "2026-08-16" });
    const originalId = await seedClockEvent(db, {
      staffId: "refix-original",
      timestamp: "2026-08-16T08:00:00+01:00",
      eventType: "clock_in",
    });
    const firstBatch = await saveManualCorrection(db, {
      staffId: "refix-original",
      date: "2026-08-16",
      targetEventId: originalId,
      eventType: "clock_in",
      timestamp: "2026-08-16T09:00:00+01:00",
    });
    const first = await db.query<{ id: string }>(
      `select id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid and correction_role = 'primary'`,
      [firstBatch],
    );

    const secondBatch = await saveManualCorrection(db, {
      staffId: "refix-original",
      date: "2026-08-16",
      targetEventId: originalId,
      eventType: "clock_in",
      timestamp: "2026-08-16T09:30:00+01:00",
    });
    const second = await db.query<{
      original_event_id: string | null;
      supersedes_correction_id: string | null;
    }>(
      `select original_event_id::text, supersedes_correction_id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid and correction_role = 'primary'`,
      [secondBatch],
    );

    expect(second.rows[0]).toEqual({
      original_event_id: null,
      supersedes_correction_id: first.rows[0].id,
    });
  });

  it("rejects a sibling correction that targets an already-corrected original", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "reject-correction-fork", date: "2026-08-17" });
    const originalId = await seedClockEvent(db, {
      staffId: "reject-correction-fork",
      timestamp: "2026-08-17T08:00:00+01:00",
      eventType: "clock_in",
    });
    await saveManualCorrection(db, {
      staffId: "reject-correction-fork",
      date: "2026-08-17",
      targetEventId: originalId,
      eventType: "clock_in",
      timestamp: "2026-08-17T09:00:00+01:00",
    });

    await expect(db.query(
      `insert into public.clock_event_corrections (
         batch_id, correction_role, staff_id, correction_kind,
         original_event_id, event_type, event_timestamp, recorded_date,
         reason, created_by
       )
       values (
         gen_random_uuid(), 'primary', 'reject-correction-fork', 'replace',
         $1::uuid, 'clock_in', '2026-08-17T09:30:00+01:00', '2026-08-17',
         'Invalid sibling correction', $2::uuid
       )`,
      [originalId, MANAGER_ACCOUNT_ID],
    )).rejects.toThrow(/active correction|supersede/i);
  });

  it("plans all manual consequences inside the database transaction", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "database-manual-plan", date: "2026-08-18" });
    const firstId = await seedClockEvent(db, {
      staffId: "database-manual-plan",
      timestamp: "2026-08-18T08:00:00+01:00",
      eventType: "clock_in",
    });
    await seedClockEvent(db, {
      staffId: "database-manual-plan",
      timestamp: "2026-08-18T12:00:00+01:00",
      eventType: "clock_in",
    });

    const batchId = await saveManualCorrection(db, {
      staffId: "database-manual-plan",
      date: "2026-08-18",
      targetEventId: firstId,
      eventType: "clock_in",
      timestamp: "2026-08-18T08:15:00+01:00",
    });
    const roles = await db.query<{ correction_role: string }>(
      `select correction_role
       from public.clock_event_corrections
       where batch_id = $1::uuid
       order by correction_role desc`,
      [batchId],
    );

    expect(roles.rows.map((row) => row.correction_role)).toEqual([
      "primary",
      "consequential",
    ]);
    expect(await effectiveEvents(db, "database-manual-plan", "2026-08-18"))
      .toMatchObject([
        { event_type: "clock_in", local_time: "08:15" },
        { event_type: "clock_out", local_time: "12:00" },
      ]);
  });

  it("rejects a stale manual preview without persisting any correction", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "stale-manual-preview", date: "2026-08-19" });
    const revision = await attendanceRevision(db, "stale-manual-preview", "2026-08-19");
    await seedClockEvent(db, {
      staffId: "stale-manual-preview",
      timestamp: "2026-08-19T08:00:00+01:00",
      eventType: "clock_in",
    });

    await expect(saveManualCorrection(db, {
      staffId: "stale-manual-preview",
      date: "2026-08-19",
      eventType: "clock_out",
      timestamp: "2026-08-19T17:00:00+01:00",
      expectedRevision: revision,
    })).rejects.toThrow(/changed after this preview/i);
    const count = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where staff_id = 'stale-manual-preview'`,
    );
    expect(count.rows[0].count).toBe(0);
  });

  it("rejects a stale planned-hours preview without persisting any correction", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "stale-planned-preview", date: "2026-08-20" });
    const revision = await attendanceRevision(db, "stale-planned-preview", "2026-08-20");
    await seedClockEvent(db, {
      staffId: "stale-planned-preview",
      timestamp: "2026-08-20T08:00:00+01:00",
      eventType: "clock_in",
    });

    await expect(db.query(
      `select public.use_planned_hours($1, $2::date, $3, $4)`,
      ["stale-planned-preview", "2026-08-20", "Use published hours", revision],
    )).rejects.toThrow(/changed after this preview/i);
    const count = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where staff_id = 'stale-planned-preview'`,
    );
    expect(count.rows[0].count).toBe(0);
  });

  it("appends an exclude correction for an original event without deleting its source row", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "remove-original", date: "2026-08-25" });
    const originalId = await seedClockEvent(db, {
      staffId: "remove-original",
      timestamp: "2026-08-25T09:00:00+01:00",
      eventType: "clock_in",
    });
    const revision = await attendanceRevision(db, "remove-original", "2026-08-25");
    const operationId = "10000000-0000-0000-0000-000000000025";

    const result = await db.query<{ batch_id: string }>(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )::text as batch_id`,
      [
        "remove-original",
        "2026-08-25",
        originalId,
        "Remove original clock-in",
        revision,
        operationId,
      ],
    );
    const correction = await db.query<{
      id: string;
      batch_id: string;
      correction_role: string;
      correction_kind: string;
      original_event_id: string | null;
      supersedes_correction_id: string | null;
      event_type: string | null;
      event_timestamp: string | null;
    }>(
      `select
         id::text,
         batch_id::text,
         correction_role,
         correction_kind,
         original_event_id::text,
         supersedes_correction_id::text,
         event_type,
         event_timestamp::text
       from public.clock_event_corrections
       where id = $1::uuid`,
      [operationId],
    );
    const source = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_events
       where id = $1::uuid`,
      [originalId],
    );

    expect(result.rows[0].batch_id).toBe(operationId);
    expect(correction.rows).toEqual([{
      id: operationId,
      batch_id: operationId,
      correction_role: "primary",
      correction_kind: "exclude",
      original_event_id: originalId,
      supersedes_correction_id: null,
      event_type: null,
      event_timestamp: null,
    }]);
    expect(source.rows[0].count).toBe(1);
    expect(await effectiveEvents(db, "remove-original", "2026-08-25")).toEqual([]);
  });

  it("appends an exclude correction that supersedes an active manager-added event", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "remove-added", date: "2026-08-26" });
    const addBatchId = await saveManualCorrection(db, {
      staffId: "remove-added",
      date: "2026-08-26",
      eventType: "clock_in",
      timestamp: "2026-08-26T09:00:00+01:00",
    });
    const added = await db.query<{ id: string }>(
      `select id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid and correction_role = 'primary'`,
      [addBatchId],
    );
    const revision = await attendanceRevision(db, "remove-added", "2026-08-26");
    const operationId = "10000000-0000-0000-0000-000000000026";

    const result = await db.query<{ batch_id: string }>(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )::text as batch_id`,
      [
        "remove-added",
        "2026-08-26",
        added.rows[0].id,
        "Remove added clock-in",
        revision,
        operationId,
      ],
    );
    const correction = await db.query<{
      original_event_id: string | null;
      supersedes_correction_id: string | null;
      correction_kind: string;
    }>(
      `select original_event_id::text, supersedes_correction_id::text, correction_kind
       from public.clock_event_corrections
       where id = $1::uuid`,
      [operationId],
    );
    const source = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where id = $1::uuid`,
      [added.rows[0].id],
    );

    expect(result.rows[0].batch_id).toBe(operationId);
    expect(correction.rows).toEqual([{
      original_event_id: null,
      supersedes_correction_id: added.rows[0].id,
      correction_kind: "exclude",
    }]);
    expect(source.rows[0].count).toBe(1);
    expect(await effectiveEvents(db, "remove-added", "2026-08-26")).toEqual([]);
  });

  it("rejects a stale removal revision without appending a correction", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "remove-stale", date: "2026-08-27" });
    const originalId = await seedClockEvent(db, {
      staffId: "remove-stale",
      timestamp: "2026-08-27T09:00:00+01:00",
      eventType: "clock_in",
    });
    const revision = await attendanceRevision(db, "remove-stale", "2026-08-27");
    await seedClockEvent(db, {
      staffId: "remove-stale",
      timestamp: "2026-08-27T17:00:00+01:00",
      eventType: "clock_out",
    });

    await expect(db.query(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )`,
      [
        "remove-stale",
        "2026-08-27",
        originalId,
        "Remove stale event",
        revision,
        "10000000-0000-0000-0000-000000000027",
      ],
    )).rejects.toThrow(/changed after this preview/i);
    const count = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where staff_id = 'remove-stale'`,
    );

    expect(count.rows[0].count).toBe(0);
  });

  it("rejects removal requests from non-managers", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "remove-staff", date: "2026-08-28" });
    const originalId = await seedClockEvent(db, {
      staffId: "remove-staff",
      timestamp: "2026-08-28T09:00:00+01:00",
      eventType: "clock_in",
    });
    const revision = await attendanceRevision(db, "remove-staff", "2026-08-28");

    await setCurrentAccount(db, STAFF_ACCOUNT_ID);
    await setAuthenticatedRole(db);
    await expect(db.query(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )`,
      [
        "remove-staff",
        "2026-08-28",
        originalId,
        "Staff removal request",
        revision,
        "10000000-0000-0000-0000-000000000028",
      ],
    )).rejects.toThrow(/manager access required/i);
    await resetRole(db);
  });

  it("rejects removal reasons shorter than five characters", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "remove-short-reason", date: "2026-08-29" });
    const originalId = await seedClockEvent(db, {
      staffId: "remove-short-reason",
      timestamp: "2026-08-29T09:00:00+01:00",
      eventType: "clock_in",
    });
    const revision = await attendanceRevision(db, "remove-short-reason", "2026-08-29");

    await expect(db.query(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )`,
      [
        "remove-short-reason",
        "2026-08-29",
        originalId,
        "Nope",
        revision,
        "10000000-0000-0000-0000-000000000029",
      ],
    )).rejects.toThrow(/at least five characters/i);
  });

  it("returns the existing removal batch when an operation is retried", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await seedStaffShift(db, { staffId: "remove-retry", date: "2026-08-30" });
    const originalId = await seedClockEvent(db, {
      staffId: "remove-retry",
      timestamp: "2026-08-30T09:00:00+01:00",
      eventType: "clock_in",
    });
    const revision = await attendanceRevision(db, "remove-retry", "2026-08-30");
    const operationId = "10000000-0000-0000-0000-000000000030";
    const params = [
      "remove-retry",
      "2026-08-30",
      originalId,
      "Retry removal request",
      revision,
      operationId,
    ];

    const first = await db.query<{ batch_id: string }>(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )::text as batch_id`,
      params,
    );
    const second = await db.query<{ batch_id: string }>(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )::text as batch_id`,
      params,
    );
    const count = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where batch_id = $1::uuid`,
      [operationId],
    );

    expect(first.rows[0].batch_id).toBe(operationId);
    expect(second.rows[0].batch_id).toBe(operationId);
    expect(count.rows[0].count).toBe(1);
  });

  it("rejects a reset operation ID reused for another staff member and date", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const operationId = "30000000-0000-0000-0000-000000000001";
    await seedStaffShift(db, { staffId: "reset-collision-first", date: "2026-09-07" });
    await seedStaffShift(db, { staffId: "reset-collision-second", date: "2026-09-08" });

    await resetAttendanceToPlannedHours(db, {
      staffId: "reset-collision-first",
      date: "2026-09-07",
      operationId,
    });

    await expect(resetAttendanceToPlannedHours(db, {
      staffId: "reset-collision-second",
      date: "2026-09-08",
      operationId,
    })).rejects.toThrow(/operation ID is already used for a different attendance operation/i);
    const secondStaffCorrections = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where staff_id = 'reset-collision-second'`,
    );
    expect(secondStaffCorrections.rows[0].count).toBe(0);
  });

  it("rejects a removal operation ID reused as a reset operation", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "remove-then-reset-collision";
    const date = "2026-09-09";
    const operationId = "30000000-0000-0000-0000-000000000002";
    await seedStaffShift(db, { staffId, date });
    const originalId = await seedClockEvent(db, {
      staffId,
      timestamp: "2026-09-09T09:00:00+01:00",
      eventType: "clock_in",
    });
    const removalRevision = await attendanceRevision(db, staffId, date);

    await db.query(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )`,
      [staffId, date, originalId, "Remove before reset collision", removalRevision, operationId],
    );

    await expect(resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      operationId,
    })).rejects.toThrow(/operation ID is already used for a different attendance operation/i);
    const batch = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where batch_id = $1::uuid`,
      [operationId],
    );
    expect(batch.rows[0].count).toBe(1);
  });

  it("rejects a reset operation ID reused as a removal operation", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-then-remove-collision";
    const date = "2026-09-10";
    const operationId = "30000000-0000-0000-0000-000000000003";
    await seedStaffShift(db, { staffId, date });
    await seedClockEvent(db, {
      staffId,
      timestamp: "2026-09-10T08:00:00+01:00",
      eventType: "clock_in",
    });

    await resetAttendanceToPlannedHours(db, { staffId, date, operationId });
    const effectiveStart = await db.query<{ event_id: string }>(
      `select event_id::text
       from public.get_effective_clock_events($1::date, $1::date, $2)
       where event_type = 'clock_in'`,
      [date, staffId],
    );
    const removalRevision = await attendanceRevision(db, staffId, date);

    await expect(db.query(
      `select public.remove_clock_event_from_hours(
         $1, $2::date, $3::uuid, $4, $5, $6::uuid
       )`,
      [
        staffId,
        date,
        effectiveStart.rows[0].event_id,
        "Remove after reset collision",
        removalRevision,
        operationId,
      ],
    )).rejects.toThrow(/operation ID is already used for a different attendance operation/i);
    const batch = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_event_corrections
       where batch_id = $1::uuid`,
      [operationId],
    );
    expect(batch.rows[0].count).toBe(3);
  });

  it("serializes concurrent reset requests sharing one operation ID", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const operationId = "30000000-0000-0000-0000-000000000004";
    await seedStaffShift(db, { staffId: "reset-concurrent-first", date: "2026-09-11" });
    await seedStaffShift(db, { staffId: "reset-concurrent-second", date: "2026-09-11" });

    const results = await Promise.allSettled([
      resetAttendanceToPlannedHours(db, {
        staffId: "reset-concurrent-first",
        date: "2026-09-11",
        operationId,
      }),
      resetAttendanceToPlannedHours(db, {
        staffId: "reset-concurrent-second",
        date: "2026-09-11",
        operationId,
      }),
    ]);
    const batchStaff = await db.query<{ staff_id: string; count: number }>(
      `select staff_id, count(*)::integer as count
       from public.clock_event_corrections
       where batch_id = $1::uuid
       group by staff_id`,
      [operationId],
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(batchStaff.rows).toHaveLength(1);
  });

  it("resets malformed effective attendance to full published planned boundaries", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-malformed";
    const date = "2026-09-01";
    const operationId = "20000000-0000-0000-0000-000000000001";
    await seedStaffShift(db, { staffId, date });
    const originalStart = await seedClockEvent(db, {
      staffId,
      timestamp: "2026-09-01T08:00:00+01:00",
      eventType: "clock_in",
    });
    const originalMiddle = await seedClockEvent(db, {
      staffId,
      timestamp: "2026-09-01T12:00:00+01:00",
      eventType: "clock_out",
    });
    const activeCorrectionBatch = await saveManualCorrection(db, {
      staffId,
      date,
      targetEventId: originalMiddle,
      eventType: "clock_in",
      timestamp: "2026-09-01T12:15:00+01:00",
    });
    const originalFinish = await seedClockEvent(db, {
      staffId,
      timestamp: "2026-09-01T18:00:00+01:00",
      eventType: "clock_out",
    });

    const batchId = await resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      operationId,
    });
    const corrections = await db.query<{
      correction_kind: string;
      correction_role: string;
      original_event_id: string | null;
      supersedes_correction_id: string | null;
      event_type: string | null;
      local_time: string | null;
      reason: string;
    }>(
      `select
         correction_kind,
         correction_role,
         original_event_id::text,
         supersedes_correction_id::text,
         event_type,
         to_char(event_timestamp at time zone 'Europe/London', 'HH24:MI') as local_time,
         reason
       from public.clock_event_corrections
       where batch_id = $1::uuid
       order by created_at, id`,
      [operationId],
    );
    const originalCount = await db.query<{ count: number }>(
      `select count(*)::integer as count
       from public.clock_events
       where id = any($1::uuid[])`,
      [[originalStart, originalMiddle, originalFinish]],
    );
    const activeCorrection = await db.query<{ id: string }>(
      `select id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid`,
      [activeCorrectionBatch],
    );
    const duration = await db.query<{ minutes: number }>(
      `select extract(epoch from (max(event_timestamp) - min(event_timestamp)))::integer / 60 as minutes
       from public.get_effective_clock_events($1::date, $1::date, $2)`,
      [date, staffId],
    );

    expect(batchId).toBe(operationId);
    expect(corrections.rows).toHaveLength(5);
    expect(corrections.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ correction_kind: "exclude", correction_role: "primary", original_event_id: originalStart }),
      expect.objectContaining({ correction_kind: "exclude", correction_role: "consequential", supersedes_correction_id: activeCorrection.rows[0].id }),
      expect.objectContaining({ correction_kind: "exclude", correction_role: "consequential", original_event_id: originalFinish }),
      expect.objectContaining({ correction_kind: "add", correction_role: "consequential", event_type: "clock_in", local_time: "09:00" }),
      expect.objectContaining({ correction_kind: "add", correction_role: "consequential", event_type: "clock_out", local_time: "17:00" }),
    ]));
    expect(corrections.rows.every((correction) => correction.reason === "Reset attendance to planned hours")).toBe(true);
    expect(originalCount.rows[0].count).toBe(3);
    expect(await effectiveEvents(db, staffId, date)).toMatchObject([
      { event_type: "clock_in", local_time: "09:00" },
      { event_type: "clock_out", local_time: "17:00" },
    ]);
    expect(duration.rows[0].minutes).toBe(480);
  });

  it("resets an already-correct day through one append-only batch", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-correct";
    const date = "2026-09-02";
    const operationId = "20000000-0000-0000-0000-000000000002";
    await seedStaffShift(db, { staffId, date });
    await seedClockEvent(db, { staffId, timestamp: "2026-09-02T09:00:00+01:00", eventType: "clock_in" });
    await seedClockEvent(db, { staffId, timestamp: "2026-09-02T17:00:00+01:00", eventType: "clock_out" });

    await resetAttendanceToPlannedHours(db, { staffId, date, operationId });
    const corrections = await db.query<{ count: number; batch_count: number }>(
      `select count(*)::integer as count, count(distinct batch_id)::integer as batch_count
       from public.clock_event_corrections
       where batch_id = $1::uuid`,
      [operationId],
    );

    expect(corrections.rows[0]).toEqual({ count: 4, batch_count: 1 });
    expect(await effectiveEvents(db, staffId, date)).toMatchObject([
      { event_type: "clock_in", local_time: "09:00" },
      { event_type: "clock_out", local_time: "17:00" },
    ]);
  });

  it("rejects a reset without a published shift before writing corrections", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-no-shift";
    const date = "2026-09-03";
    await db.query("insert into public.staff_profiles (id, full_name) values ($1, $1)", [staffId]);
    const revision = await attendanceRevision(db, staffId, date);

    await expect(resetAttendanceToPlannedHours(db, { staffId, date, expectedRevision: revision }))
      .rejects.toThrow(/no published rota shift/i);
    const count = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.clock_event_corrections where staff_id = $1",
      [staffId],
    );
    expect(count.rows[0].count).toBe(0);
  });

  it("rejects a stale reset revision without writing corrections", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-stale";
    const date = "2026-09-04";
    await seedStaffShift(db, { staffId, date });
    const revision = await attendanceRevision(db, staffId, date);
    await seedClockEvent(db, { staffId, timestamp: "2026-09-04T08:00:00+01:00", eventType: "clock_in" });

    await expect(resetAttendanceToPlannedHours(db, { staffId, date, expectedRevision: revision }))
      .rejects.toThrow(/changed after this preview/i);
    const count = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.clock_event_corrections where staff_id = $1",
      [staffId],
    );
    expect(count.rows[0].count).toBe(0);
  });

  it.each([
    {
      label: "start",
      staffId: "reset-stale-planned-start",
      date: "2026-09-14",
      column: "start_time",
      replacement: "08:30",
    },
    {
      label: "finish",
      staffId: "reset-stale-planned-finish",
      date: "2026-09-15",
      column: "end_time",
      replacement: "17:30",
    },
  ])("rejects a stale planned $label with SQLSTATE 40001 before writing", async ({
    staffId,
    date,
    column,
    replacement,
  }) => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const operationId = randomUUID();
    await seedStaffShift(db, { staffId, date });
    const revision = await attendanceRevision(db, staffId, date);
    await db.query(
      `update public.rota_shifts
       set ${column} = $1::time
       where staff_id = $2 and shift_date = $3::date`,
      [replacement, staffId, date],
    );

    await expect(resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      expectedRevision: revision,
      expectedPlannedStart: "09:00",
      expectedPlannedFinish: "17:00",
      operationId,
    })).rejects.toMatchObject({ code: "40001" });
    const writes = await db.query<{ request_count: number; correction_count: number }>(
      `select
         (select count(*)::integer
          from public.attendance_operation_requests
          where operation_id = $1::uuid) as request_count,
         (select count(*)::integer
          from public.clock_event_corrections
          where batch_id = $1::uuid) as correction_count`,
      [operationId],
    );

    expect(writes.rows[0]).toEqual({ request_count: 0, correction_count: 0 });
  });

  it.each([
    { label: "spring-forward", date: "2026-03-29" },
    { label: "autumn overlap", date: "2026-10-25" },
  ])("rejects a $label reset boundary before writing", async ({ label, date }) => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = `reset-${label.replaceAll(" ", "-")}`;
    const operationId = randomUUID();
    await seedStaffShift(db, {
      staffId,
      date,
      start: "01:30",
      finish: "03:30",
    });

    await expect(resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      expectedPlannedStart: "01:30",
      expectedPlannedFinish: "03:30",
      operationId,
    })).rejects.toThrow(/clock change/i);
    const writes = await db.query<{ request_count: number; correction_count: number }>(
      `select
         (select count(*)::integer
          from public.attendance_operation_requests
          where operation_id = $1::uuid) as request_count,
         (select count(*)::integer
          from public.clock_event_corrections
          where batch_id = $1::uuid) as correction_count`,
      [operationId],
    );

    expect(writes.rows[0]).toEqual({ request_count: 0, correction_count: 0 });
  });

  it("accepts a unique 01:30 reset boundary on a normal London date", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-normal-boundary";
    const date = "2026-02-15";
    await seedStaffShift(db, {
      staffId,
      date,
      start: "01:30",
      finish: "03:30",
    });

    await resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      expectedPlannedStart: "01:30",
      expectedPlannedFinish: "03:30",
    });

    expect(await effectiveEvents(db, staffId, date)).toMatchObject([
      { event_type: "clock_in", local_time: "01:30" },
      { event_type: "clock_out", local_time: "03:30" },
    ]);
  });

  it("rejects reset requests from non-managers", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-staff";
    const date = "2026-09-05";
    await seedStaffShift(db, { staffId, date });
    const revision = await attendanceRevision(db, staffId, date);

    await setCurrentAccount(db, STAFF_ACCOUNT_ID);
    await setAuthenticatedRole(db);
    await expect(resetAttendanceToPlannedHours(db, { staffId, date, expectedRevision: revision }))
      .rejects.toThrow(/manager access required/i);
    await resetRole(db);
  });

  it("returns the original reset batch without duplicate corrections on retry", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-retry";
    const date = "2026-09-06";
    const operationId = "20000000-0000-0000-0000-000000000006";
    await seedStaffShift(db, { staffId, date });
    await seedClockEvent(db, { staffId, timestamp: "2026-09-06T08:30:00+01:00", eventType: "clock_in" });
    const revision = await attendanceRevision(db, staffId, date);

    const first = await resetAttendanceToPlannedHours(db, { staffId, date, expectedRevision: revision, operationId });
    const second = await resetAttendanceToPlannedHours(db, { staffId, date, expectedRevision: revision, operationId });
    await expect(resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      expectedRevision: revision,
      operationId,
      expectedPlannedFinish: "16:30",
    })).rejects.toThrow(/operation ID is already used for a different attendance operation/i);
    const count = await db.query<{ count: number }>(
      "select count(*)::integer as count from public.clock_event_corrections where batch_id = $1::uuid",
      [operationId],
    );
    const request = await db.query<{ planned_start: string; planned_finish: string }>(
      `select
         to_char(expected_planned_start, 'HH24:MI') as planned_start,
         to_char(expected_planned_finish, 'HH24:MI') as planned_finish
       from public.attendance_operation_requests
       where operation_id = $1::uuid`,
      [operationId],
    );

    expect(first).toBe(operationId);
    expect(second).toBe(operationId);
    expect(count.rows[0].count).toBe(3);
    expect(request.rows[0]).toEqual({ planned_start: "09:00", planned_finish: "17:00" });
  });

  it("rolls back the request ledger when correction insertion fails and permits retry", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const staffId = "reset-atomic-retry";
    const date = "2026-09-16";
    const operationId = "20000000-0000-0000-0000-000000000016";
    await seedStaffShift(db, { staffId, date });
    await seedClockEvent(db, {
      staffId,
      timestamp: "2026-09-16T08:30:00+01:00",
      eventType: "clock_in",
    });
    const revision = await attendanceRevision(db, staffId, date);
    await db.exec(`
      create function public.fail_selected_reset_correction()
      returns trigger
      language plpgsql
      set search_path = public
      as $$
      begin
        if new.batch_id = '${operationId}'::uuid then
          raise exception 'Injected correction insert failure';
        end if;
        return new;
      end;
      $$;

      create trigger fail_selected_reset_correction
      before insert on public.clock_event_corrections
      for each row execute function public.fail_selected_reset_correction();
    `);

    await expect(resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      expectedRevision: revision,
      operationId,
    })).rejects.toThrow(/injected correction insert failure/i);
    const failedWrites = await db.query<{ request_count: number; correction_count: number }>(
      `select
         (select count(*)::integer
          from public.attendance_operation_requests
          where operation_id = $1::uuid) as request_count,
         (select count(*)::integer
          from public.clock_event_corrections
          where batch_id = $1::uuid) as correction_count`,
      [operationId],
    );
    expect(failedWrites.rows[0]).toEqual({ request_count: 0, correction_count: 0 });

    await db.exec(`
      drop trigger fail_selected_reset_correction on public.clock_event_corrections;
      drop function public.fail_selected_reset_correction();
    `);
    const retry = await resetAttendanceToPlannedHours(db, {
      staffId,
      date,
      expectedRevision: revision,
      operationId,
    });
    const successfulWrites = await db.query<{ request_count: number; correction_count: number }>(
      `select
         (select count(*)::integer
          from public.attendance_operation_requests
          where operation_id = $1::uuid) as request_count,
         (select count(*)::integer
          from public.clock_event_corrections
          where batch_id = $1::uuid) as correction_count`,
      [operationId],
    );

    expect(retry).toBe(operationId);
    expect(successfulWrites.rows[0]).toEqual({ request_count: 1, correction_count: 3 });
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

  it("does not pair SQL attendance events across recorded dates", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    await db.query(
      `insert into public.staff_profiles (id, full_name)
       values ('sql-cross-date', 'SQL cross date')`,
    );
    await seedClockEvent(db, {
      staffId: "sql-cross-date",
      timestamp: "2026-08-17T08:00:00+01:00",
      eventType: "clock_in",
    });
    await seedClockEvent(db, {
      staffId: "sql-cross-date",
      timestamp: "2026-08-18T17:00:00+01:00",
      eventType: "clock_out",
    });

    const staff = await db.query<{
      completed_minutes: number;
      open_shift_in_progress: boolean;
    }>(
      `select completed_minutes, open_shift_in_progress
       from public.get_staff_weekly_hours('sql-cross-date', '2026-08-17')`,
    );
    const manager = await db.query<{
      completed_minutes: number;
      open_shift_count: number;
    }>(
      `select completed_minutes, open_shift_count
       from public.get_manager_hours_preview('2026-08-17', '2026-08-18')
       where staff_id = 'sql-cross-date'`,
    );

    expect(staff.rows[0]).toEqual({
      completed_minutes: 0,
      open_shift_in_progress: true,
    });
    expect(manager.rows[0]).toEqual({
      completed_minutes: 0,
      open_shift_count: 1,
    });
  });

  it("returns only limited own-attendance records through the authenticated staff RPC", async () => {
    await resetRole(db);
    await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
    const ownOriginalId = await seedClockEvent(db, {
      staffId: "staff-profile",
      timestamp: "2026-08-21T08:00:00+01:00",
      eventType: "clock_in",
    });
    await db.query(
      `insert into public.staff_profiles (id, full_name)
       values ('other-staff-rpc', 'Other staff RPC')`,
    );
    const otherId = await seedClockEvent(db, {
      staffId: "other-staff-rpc",
      timestamp: "2026-08-21T08:30:00+01:00",
      eventType: "clock_in",
    });
    const batchId = await saveManualCorrection(db, {
      staffId: "staff-profile",
      date: "2026-08-21",
      targetEventId: ownOriginalId,
      eventType: "clock_in",
      timestamp: "2026-08-21T09:00:00+01:00",
      reason: "Private manager correction reason",
    });
    const ownCorrection = await db.query<{ id: string }>(
      `select id::text
       from public.clock_event_corrections
       where batch_id = $1::uuid and correction_role = 'primary'`,
      [batchId],
    );

    await setCurrentAccount(db, STAFF_ACCOUNT_ID);
    await setAuthenticatedRole(db);
    const records = await db.query<Record<string, unknown>>(
      `select *
       from public.get_own_attendance_records('2026-08-21', '2026-08-21')`,
    );

    expect(records.rows.map((row) => row.id)).toEqual([
      ownOriginalId,
      ownCorrection.rows[0].id,
    ]);
    expect(records.rows.map((row) => row.id)).not.toContain(otherId);
    for (const row of records.rows) {
      expect(row).not.toHaveProperty("staff_id");
      expect(row).not.toHaveProperty("reason");
      expect(row).not.toHaveProperty("created_by");
      expect(row).not.toHaveProperty("hourly_rate");
    }
    await resetRole(db);
  });

  it("keeps authoritative correction RPCs manager-only and prevents plan bypass", async () => {
    await resetRole(db);
    const revision = await attendanceRevision(db, "staff-profile", "2026-08-22");
    await setCurrentAccount(db, STAFF_ACCOUNT_ID);
    await setAuthenticatedRole(db);

    await expect(db.query(
      `select public.save_manual_clock_event_correction(
         'staff-profile',
         '2026-08-22',
         null,
         '10000000-0000-0000-0000-000000000022',
         'clock_in',
         '2026-08-22T09:00:00+01:00',
         'Staff cannot correct attendance',
         $1
       )`,
      [revision],
    )).rejects.toThrow(/manager access required/i);
    await expect(db.query(
      `select public.save_clock_event_correction_chain(
         '{"reason":"Bypass preview","primary":{},"consequential":[]}'::jsonb
       )`,
    )).rejects.toThrow(/permission denied/i);
    await resetRole(db);
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
