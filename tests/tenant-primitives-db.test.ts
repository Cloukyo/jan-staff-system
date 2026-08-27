import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_STAFF,
  MEMBERSHIP_A_OWNER,
  MEMBERSHIP_MULTI_A,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  USER_B_OWNER,
  USER_MULTI,
  createTenantPrimitivesDatabase,
  organisationIds,
  privateBoolean,
  resetTenantDatabaseRole,
  setTenantAuthUser,
  siteIds,
} from "./helpers/tenant-primitives-db";

describe("tenant primitives database", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createTenantPrimitivesDatabase();
  }, 30_000);

  afterEach(async () => {
    await db.close();
  });

  it("keeps inherited staff rows unchanged and unowned", async () => {
    const result = await db.query<{ organisation_id: string | null }>(
      "select organisation_id from public.staff_profiles where id = $1",
      [LEGACY_STAFF],
    );
    expect(result.rows).toEqual([{ organisation_id: null }]);
  });

  it("limits organisation and site reads to active memberships", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    expect(await organisationIds(db)).toEqual([ORG_A]);
    expect(await siteIds(db)).toEqual([SITE_A1, SITE_A2]);

    await setTenantAuthUser(db, USER_B_OWNER);
    expect(await organisationIds(db)).toEqual([ORG_B]);
    expect(await siteIds(db)).toEqual([SITE_B1]);
  });

  it("supports one auth identity with memberships in multiple organisations", async () => {
    await setTenantAuthUser(db, USER_MULTI);
    expect(await organisationIds(db)).toEqual([ORG_A, ORG_B]);
  });

  it("resolves current membership and denies revoked memberships immediately", async () => {
    await setTenantAuthUser(db, USER_MULTI);
    const current = await db.query<{ id: string | null }>(
      "select private.current_membership_id($1) as id",
      [ORG_A],
    );
    expect(current.rows[0].id).toBe(MEMBERSHIP_MULTI_A);
    expect(await privateBoolean(db, "is_active_member", [ORG_A])).toBe(true);

    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.organisation_memberships set status = 'revoked', revoked_at = now() where id = $1",
      [MEMBERSHIP_MULTI_A],
    );
    await setTenantAuthUser(db, USER_MULTI);
    expect(await privateBoolean(db, "is_active_member", [ORG_A])).toBe(false);
    expect(await organisationIds(db)).toEqual([ORG_B]);
  });

  it("gives owners organisation-wide and cross-site permissions", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    expect(await privateBoolean(db, "has_permission", [ORG_A, "membership.manage"])).toBe(true);
    expect(await privateBoolean(db, "has_site_permission", [ORG_A, SITE_A1, "rota.manage"])).toBe(true);
    expect(await privateBoolean(db, "has_site_permission", [ORG_A, SITE_A2, "rota.manage"])).toBe(true);
    expect(await privateBoolean(db, "has_permission", [ORG_B, "membership.manage"])).toBe(false);
  });

  it("restricts site managers to a role assignment plus site access", async () => {
    await setTenantAuthUser(db, USER_A_SITE_MANAGER);
    expect(await privateBoolean(db, "has_site_permission", [ORG_A, SITE_A1, "rota.manage"])).toBe(true);
    expect(await privateBoolean(db, "has_site_permission", [ORG_A, SITE_A2, "rota.manage"])).toBe(false);
    expect(await privateBoolean(db, "has_permission", [ORG_A, "membership.manage"])).toBe(false);
  });

  it("rejects cross-organisation composite references even for privileged SQL", async () => {
    await expect(db.query(
      `insert into public.staff_site_assignments
        (organisation_id, staff_id, site_id, effective_from)
       values ($1, $2, $3, '2026-08-05')`,
      [ORG_A, STAFF_A, SITE_B1],
    )).rejects.toThrow();
    await expect(db.query(
      `insert into public.membership_site_access
        (organisation_id, membership_id, site_id)
       values ($1, $2, $3)`,
      [ORG_B, MEMBERSHIP_A_OWNER, SITE_B1],
    )).rejects.toThrow();
  });

  it("rejects orphan staff and site references", async () => {
    await expect(db.query(
      `insert into public.staff_site_assignments
        (organisation_id, staff_id, site_id, effective_from)
       values ($1, 'missing-staff', $2, '2026-08-05')`,
      [ORG_A, SITE_A1],
    )).rejects.toThrow();
    await expect(db.query(
      `insert into public.site_settings (organisation_id, site_id)
       values ($1, '99999999-9999-9999-9999-999999999999')`,
      [ORG_A],
    )).rejects.toThrow();
  });

  it("blocks cross-organisation reads and joins on every tenant table", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    const tables = [
      "organisation_sites",
      "organisation_memberships",
      "membership_role_assignments",
      "membership_site_access",
      "staff_site_assignments",
      "organisation_settings",
      "site_settings",
      "organisation_invitations",
      "organisation_invitation_roles",
      "organisation_invitation_site_access",
    ];
    for (const table of tables) {
      const result = await db.query<{ organisation_id: string }>(
        `select distinct organisation_id from public.${table} order by organisation_id`,
      );
      expect(result.rows.map((row) => row.organisation_id), table).toEqual([ORG_A]);
    }
    const joined = await db.query<{ organisation_id: string; site_organisation_id: string }>(`
      select assignment.organisation_id, site.organisation_id as site_organisation_id
      from public.staff_site_assignments assignment
      join public.organisation_sites site
        on site.organisation_id = assignment.organisation_id
       and site.id = assignment.site_id
    `);
    expect(joined.rows).toEqual([{ organisation_id: ORG_A, site_organisation_id: ORG_A }]);
  });

  it("blocks cross-organisation writes through RLS", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    await expect(db.query(
      "insert into public.organisation_sites (organisation_id, name, slug) values ($1, 'Forbidden', 'forbidden')",
      [ORG_B],
    )).rejects.toThrow();
    const updated = await db.query(
      "update public.organisation_sites set name = 'Forbidden update' where id = $1 returning id",
      [SITE_B1],
    );
    expect(updated.rows).toEqual([]);
  });

  it("prevents overlapping primary assignments but permits multiple secondary sites", async () => {
    await expect(db.query(
      `insert into public.staff_site_assignments
        (organisation_id, staff_id, site_id, effective_from, is_primary)
       values ($1, $2, $3, '2026-08-02', true)`,
      [ORG_A, STAFF_A, SITE_A2],
    )).rejects.toThrow("primary site assignment overlaps");
    await expect(db.query(
      `insert into public.staff_site_assignments
        (organisation_id, staff_id, site_id, effective_from, is_primary)
       values ($1, $2, $3, '2026-08-02', false)`,
      [ORG_A, STAFF_A, SITE_A2],
    )).resolves.toBeDefined();
  });

  it("protects the final active organisation owner", async () => {
    await expect(db.query(
      "update public.organisation_memberships set status = 'suspended', suspended_at = now() where id = $1",
      [MEMBERSHIP_A_OWNER],
    )).rejects.toThrow("last active organisation owner");

    await expect(db.query(
      `update public.membership_role_assignments
       set revoked_at = now()
       where organisation_id = $1 and membership_id = $2 and role = 'organisation_owner'`,
      [ORG_A, MEMBERSHIP_A_OWNER],
    )).rejects.toThrow("last active organisation owner");
  });
});
