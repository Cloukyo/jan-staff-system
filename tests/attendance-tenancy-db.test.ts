// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  DEVICE_TOKEN_A1,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  STAFF_A2,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  createAttendanceTenancyDatabase,
  resetTenantDatabaseRole,
  seedCommercialEvent,
  setTenantAuthUser,
} from "./helpers/attendance-tenancy-db";

describe("attendance tenancy executable migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createAttendanceTenancyDatabase();
  }, 30_000);

  afterAll(async () => db.close());

  it("keeps inherited Jan evidence explicitly unowned", async () => {
    await resetTenantDatabaseRole(db);
    const result = await db.query<{ organisation_id: string | null; site_id: string | null }>(
      "select organisation_id::text, site_id::text from public.clock_events where staff_id = 'legacy-unowned-staff'",
    );
    expect(result.rows).toEqual([{ organisation_id: null, site_id: null }]);
  });

  it("requires authoritative ownership for commercial staff and rejects cross-tenant links", async () => {
    await resetTenantDatabaseRole(db);
    await expect(db.query(
      "insert into public.clock_events (staff_id, event_type) values ($1, 'clock_in')",
      [STAFF_A],
    )).rejects.toThrow(/requires organisation/i);
    await expect(db.query(
      `insert into public.clock_events (organisation_id, site_id, staff_id, event_type)
       values ($1::uuid, $2::uuid, $3, 'clock_in')`,
      [ORG_B, SITE_B1, STAFF_A],
    )).rejects.toThrow(/organisation|foreign key/i);
  });

  it("makes the occurrence-site snapshot immutable", async () => {
    const eventId = await seedCommercialEvent(db, {
      organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A,
      type: "clock_in", timestamp: "2026-08-04T08:30:00+01:00",
    });
    await expect(db.query(
      "update public.clock_events set site_id = $1::uuid where id = $2::uuid",
      [SITE_A2, eventId],
    )).rejects.toThrow(/immutable/i);
  });

  it("enforces site-limited reads while organisation-wide attendance access sees both sites", async () => {
    await seedCommercialEvent(db, {
      organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A,
      type: "clock_out", timestamp: "2026-08-04T16:30:00+01:00",
    });
    await seedCommercialEvent(db, {
      organisationId: ORG_A, siteId: SITE_A2, staffId: STAFF_A2,
      type: "clock_in", timestamp: "2026-08-04T09:00:00+01:00",
    });
    await seedCommercialEvent(db, {
      organisationId: ORG_B, siteId: SITE_B1, staffId: STAFF_B,
      type: "clock_in", timestamp: "2026-08-04T09:00:00+01:00",
    });

    await setTenantAuthUser(db, USER_A_SITE_MANAGER);
    const siteManager = await db.query<{ site_id: string }>(
      "select site_id::text from public.clock_events where organisation_id is not null order by site_id",
    );
    expect(new Set(siteManager.rows.map((row) => row.site_id))).toEqual(new Set([SITE_A1]));

    await setTenantAuthUser(db, USER_A_OWNER);
    const owner = await db.query<{ site_id: string }>(
      "select site_id::text from public.clock_events where organisation_id = $1::uuid order by site_id",
      [ORG_A],
    );
    expect(new Set(owner.rows.map((row) => row.site_id))).toEqual(new Set([SITE_A1, SITE_A2]));
  });

  it("does not mix effective events across sites", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    const result = await db.query<{ site_id: string }>(
      `select site_id::text from public.get_commercial_effective_clock_events(
        $1::uuid, $2::uuid, '2026-08-04'::date, '2026-08-04'::date, null
      )`,
      [ORG_A, SITE_A1],
    );
    expect(result.rows.every((row) => row.site_id === SITE_A1)).toBe(true);
  });

  it("records one site-bound kiosk event and returns it for an idempotent retry", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    const state = await db.query<{ state: Record<string, unknown> }>(
      "select public.get_commercial_attendance_state($1::uuid, $2::uuid, $3, clock_timestamp()) as state",
      [ORG_A, SITE_A1, STAFF_A],
    );
    const revision = String(state.rows[0].state.revision);
    const operationId = randomUUID();
    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    const first = await db.query<{ result: Record<string, unknown> }>(
      `select public.perform_commercial_kiosk_attendance_action($1,$2,$3,'clock_in',$4,$5::uuid) as result`,
      [DEVICE_TOKEN_A1, STAFF_A, "4826", revision, operationId],
    );
    const retry = await db.query<{ result: Record<string, unknown> }>(
      `select public.perform_commercial_kiosk_attendance_action($1,$2,$3,'clock_in',$4,$5::uuid) as result`,
      [DEVICE_TOKEN_A1, STAFF_A, "4826", revision, operationId],
    );
    expect(retry.rows[0].result).toEqual(first.rows[0].result);
    await resetTenantDatabaseRole(db);
    const events = await db.query<{ count: number }>(
      `select count(*)::integer count from public.clock_events
       where organisation_id = $1::uuid and site_id = $2::uuid and staff_id = $3 and recorded_date = current_date`,
      [ORG_A, SITE_A1, STAFF_A],
    );
    expect(events.rows[0].count).toBe(1);
  });

  it("rejects a kiosk-bound site when staff is assigned only elsewhere", async () => {
    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    await expect(db.query(
      `select public.verify_commercial_device_kiosk_pin($1,$2,$3)`,
      [DEVICE_TOKEN_A1, STAFF_A2, "4826"],
    )).rejects.toThrow(/eligible.*site/i);
  });

  it("returns only the device site's eligible roster and keeps commercial offline disabled", async () => {
    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    const roster = await db.query<{ staff_id: string }>(
      "select staff_id from public.get_tenant_aware_device_kiosk_roster($1)",
      [DEVICE_TOKEN_A1],
    );
    expect(roster.rows.map((row) => row.staff_id)).toEqual([STAFF_A]);
    await resetTenantDatabaseRole(db);
    await expect(db.query(
      "update public.kiosk_devices set offline_enabled=true where organisation_id=$1::uuid and site_id=$2::uuid",
      [ORG_A, SITE_A1],
    )).rejects.toThrow(/offline|check constraint/i);
  });

  it("rejects an exception linked to evidence in another organisation", async () => {
    const otherEvent = await seedCommercialEvent(db, {
      organisationId: ORG_B, siteId: SITE_B1, staffId: STAFF_B,
      type: "clock_out", timestamp: "2026-08-05T17:00:00+01:00",
    });
    await resetTenantDatabaseRole(db);
    await expect(db.query(
      `insert into public.attendance_exceptions (
        organisation_id,site_id,staff_id,operational_date,exception_type,primary_event_id,
        anomaly_fingerprint,detection_revision,source
      ) values ($1::uuid,$2::uuid,$3,'2026-08-05','unmatched_clock_out',$4::uuid,'cross-org','revision','reconciliation')`,
      [ORG_A, SITE_A1, STAFF_A, otherEvent],
    )).rejects.toThrow(/foreign key/i);
  });

  it("creates a same-site correction without changing the original event", async () => {
    const originalId = await seedCommercialEvent(db, {
      organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A,
      type: "clock_in", timestamp: "2026-08-05T08:30:00+01:00",
    });
    await resetTenantDatabaseRole(db);
    const before = await db.query<Record<string, unknown>>("select * from public.clock_events where id = $1::uuid", [originalId]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const state = await db.query<{ state: Record<string, unknown> }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,'2026-08-05T12:00:00+01:00') state",
      [ORG_A, SITE_A1, STAFF_A],
    );
    await db.query(
      `select public.save_commercial_clock_event_correction(
        $1::uuid,$2::uuid,$3,'2026-08-05'::date,$4::uuid,$5::uuid,'clock_in','2026-08-05T08:45:00+01:00',$6,$7
      )`,
      [ORG_A, SITE_A1, STAFF_A, originalId, randomUUID(), "Manager confirmed amended time", state.rows[0].state.revision],
    );
    await resetTenantDatabaseRole(db);
    const after = await db.query<Record<string, unknown>>("select * from public.clock_events where id = $1::uuid", [originalId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const correction = await db.query<{ organisation_id: string; site_id: string }>(
      "select organisation_id::text, site_id::text from public.clock_event_corrections where original_event_id = $1::uuid",
      [originalId],
    );
    expect(correction.rows).toEqual([{ organisation_id: ORG_A, site_id: SITE_A1 }]);
  });
});
