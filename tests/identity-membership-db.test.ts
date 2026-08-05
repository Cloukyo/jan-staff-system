import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMBERSHIP_A_ADMIN,
  MEMBERSHIP_A_SITE_MANAGER,
  MEMBERSHIP_MULTI_A,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  STAFF_A,
  USER_A_ADMIN,
  USER_A_OWNER,
  USER_MULTI,
  createIdentityMembershipDatabase,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";

describe("commercial identity membership database", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createIdentityMembershipDatabase();
  }, 30_000);

  afterEach(async () => {
    await db?.close();
  });

  it("returns only the authenticated user's memberships with current revisions", async () => {
    await setTenantAuthUser(db, USER_MULTI);
    const result = await db.query<{ snapshot: Array<{ organisationId: string; status: string; authorisationRevision: number }> }>(
      "select public.current_commercial_identity_snapshot() as snapshot",
    );
    expect(result.rows[0].snapshot.map((item) => [item.organisationId, item.status, Number(item.authorisationRevision)])).toEqual([
      [ORG_A, "active", 2],
      [ORG_B, "active", 2],
    ]);
  });

  it("increments authorisation revision when active roles or site access change", async () => {
    const before = await db.query<{ authorisation_revision: number }>(
      "select authorisation_revision from public.organisation_memberships where id = $1",
      [MEMBERSHIP_A_SITE_MANAGER],
    );
    await db.query(
      "update public.membership_role_assignments set revoked_at = now() where organisation_id = $1 and membership_id = $2",
      [ORG_A, MEMBERSHIP_A_SITE_MANAGER],
    );
    const afterRole = await db.query<{ authorisation_revision: number }>(
      "select authorisation_revision from public.organisation_memberships where id = $1",
      [MEMBERSHIP_A_SITE_MANAGER],
    );
    expect(Number(afterRole.rows[0].authorisation_revision)).toBe(Number(before.rows[0].authorisation_revision) + 1);

    await db.query(
      "update public.membership_site_access set revoked_at = now() where organisation_id = $1 and membership_id = $2 and site_id = $3",
      [ORG_A, MEMBERSHIP_A_SITE_MANAGER, SITE_A1],
    );
    const afterAccess = await db.query<{ authorisation_revision: number }>(
      "select authorisation_revision from public.organisation_memberships where id = $1",
      [MEMBERSHIP_A_SITE_MANAGER],
    );
    expect(Number(afterAccess.rows[0].authorisation_revision)).toBe(Number(before.rows[0].authorisation_revision) + 2);
  });

  it("records membership suspension and preserves the linked staff profile", async () => {
    await db.query(
      "update public.organisation_memberships set status = 'suspended', suspended_at = now() where id = $1",
      [MEMBERSHIP_A_SITE_MANAGER],
    );
    const events = await db.query<{ from_status: string; to_status: string }>(
      "select from_status, to_status from public.membership_status_events where membership_id = $1",
      [MEMBERSHIP_A_SITE_MANAGER],
    );
    expect(events.rows).toEqual([{ from_status: "active", to_status: "suspended" }]);
    const staff = await db.query<{ id: string }>("select id from public.staff_profiles where id = $1", [STAFF_A]);
    expect(staff.rows).toEqual([{ id: STAFF_A }]);
  });

  it("does not treat suspended or revoked memberships as active contexts", async () => {
    await db.query("update public.organisation_memberships set status = 'suspended', suspended_at = now() where id = $1", [MEMBERSHIP_MULTI_A]);
    await setTenantAuthUser(db, USER_MULTI);
    const result = await db.query<{ snapshot: Array<{ organisationId: string; status: string; active: boolean }> }>(
      "select public.current_commercial_identity_snapshot() as snapshot",
    );
    expect(result.rows[0].snapshot).toEqual(expect.arrayContaining([
      expect.objectContaining({ organisationId: ORG_A, status: "suspended", active: false }),
      expect.objectContaining({ organisationId: ORG_B, status: "active", active: true }),
    ]));
  });

  it("denies direct membership activation, site-access insertion and role escalation", async () => {
    await setTenantAuthUser(db, USER_A_ADMIN, "aal2");
    await expect(db.query("update public.organisation_memberships set status = 'active' where id = $1", [MEMBERSHIP_A_ADMIN])).rejects.toThrow();
    await expect(db.query(
      "insert into public.membership_site_access (organisation_id, membership_id, site_id) values ($1, $2, $3)",
      [ORG_A, MEMBERSHIP_A_ADMIN, SITE_A2],
    )).rejects.toThrow();
    await expect(db.query(
      "insert into public.membership_role_assignments (organisation_id, membership_id, role, scope_type) values ($1, $2, 'organisation_owner', 'organisation')",
      [ORG_A, MEMBERSHIP_A_ADMIN],
    )).rejects.toThrow();
  });

  it("keeps private snapshot output scoped when an organisation ID is guessed", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    const result = await db.query<{ snapshot: Array<{ organisationId: string }> }>(
      "select public.current_commercial_identity_snapshot() as snapshot",
    );
    expect(result.rows[0].snapshot.map((item) => item.organisationId)).toEqual([ORG_A]);
  });

  it("still rejects cross-organisation staff linkage", async () => {
    await resetTenantDatabaseRole(db);
    await expect(db.query(
      "update public.organisation_memberships set staff_id = $1 where organisation_id = $2 and id = $3",
      [STAFF_A, ORG_B, "bb000000-0000-0000-0000-000000000004"],
    )).rejects.toThrow();
  });

  it("supports different same-tenant staff links for one Auth user across organisations", async () => {
    await db.query("update public.organisation_memberships set staff_id = $1 where id = $2", [STAFF_A, MEMBERSHIP_MULTI_A]);
    await db.query("update public.organisation_memberships set staff_id = 'tenant-staff-b' where id = 'bb000000-0000-0000-0000-000000000004'");
    await setTenantAuthUser(db, USER_MULTI);
    const result = await db.query<{ snapshot: Array<{ organisationId: string; staffId: string }> }>(
      "select public.current_commercial_identity_snapshot() as snapshot",
    );
    expect(result.rows[0].snapshot.map((item) => [item.organisationId, item.staffId])).toEqual([
      [ORG_A, STAFF_A], [ORG_B, "tenant-staff-b"],
    ]);
  });

  it("lets staff inspect only their own role assignments", async () => {
    await setTenantAuthUser(db, USER_MULTI);
    const result = await db.query<{ membership_id: string }>(
      "select membership_id from public.membership_role_assignments order by membership_id",
    );
    expect(result.rows.map((row) => row.membership_id)).toEqual([
      MEMBERSHIP_MULTI_A, "bb000000-0000-0000-0000-000000000004",
    ]);
  });

  it("keeps HR, payroll and scheduler permission boundaries distinct", async () => {
    await resetTenantDatabaseRole(db);
    const result = await db.query<{ role: string; permission: string }>(
      "select role::text, permission from private.role_permissions where role in ('hr_admin', 'payroll_admin', 'scheduler')",
    );
    const keys = new Set(result.rows.map((row) => `${row.role}:${row.permission}`));
    expect(keys.has("hr_admin:compliance.manage")).toBe(true);
    expect(keys.has("hr_admin:payroll.export")).toBe(false);
    expect(keys.has("payroll_admin:payroll.export")).toBe(true);
    expect(keys.has("payroll_admin:compliance.manage")).toBe(false);
    expect(keys.has("scheduler:rota.manage")).toBe(true);
    expect(keys.has("scheduler:attendance.correct")).toBe(false);
  });

  it("exposes only the narrow authenticated RPC surface", async () => {
    await resetTenantDatabaseRole(db);
    const privileges = await db.query<{ anon_snapshot: boolean; authenticated_snapshot: boolean; direct_role_write: boolean }>(`
      select
        has_function_privilege('anon', 'public.current_commercial_identity_snapshot()', 'execute') as anon_snapshot,
        has_function_privilege('authenticated', 'public.current_commercial_identity_snapshot()', 'execute') as authenticated_snapshot,
        has_table_privilege('authenticated', 'public.membership_role_assignments', 'insert') as direct_role_write
    `);
    expect(privileges.rows).toEqual([{ anon_snapshot: false, authenticated_snapshot: true, direct_role_write: false }]);
  });
});
