// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  DEVICE_TOKEN_A1,
  DEVICE_TOKEN_A2,
  ORG_A,
  SITE_A1,
  SITE_A2,
  STAFF_A,
  STAFF_A2,
  USER_A_OWNER,
  createAttendanceTenancyDatabase,
  resetTenantDatabaseRole,
  seedCommercialEvent,
  setTenantAuthUser,
} from "./helpers/attendance-tenancy-db";

describe("tenant-aware attendance state machine", () => {
  let db: PGlite;

  beforeAll(async () => { db = await createAttendanceTenancyDatabase(); }, 30_000);
  afterAll(async () => db.close());

  it("never lets yesterday's open shift become today's clock-out", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(
      `insert into public.clock_events (organisation_id,site_id,staff_id,event_type,event_timestamp,event_source)
       values ($1::uuid,$2::uuid,$3,'clock_in',(current_date - 1)::timestamp + time '08:30','kiosk')`,
      [ORG_A, SITE_A1, STAFF_A],
    );
    await setTenantAuthUser(db, USER_A_OWNER);
    const state = await db.query<{ state: { state: string; allowedActions: string[]; revision: string } }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,clock_timestamp()) state",
      [ORG_A, SITE_A1, STAFF_A],
    );
    expect(state.rows[0].state).toMatchObject({ state: "missing_clock_out", allowedActions: ["start_new_shift"] });

    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    const result = await db.query<{ result: { ok: boolean; state: string } }>(
      "select public.perform_commercial_kiosk_attendance_action($1,$2,$3,'start_new_shift',$4,$5::uuid) result",
      [DEVICE_TOKEN_A1, STAFF_A, "4826", state.rows[0].state.revision, randomUUID()],
    );
    expect(result.rows[0].result).toMatchObject({ ok: true, state: "clocked_in" });
    await resetTenantDatabaseRole(db);
    const yesterday = await db.query<{ count: number }>(
      `select count(*)::integer count from public.clock_events where organisation_id=$1::uuid and site_id=$2::uuid
       and staff_id=$3 and recorded_date=current_date-1`,
      [ORG_A, SITE_A1, STAFF_A],
    );
    expect(yesterday.rows[0].count).toBe(1);
  });

  it("does not pair attendance across occurrence sites", async () => {
    await seedCommercialEvent(db, { organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A2, type: "clock_in", timestamp: "2026-08-03T08:00:00+01:00" });
    await seedCommercialEvent(db, { organisationId: ORG_A, siteId: SITE_A2, staffId: STAFF_A2, type: "clock_out", timestamp: "2026-08-03T16:00:00+01:00" });
    await setTenantAuthUser(db, USER_A_OWNER);
    const a1 = await db.query<{ event_type: string }>(
      "select event_type from public.get_commercial_effective_clock_events($1::uuid,$2::uuid,'2026-08-03','2026-08-03',$3)",
      [ORG_A, SITE_A1, STAFF_A2],
    );
    const a2 = await db.query<{ event_type: string }>(
      "select event_type from public.get_commercial_effective_clock_events($1::uuid,$2::uuid,'2026-08-03','2026-08-03',$3)",
      [ORG_A, SITE_A2, STAFF_A2],
    );
    expect(a1.rows.map((row) => row.event_type)).toEqual(["clock_in"]);
    expect(a2.rows.map((row) => row.event_type)).toEqual(["clock_out"]);
  });

  it("rejects idempotency UUID replay with a changed staff payload", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    const state = await db.query<{ state: { revision: string } }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,clock_timestamp()) state",
      [ORG_A, SITE_A1, STAFF_A],
    );
    const operationId = randomUUID();
    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    await db.query(
      "select public.perform_commercial_kiosk_attendance_action($1,$2,$3,'clock_out',$4,$5::uuid)",
      [DEVICE_TOKEN_A1, STAFF_A, "4826", state.rows[0].state.revision, operationId],
    );
    await expect(db.query(
      "select public.perform_commercial_kiosk_attendance_action($1,$2,$3,'clock_out',$4,$5::uuid)",
      [DEVICE_TOKEN_A1, STAFF_A2, "4826", state.rows[0].state.revision, operationId],
    )).rejects.toThrow(/eligible|another request/i);
  });

  it("serialises concurrent retries into one authoritative result", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    const state = await db.query<{ state: { revision: string } }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,clock_timestamp()) state",
      [ORG_A, SITE_A2, STAFF_A2],
    );
    const operationId = randomUUID();
    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    const sql = "select public.perform_commercial_kiosk_attendance_action($1,$2,$3,'clock_in',$4,$5::uuid) result";
    const values = [DEVICE_TOKEN_A2, STAFF_A2, "4826", state.rows[0].state.revision, operationId];
    const [first, second] = await Promise.all([
      db.query<{ result: Record<string, unknown> }>(sql, values),
      db.query<{ result: Record<string, unknown> }>(sql, values),
    ]);
    expect(second.rows[0].result).toEqual(first.rows[0].result);
    await resetTenantDatabaseRole(db);
    const request = await db.query<{ request_count: number; event_count: number }>(
      `select count(*)::integer request_count,count(distinct resulting_event_id)::integer event_count
       from public.attendance_action_requests where idempotency_key=$1::uuid`,
      [operationId],
    );
    expect(request.rows[0]).toEqual({ request_count: 1, event_count: 1 });
  });
});
