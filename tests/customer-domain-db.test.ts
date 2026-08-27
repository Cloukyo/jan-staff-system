import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createCustomerDomainDatabase,
  setLegacyManager,
} from "./helpers/customer-domain-db";
import {
  ORG_A,
  ORG_B,
  MEMBERSHIP_A_OWNER,
  MEMBERSHIP_B_OWNER,
  MEMBERSHIP_MULTI_A,
  MEMBERSHIP_MULTI_B,
  SITE_A1,
  SITE_A2,
  STAFF_A,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  USER_B_OWNER,
  USER_MULTI,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";

describe("customer domain database conversion", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createCustomerDomainDatabase();
  });

  afterEach(async () => {
    await db?.close();
  });

  it("derives commercial staff-record ownership and rejects a cross-organisation identifier", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    await expect(db.query(
      `insert into public.staff_qualifications (organisation_id, staff_id, qualification_name)
       values ($1, $2, 'Wrong owner')`,
      [ORG_B, STAFF_A],
    )).rejects.toThrow(/organisation/i);

    await db.query(
      `insert into public.staff_qualifications (staff_id, qualification_name)
       values ($1, 'Derived owner')`,
      [STAFF_A],
    );
    const result = await db.query<{ organisation_id: string }>(
      "select organisation_id from public.staff_qualifications where qualification_name = 'Derived owner'",
    );
    expect(result.rows).toEqual([{ organisation_id: ORG_A }]);
  });

  it("prevents an actor authorised in two organisations from re-parenting customer evidence", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(
      `insert into public.membership_role_assignments
        (organisation_id, membership_id, role, scope_type, granted_by_membership_id) values
        ($1, $2, 'organisation_admin', 'organisation', $3),
        ($4, $5, 'organisation_admin', 'organisation', $6)`,
      [ORG_A, MEMBERSHIP_MULTI_A, MEMBERSHIP_A_OWNER, ORG_B, MEMBERSHIP_MULTI_B, MEMBERSHIP_B_OWNER],
    );
    const qualification = await db.query<{ id: string }>(
      "select id from public.staff_qualifications where qualification_name = 'Organisation A qualification'",
    );
    await setTenantAuthUser(db, USER_MULTI, "aal2");
    await expect(db.query(
      "update public.staff_qualifications set organisation_id = $1, staff_id = $2 where id = $3",
      [ORG_B, "tenant-staff-b", qualification.rows[0].id],
    )).rejects.toThrow(/immutable|ownership|re-parent/i);
  });

  it("denies direct commercial staff inserts so every new profile has an initial assignment", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(db.query(
      `insert into public.staff_profiles (id, organisation_id, full_name, display_name, employment_role)
       values ('orphan-staff', $1, 'Orphan Staff', 'Orphan', 'Tutor')`,
      [ORG_A],
    )).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("isolates organisation-owned staff and compliance records", async () => {
    await setTenantAuthUser(db, USER_A_OWNER);
    expect((await db.query<{ qualification_name: string }>(
      "select qualification_name from public.staff_qualifications order by qualification_name",
    )).rows).toEqual([{ qualification_name: "Organisation A qualification" }]);
    expect((await db.query<{ module_id: string }>(
      "select module_id from public.organisation_compliance_modules order by module_id",
    )).rows).toEqual([{ module_id: "early_years_uk" }]);

    await setTenantAuthUser(db, USER_B_OWNER);
    expect((await db.query<{ qualification_name: string }>(
      "select qualification_name from public.staff_qualifications order by qualification_name",
    )).rows).toEqual([{ qualification_name: "Organisation B qualification" }]);
  });

  it("limits a site manager to work areas at an authorised site", async () => {
    await setTenantAuthUser(db, USER_A_SITE_MANAGER);
    expect((await db.query<{ name: string }>("select name from public.work_areas order by name")).rows).toEqual([{ name: "Blue" }]);
    await expect(db.query(
      "insert into public.work_areas (organisation_id, site_id, name, code) values ($1, $2, 'Denied', 'denied')",
      [ORG_A, SITE_A2],
    )).rejects.toThrow();
  });

  it("resolves site overrides without modifying organisation defaults", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(
      `update public.organisation_settings set operating_defaults = '{"openingTime":"07:30","closingTime":"18:30"}' where organisation_id = $1`,
      [ORG_A],
    );
    await db.query(
      `update public.site_settings set operating_overrides = '{"closingTime":"20:00"}' where organisation_id = $1 and site_id = $2`,
      [ORG_A, SITE_A1],
    );
    const result = await db.query<{ opening_time: string; closing_time: string }>(
      "select opening_time, closing_time from public.effective_site_operating_settings($1, $2)",
      [ORG_A, SITE_A1],
    );
    expect(result.rows).toEqual([{ opening_time: "07:30", closing_time: "20:00" }]);
  });

  it("commits a validated staff import atomically with its initial site assignment", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const preview = await db.query<{ batch_id: string }>(
      `select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id`,
      [ORG_A, SITE_A1, "batch-001", JSON.stringify([{
        sourceRow: "2", externalKey: "EMP-009", fullName: "Fictional Worker",
        displayName: "Fictional", employmentRole: "Tutor", siteId: SITE_A1,
        email: "FICTIONAL.WORKER@EXAMPLE.TEST", effectiveFrom: "2026-09-01", primarySite: true,
      }])],
    );
    await db.query("select public.commit_staff_import_batch($1)", [preview.rows[0].batch_id]);
    const staff = await db.query<{ organisation_id: string; site_id: string; email: string }>(
      `select profile.organisation_id, assignment.site_id, profile.email
       from public.staff_profiles profile
       join public.staff_site_assignments assignment
         on assignment.organisation_id = profile.organisation_id and assignment.staff_id = profile.id
       where profile.full_name = 'Fictional Worker'`,
    );
    expect(staff.rows).toEqual([{
      organisation_id: ORG_A,
      site_id: SITE_A1,
      email: "fictional.worker@example.test",
    }]);
  });

  it("does not allow an idempotent import key to be replayed against another site", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const rows = JSON.stringify([{
      sourceRow: "2", externalKey: "EMP-010", fullName: "Fictional Import",
      employmentRole: "Tutor", siteId: SITE_A1, effectiveFrom: "2026-09-01",
    }]);
    await db.query("select public.preview_staff_import_batch($1, $2, $3, $4::jsonb)", [ORG_A, SITE_A1, "fixed-key", rows]);
    await expect(db.query(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb)",
      [ORG_A, SITE_A2, "fixed-key", rows],
    )).rejects.toThrow(/site/i);
  });

  it("binds an import idempotency key to the original canonical payload", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const original = JSON.stringify([{
      sourceRow: "2", externalKey: "EMP-012", fullName: "Original Import",
      employmentRole: "Tutor", siteId: SITE_A1, effectiveFrom: "2026-09-01",
    }]);
    const first = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "payload-key", original],
    );
    const retry = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "payload-key", original],
    );
    expect(retry.rows[0].batch_id).toBe(first.rows[0].batch_id);
    await expect(db.query(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb)",
      [ORG_A, SITE_A1, "payload-key", original.replace("Original Import", "Changed Import")],
    )).rejects.toThrow(/payload/i);
  });

  it("records missing dates and malformed primary-site values as row validation errors", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const preview = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "malformed-row", JSON.stringify([{
        sourceRow: "2", externalKey: "EMP-013", fullName: "Invalid Import",
        employmentRole: "Tutor", siteId: SITE_A1, primarySite: "sometimes",
      }])],
    );
    const result = await db.query<{ status: string; validation_errors: Array<{ field: string }> }>(
      `select status::text, validation_errors from public.staff_import_rows where batch_id = $1`,
      [preview.rows[0].batch_id],
    );
    expect(result.rows[0].status).toBe("invalid");
    expect(result.rows[0].validation_errors.map((error) => error.field)).toEqual(["effectiveFrom", "primarySite"]);
  });

  it("denies direct mutation of staged imports so validation and commit remain authoritative", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const preview = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "protected-batch", JSON.stringify([{
        sourceRow: "2", externalKey: "EMP-011", fullName: "Protected Import",
        employmentRole: "Tutor", siteId: SITE_A1, effectiveFrom: "2026-09-01",
      }])],
    );
    await expect(db.query(
      "update public.staff_import_batches set status = 'committed' where id = $1",
      [preview.rows[0].batch_id],
    )).rejects.toThrow(/permission denied/i);
  });

  it("rejects a row whose declared site differs from the authorised import site", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const preview = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "site-mismatch", JSON.stringify([{
        sourceRow: "2", externalKey: "EMP-014", fullName: "Wrong Site Import",
        employmentRole: "Tutor", siteId: SITE_A2, effectiveFrom: "2026-09-01",
      }])],
    );
    const result = await db.query<{ status: string; validation_errors: Array<{ field: string; code: string }> }>(
      "select status::text, validation_errors from public.staff_import_rows where batch_id = $1",
      [preview.rows[0].batch_id],
    );
    expect(result.rows[0]).toMatchObject({ status: "invalid" });
    expect(result.rows[0].validation_errors).toContainEqual({ field: "siteId", code: "site_not_permitted" });
  });

  it("rejects an already imported external key during a later preview", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const row = {
      sourceRow: "2", externalKey: "EMP-015", fullName: "Existing Commercial Worker",
      employmentRole: "Tutor", siteId: SITE_A1, effectiveFrom: "2026-09-01",
    };
    const first = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "existing-key-first", JSON.stringify([row])],
    );
    await db.query("select public.commit_staff_import_batch($1)", [first.rows[0].batch_id]);

    const second = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "existing-key-second", JSON.stringify([row])],
    );
    const result = await db.query<{ status: string; validation_errors: Array<{ field: string; code: string }> }>(
      "select status::text, validation_errors from public.staff_import_rows where batch_id = $1",
      [second.rows[0].batch_id],
    );
    expect(result.rows[0]).toMatchObject({ status: "invalid" });
    expect(result.rows[0].validation_errors).toContainEqual({ field: "externalKey", code: "duplicate_staff" });
  });

  it("rejects duplicate normalised emails within one import preview", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const preview = await db.query<{ batch_id: string }>(
      "select public.preview_staff_import_batch($1, $2, $3, $4::jsonb) as batch_id",
      [ORG_A, SITE_A1, "duplicate-email", JSON.stringify([
        {
          sourceRow: "2", externalKey: "EMP-016", fullName: "First Email Worker",
          employmentRole: "Tutor", siteId: SITE_A1, email: "shared@example.test", effectiveFrom: "2026-09-01",
        },
        {
          sourceRow: "3", externalKey: "EMP-017", fullName: "Second Email Worker",
          employmentRole: "Tutor", siteId: SITE_A1, email: " SHARED@EXAMPLE.TEST ", effectiveFrom: "2026-09-01",
        },
      ])],
    );
    const result = await db.query<{ source_row: string; status: string; validation_errors: Array<{ field: string; code: string }> }>(
      "select source_row, status::text, validation_errors from public.staff_import_rows where batch_id = $1 order by source_row",
      [preview.rows[0].batch_id],
    );
    expect(result.rows[0].status).toBe("valid");
    expect(result.rows[1].status).toBe("invalid");
    expect(result.rows[1].validation_errors).toContainEqual({ field: "email", code: "duplicate_email" });
  });

  it("installs organisation ownership on every converted inherited staff table", async () => {
    await resetTenantDatabaseRole(db);
    const result = await db.query<{ table_name: string }>(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'organisation_id'
        and table_name in (
          'staff_qualifications', 'staff_certificates', 'staff_central_records',
          'staff_central_record_items', 'staff_reference_checks', 'staff_import_reviews',
          'staff_pay_arrangements'
        ) order by table_name
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "staff_central_record_items",
      "staff_central_records",
      "staff_certificates",
      "staff_import_reviews",
      "staff_pay_arrangements",
      "staff_qualifications",
      "staff_reference_checks",
    ]);
  });

  it("creates a commercial staff profile and assignment through one authorised command", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const created = await db.query<{ staff_id: string }>(
      "select public.create_commercial_staff_profile($1, $2, $3, $4, $5, $6, $7) as staff_id",
      [ORG_A, SITE_A1, "Fictional New Starter", "Fictional", "Administrator", "2026-10-01", true],
    );
    const ownership = await db.query<{ organisation_id: string; site_id: string }>(
      `select profile.organisation_id, assignment.site_id
       from public.staff_profiles profile join public.staff_site_assignments assignment
         on assignment.organisation_id = profile.organisation_id and assignment.staff_id = profile.id
       where profile.id = $1`,
      [created.rows[0].staff_id],
    );
    expect(ownership.rows).toEqual([{ organisation_id: ORG_A, site_id: SITE_A1 }]);
  });

  it("keeps legacy Jan rows accessible only through the legacy compatibility path", async () => {
    await setLegacyManager(db);
    expect((await db.query<{ qualification_name: string }>(
      "select qualification_name from public.staff_qualifications order by qualification_name",
    )).rows).toEqual([{ qualification_name: "Legacy qualification" }]);
  });

  it("does not add ownership columns to deferred attendance, payroll-processing or kiosk tables", async () => {
    await resetTenantDatabaseRole(db);
    const touched = await db.query<{ table_name: string }>(`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'organisation_id'
        and table_name in ('clock_events', 'attendance_adjustments', 'attendance_exceptions', 'payroll_import_batches', 'kiosk_devices')
    `);
    expect(touched.rows).toEqual([]);
  });
});
