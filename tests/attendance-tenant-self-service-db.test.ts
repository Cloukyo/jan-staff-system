// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  MEMBERSHIP_MULTI_A, ORG_A, ORG_B, SITE_A1, SITE_A2, SITE_B1,
  STAFF_A, STAFF_A2, STAFF_B, USER_MULTI, createAttendanceTenancyDatabase,
  resetTenantDatabaseRole, seedCommercialEvent, setTenantAuthUser,
} from "./helpers/attendance-tenancy-db";

describe("commercial attendance self-service isolation", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createAttendanceTenancyDatabase();
    await seedCommercialEvent(db, { organisationId: ORG_A, siteId: SITE_A1, staffId: STAFF_A, type: "clock_in", timestamp: "2026-08-05T08:00:00+01:00" });
    await seedCommercialEvent(db, { organisationId: ORG_A, siteId: SITE_A2, staffId: STAFF_A2, type: "clock_in", timestamp: "2026-08-05T09:00:00+01:00" });
    await seedCommercialEvent(db, { organisationId: ORG_B, siteId: SITE_B1, staffId: STAFF_B, type: "clock_in", timestamp: "2026-08-05T10:00:00+01:00" });
  }, 30_000);
  afterAll(async () => db.close());

  it("uses the selected organisation membership and linked staff only", async () => {
    await setTenantAuthUser(db, USER_MULTI);
    const a = await db.query<{ id: string }>(
      "select id::text from public.get_commercial_own_attendance_records($1::uuid,$2::uuid,'2026-08-05','2026-08-05')",
      [ORG_A, SITE_A2],
    );
    const b = await db.query<{ id: string }>(
      "select id::text from public.get_commercial_own_attendance_records($1::uuid,$2::uuid,'2026-08-05','2026-08-05')",
      [ORG_B, SITE_B1],
    );
    expect(a.rows).toHaveLength(1);
    expect(b.rows).toHaveLength(1);
  });

  it("does not disclose a guessed event belonging to another staff profile", async () => {
    await setTenantAuthUser(db, USER_MULTI);
    const guessed = await db.query<{ count: number }>(
      "select count(*)::integer count from public.clock_events where organisation_id=$1::uuid and site_id=$2::uuid and staff_id=$3",
      [ORG_A, SITE_A1, STAFF_A],
    );
    expect(guessed.rows[0].count).toBe(0);
  });

  it("loses access immediately when the selected membership is revoked", async () => {
    await resetTenantDatabaseRole(db);
    await db.query("update public.organisation_memberships set status='revoked',revoked_at=now() where id=$1::uuid", [MEMBERSHIP_MULTI_A]);
    await setTenantAuthUser(db, USER_MULTI);
    await expect(db.query(
      "select * from public.get_commercial_own_attendance_records($1::uuid,$2::uuid,'2026-08-05','2026-08-05')",
      [ORG_A, SITE_A2],
    )).rejects.toThrow(/linked|authorised/i);
  });
});
