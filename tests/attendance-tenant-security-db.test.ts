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
  STAFF_A,
  STAFF_A2,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  createAttendanceTenancyDatabase,
  resetTenantDatabaseRole,
  seedCommercialEvent,
  setTenantAuthUser,
} from "./helpers/attendance-tenancy-db";

describe("attendance tenant security and correction boundaries", () => {
  let db: PGlite;

  beforeAll(async () => { db = await createAttendanceTenancyDatabase(); }, 30_000);
  afterAll(async () => db.close());

  it("denies direct browser mutation of immutable evidence", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(db.query(
      `insert into public.clock_events (organisation_id,site_id,staff_id,event_type)
       values ($1::uuid,$2::uuid,$3,'clock_in')`,
      [ORG_A, SITE_A1, STAFF_A],
    )).rejects.toThrow(/permission denied/i);
  });

  it("denies cross-site and cross-organisation manager corrections", async () => {
    const eventId = await seedCommercialEvent(db, {
      organisationId: ORG_A, siteId: SITE_A2, staffId: STAFF_A2,
      type: "clock_in", timestamp: "2026-08-02T08:00:00+01:00",
    });
    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    await expect(db.query(
      `select public.save_commercial_clock_event_correction(
        $1::uuid,$2::uuid,$3,'2026-08-02',$4::uuid,$5::uuid,'clock_in','2026-08-02T08:10:00+01:00',$6,$7
      )`,
      [ORG_A, SITE_A2, STAFF_A2, eventId, randomUUID(), "Authorised correction reason", "guessed"],
    )).rejects.toThrow(/not authorised/i);
    await expect(db.query(
      `select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,clock_timestamp())`,
      [ORG_B, SITE_A1, STAFF_A],
    )).rejects.toThrow(/not authorised/i);
  });

  it("rejects stale correction revisions and returns an idempotent successful retry", async () => {
    const eventId = await seedCommercialEvent(db, {
      organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A,
      type: "clock_out", timestamp: "2026-08-01T16:00:00+01:00",
    });
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(db.query(
      `select public.save_commercial_clock_event_correction(
        $1::uuid,$2::uuid,$3,'2026-08-01',$4::uuid,$5::uuid,'clock_out','2026-08-01T16:10:00+01:00',$6,$7
      )`,
      [ORG_A, SITE_A1, STAFF_A, eventId, randomUUID(), "Confirmed amended finish", "stale-revision"],
    )).rejects.toThrow(/changed after/i);

    const state = await db.query<{ value: Record<string, unknown> }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,'2026-08-01T12:00:00+01:00') value",
      [ORG_A, SITE_A1, STAFF_A],
    );
    const correctionId = randomUUID();
    const parameters = [ORG_A, SITE_A1, STAFF_A, eventId, correctionId, "Confirmed amended finish", state.rows[0].value.revision];
    const sql = `select public.save_commercial_clock_event_correction(
      $1::uuid,$2::uuid,$3,'2026-08-01',$4::uuid,$5::uuid,'clock_out','2026-08-01T16:10:00+01:00',$6,$7
    )::text result`;
    const first = await db.query<{ result: string }>(sql, parameters);
    const retry = await db.query<{ result: string }>(sql, parameters);
    expect(retry.rows[0].result).toBe(first.rows[0].result);
  });

  it("dispatches commercial devices without accepting client tenant identifiers", async () => {
    await resetTenantDatabaseRole(db);
    await db.exec("set role anon");
    const verification = await db.query<{ result: Record<string, unknown> }>(
      "select public.verify_tenant_aware_device_kiosk_pin($1,$2,$3) result",
      [DEVICE_TOKEN_A1, STAFF_A, "4826"],
    );
    expect(verification.rows[0].result.ok).toBe(true);
    expect(verification.rows[0].result.code).not.toBe("legacy_stub");
  });

  it("keeps superseded corrections in audit but excludes them from the effective ledger", async () => {
    const originalId = await seedCommercialEvent(db, {
      organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A,
      type: "clock_in", timestamp: "2026-07-31T08:00:00+01:00",
    });
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const state1 = await db.query<{ state: { revision: string } }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,'2026-07-31T12:00:00+01:00') state",
      [ORG_A, SITE_A1, STAFF_A],
    );
    const firstId = randomUUID();
    await db.query(
      `select public.save_commercial_clock_event_correction(
        $1::uuid,$2::uuid,$3,'2026-07-31',$4::uuid,$5::uuid,'clock_in','2026-07-31T08:10:00+01:00',$6,$7
      )`,
      [ORG_A, SITE_A1, STAFF_A, originalId, firstId, "First confirmed amendment", state1.rows[0].state.revision],
    );
    const state2 = await db.query<{ state: { revision: string } }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,'2026-07-31T12:00:00+01:00') state",
      [ORG_A, SITE_A1, STAFF_A],
    );
    const secondId = randomUUID();
    await db.query(
      `select public.save_commercial_clock_event_correction(
        $1::uuid,$2::uuid,$3,'2026-07-31',$4::uuid,$5::uuid,'clock_in','2026-07-31T08:20:00+01:00',$6,$7
      )`,
      [ORG_A, SITE_A1, STAFF_A, firstId, secondId, "Second confirmed amendment", state2.rows[0].state.revision],
    );
    const effective = await db.query<{ correction_id: string; event_timestamp: string }>(
      `select correction_id::text,event_timestamp::text from public.get_commercial_effective_clock_events(
        $1::uuid,$2::uuid,'2026-07-31','2026-07-31',$3
      )`,
      [ORG_A, SITE_A1, STAFF_A],
    );
    expect(effective.rows).toHaveLength(1);
    expect(effective.rows[0].correction_id).toBe(secondId);
    await resetTenantDatabaseRole(db);
    const audit = await db.query<{ count: number }>(
      "select count(*)::integer count from public.clock_event_corrections where id in ($1::uuid,$2::uuid)",
      [firstId, secondId],
    );
    expect(audit.rows[0].count).toBe(2);
  });

  it("keeps SECURITY DEFINER kiosk grants narrow", async () => {
    await resetTenantDatabaseRole(db);
    const grants = await db.query<{ grantee: string }>(
      `select grantee from information_schema.routine_privileges
       where routine_schema='public' and routine_name='perform_tenant_aware_kiosk_attendance_action'
       order by grantee`,
    );
    expect(grants.rows.map((row) => row.grantee)).not.toContain("PUBLIC");
    expect(grants.rows.map((row) => row.grantee)).toEqual(expect.arrayContaining(["anon", "authenticated"]));
  });
});
