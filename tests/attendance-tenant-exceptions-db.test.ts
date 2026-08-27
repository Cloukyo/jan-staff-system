// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ORG_A,
  SITE_A1,
  SITE_A2,
  STAFF_A,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  createAttendanceTenancyDatabase,
  resetTenantDatabaseRole,
  seedCommercialEvent,
  setTenantAuthUser,
} from "./helpers/attendance-tenancy-db";

describe("tenant-owned attendance exceptions", () => {
  let db: PGlite;
  beforeAll(async () => { db = await createAttendanceTenancyDatabase(); }, 30_000);
  afterAll(async () => db.close());

  it("reconciles one idempotent same-site missing-clock-out exception", async () => {
    await seedCommercialEvent(db, { organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A, type: "clock_in", timestamp: "2026-08-02T08:30:00+01:00" });
    await setTenantAuthUser(db, USER_A_OWNER);
    await db.query("select public.reconcile_commercial_attendance_exceptions($1::uuid,$2::uuid,$3,'2026-08-02')", [ORG_A, SITE_A1, STAFF_A]);
    await db.query("select public.reconcile_commercial_attendance_exceptions($1::uuid,$2::uuid,$3,'2026-08-02')", [ORG_A, SITE_A1, STAFF_A]);
    await resetTenantDatabaseRole(db);
    const result = await db.query<{ count: number; organisation_id: string; site_id: string }>(
      `select count(*)::integer count, min(organisation_id::text) organisation_id, min(site_id::text) site_id
       from public.attendance_exceptions where staff_id=$1 and operational_date='2026-08-02'`,
      [STAFF_A],
    );
    expect(result.rows).toEqual([{ count: 1, organisation_id: ORG_A, site_id: SITE_A1 }]);
  });

  it("requires a dismissal reason and prevents a Site A1 manager touching Site A2", async () => {
    await resetTenantDatabaseRole(db);
    const issue = await db.query<{ id: string }>(
      `insert into public.attendance_exceptions (
        organisation_id,site_id,staff_id,operational_date,exception_type,anomaly_fingerprint,detection_revision,source
       ) values ($1::uuid,$2::uuid,$3,'2026-08-03','unmatched_clock_out','a2-issue','revision','reconciliation') returning id::text`,
      [ORG_A, SITE_A2, "tenant-staff-a2"],
    );
    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    await expect(db.query(
      "select public.dismiss_commercial_attendance_exception($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid)",
      [ORG_A, SITE_A2, issue.rows[0].id, "Valid manager reason", "revision", randomUUID()],
    )).rejects.toThrow(/authorised/i);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(db.query(
      "select public.dismiss_commercial_attendance_exception($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid)",
      [ORG_A, SITE_A2, issue.rows[0].id, "bad", "revision", randomUUID()],
    )).rejects.toThrow(/five|reason/i);
  });

  it("records a dismissal once and returns the same audited result on retry", async () => {
    await resetTenantDatabaseRole(db);
    const issue = await db.query<{ id: string }>(
      `insert into public.attendance_exceptions (
        organisation_id,site_id,staff_id,operational_date,exception_type,anomaly_fingerprint,detection_revision,source
       ) values ($1::uuid,$2::uuid,$3,'2026-08-04','unmatched_clock_out','dismiss-retry','revision-1','reconciliation') returning id::text`,
      [ORG_A, SITE_A1, STAFF_A],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const state = await db.query<{ state: { revision: string } }>(
      "select public.get_commercial_attendance_state($1::uuid,$2::uuid,$3,'2026-08-04T12:00:00+01:00') state",
      [ORG_A, SITE_A1, STAFF_A],
    );
    const operationId = randomUUID();
    const sql = "select public.dismiss_commercial_attendance_exception($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid) result";
    const values = [ORG_A, SITE_A1, issue.rows[0].id, "Confirmed duplicate anomaly", state.rows[0].state.revision, operationId];
    const first = await db.query<{ result: Record<string, unknown> }>(sql, values);
    const retry = await db.query<{ result: Record<string, unknown> }>(sql, values);
    expect(retry.rows[0].result).toEqual(first.rows[0].result);
    await resetTenantDatabaseRole(db);
    const operations = await db.query<{ count: number }>(
      "select count(*)::integer count from public.attendance_exception_operations where operation_id=$1::uuid",
      [operationId],
    );
    expect(operations.rows[0].count).toBe(1);
  });
});
