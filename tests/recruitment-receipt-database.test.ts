// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTenantPrimitivesDatabase, ORG_A, ORG_B, STAFF_A, USER_A_OWNER, USER_MULTI } from "./helpers/tenant-primitives-db";
import { deriveRecruitmentReadiness } from "@/lib/compliance/recruitment-readiness";

let db: PGlite;
const directory = resolve("supabase/migrations");
const migration = readFileSync(resolve(directory, readdirSync(directory).find((file) => file.endsWith("_recruitment_receipt_date_guard.sql"))!), "utf8");

async function confirm(received = "2020-09-20", version = "(select updated_at from staff_central_records where staff_id='" + STAFF_A + "')") {
  return db.query("select public.confirm_staff_dbs_receipt($1,$2," + version + ",$3,'Fictional receipt register reviewed')", [ORG_A, STAFF_A, received]);
}
async function eligible(date: string) {
  return (await db.query<{ allowed: boolean }>("select private.staff_may_begin_work($1,$2,$3::date) allowed", [ORG_A, STAFF_A, date])).rows[0].allowed;
}

beforeAll(async () => {
  db = await createTenantPrimitivesDatabase();
  await db.exec(`
    alter table staff_profiles add column engagement_type text default 'employee', add column appointment_date date;
    create table staff_central_records(
      id uuid primary key default gen_random_uuid(),organisation_id uuid,staff_id text unique,updated_at timestamptz default clock_timestamp(),
      dbs_requirement text default 'required',dbs_check_level text default 'enhanced_childrens_barred_list',
      dbs_status text default 'verified',dbs_application_date date,dbs_certificate_received_date date,
      dbs_reference_encrypted text,dbs_number_last4 text,dbs_issue_date date,dbs_last_checked_at date,
      dbs_verified_at timestamptz,dbs_recorded boolean default true,volunteer_exception text,
      suitability_status text default 'suitable',suitability_decided_at timestamptz,start_authorised_at timestamptz);
    alter table staff_central_records enable row level security;
    grant select on staff_central_records to authenticated;
    create policy test_central_read on staff_central_records for select to authenticated using(private.has_permission(organisation_id,'compliance.manage'));
    create table rota_shifts(organisation_id uuid,staff_id text,shift_date date,status text default 'scheduled',archived_at timestamptz);
    create table staff_kiosk_settings(staff_id text,kiosk_enabled boolean);
    create table clock_events(organisation_id uuid,staff_id text,event_type text,event_timestamp timestamptz,event_source text default 'kiosk',manager_correction boolean default false);
  `);
  const baseline = readFileSync(resolve(directory, "20260904031657_nursery_staff_competitive_readiness.sql"), "utf8");
  await db.exec(baseline.slice(baseline.indexOf("create table public.staff_suitability_events"), baseline.indexOf("create table public.record_retention_holds")));
  await db.exec(readFileSync(resolve(directory, "20260904041235_competitive_readiness_private_execute_hardening.sql"), "utf8")
    .replace("revoke all on function private.set_statutory_retention_until() from public,anon,authenticated;", "")
    .replace("drop view public.staff_recruitment_readiness;", ""));
  await db.exec(migration);
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("begin; select set_config('request.jwt.claim.sub','" + USER_A_OWNER + "',true);");
  await db.exec(`
    update staff_profiles set appointment_date='2010-01-01' where id='${STAFF_A}';
    insert into staff_central_records(organisation_id,staff_id,dbs_certificate_received_date,dbs_reference_encrypted,
      dbs_verified_at,suitability_decided_at,start_authorised_at,dbs_issue_date)
    values('${ORG_A}','${STAFF_A}','2020-09-20','v1:fictional:encrypted:evidence',
      '2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01');
  `);
});
afterEach(async () => { await db.exec("rollback"); });

describe("receipt date migration: executable PostgreSQL", () => {
  it("keeps populated legacy/inferred receipt timing unconfirmed until the manager resolves it", async () => {
    await db.exec("update staff_central_records set dbs_status='legacy_recorded',dbs_reference_encrypted=null,dbs_verified_at=null");
    expect(await eligible("2020-09-21")).toBe(false);
    await confirm();
    expect(await eligible("2020-09-21")).toBe(true);
    const receipt = (await db.query<{ previous_received_on: string; evidence_note: string }>("select previous_received_on::text,evidence_note from staff_dbs_receipt_confirmations")).rows[0];
    expect(receipt.previous_received_on).toBe("2020-09-20");
    expect(receipt.evidence_note).toBe("Fictional receipt register reviewed");
    expect((await db.query("select dbs_reference_encrypted from staff_central_records")).rows[0]).toEqual({ dbs_reference_encrypted: null });
  });

  for (const engagement of ["employee", "volunteer"]) {
    it.each([["2020-09-19", false], ["2020-09-20", true], ["2020-09-21", true]] as const)(engagement + " receipt: %s", async (date, expected) => {
      await db.query("update staff_profiles set engagement_type=$1 where id=$2", [engagement, STAFF_A]);
      await confirm();
      expect(await eligible(date)).toBe(expected);
    });
    it.each([["2020-09-19", false], ["2020-09-20", true], ["2020-09-21", true]] as const)(engagement + " authorisation: %s", async (date, expected) => {
      await db.query("update staff_profiles set engagement_type=$1 where id=$2", [engagement, STAFF_A]);
      await confirm("2020-01-01");
      await db.exec("update staff_central_records set start_authorised_at='2020-09-20T18:00:00+01:00'");
      expect(await eligible(date)).toBe(expected);
    });
  }

  it("records confirmation of an unchanged date, and audits a corrected historical date", async () => {
    await confirm();
    await confirm("2020-09-19");
    expect((await db.query<{ n: number }>("select count(*)::int n from staff_dbs_receipt_confirmations")).rows[0].n).toBe(2);
    expect((await db.query("select previous_state->>'dbsCertificateReceivedDate' before,new_state->>'dbsCertificateReceivedDate' after from staff_suitability_events order by recorded_at desc,id desc")).rows)
      .toContainEqual({ before: "2020-09-20", after: "2020-09-19" });
  });

  it("invalidates confirmation when the check evidence or receipt date changes", async () => {
    await confirm();
    await db.exec("update staff_central_records set dbs_certificate_received_date='2020-09-19'");
    expect(await eligible("2020-09-21")).toBe(false);
    await confirm("2020-09-19");
    expect(await eligible("2020-09-21")).toBe(true);
    await db.exec("update staff_central_records set dbs_reference_encrypted='v1:different:check:reference'");
    expect(await eligible("2020-09-21")).toBe(false);
  });

  it("rejects stale confirmation without writing receipt or suitability audit", async () => {
    const counts = async () => (await db.query("select (select count(*) from staff_dbs_receipt_confirmations) receipts,(select count(*) from staff_suitability_events) events")).rows;
    const before = await counts();
    await db.exec("savepoint failure");
    await expect(confirm("2020-09-20", "'2000-01-01'::timestamptz")).rejects.toThrow("dbs_receipt_record_changed");
    await db.exec("rollback to failure");
    expect(await counts()).toEqual(before);
  });

  it("rejects future-date confirmation rather than attesting evidence not yet received", async () => {
    await db.exec("savepoint failure");
    await expect(confirm("2999-01-01")).rejects.toThrow("dbs_receipt_confirmation_invalid");
    await db.exec("rollback to failure");
    expect((await db.query("select * from staff_dbs_receipt_confirmations")).rows).toHaveLength(0);
  });

  it("does not grant staff, other tenants, anon, or API callers authority to forge confirmation", async () => {
    await confirm();
    await db.exec("set local role authenticated");
    expect((await db.query("select * from staff_dbs_receipt_confirmations")).rows).toHaveLength(1);
    await db.exec("savepoint denied");
    await expect(db.exec("delete from staff_dbs_receipt_confirmations")).rejects.toThrow(/permission denied/);
    await db.exec("rollback to denied");
    await expect(db.query("select private.staff_may_begin_work($1,$2,current_date)", [ORG_A, STAFF_A])).rejects.toThrow(/permission denied/);
    await db.exec("rollback to denied");
    await db.exec("select set_config('request.jwt.claim.sub','" + USER_MULTI + "',true)");
    expect((await db.query("select * from staff_dbs_receipt_confirmations")).rows).toHaveLength(0);
    await expect(confirm()).rejects.toThrow("dbs_receipt_confirmation_forbidden");
    await db.exec("rollback to denied");
    await expect(db.query("select confirm_staff_dbs_receipt($1,$2,now(),'2020-01-01','Fictional evidence')", [ORG_B, STAFF_A])).rejects.toThrow("dbs_receipt_confirmation_forbidden");
    await db.exec("rollback to denied; set local role anon; savepoint anon_denied");
    await expect(confirm()).rejects.toThrow(/permission denied/);
    await db.exec("rollback to anon_denied; reset role");
  });

  it("preserves only the explicit volunteer exception and still dates start authorisation", async () => {
    await db.exec("update staff_central_records set dbs_requirement='not_required',dbs_status='not_required',volunteer_exception='occasional_supervised',dbs_certificate_received_date=null");
    expect(await eligible("2020-09-21")).toBe(false);
    await db.query("update staff_profiles set engagement_type='volunteer' where id=$1", [STAFF_A]);
    expect(await eligible("2020-09-21")).toBe(true);
    await db.exec("update staff_central_records set start_authorised_at='2020-09-22'");
    expect(await eligible("2020-09-21")).toBe(false);
  });

  it("enforces rota inserts and kiosk enabling, allowing only eligible work dates", async () => {
    await db.exec("savepoint blocked");
    await expect(db.query("insert into rota_shifts(organisation_id,staff_id,shift_date) values($1,$2,'2020-09-21')", [ORG_A, STAFF_A])).rejects.toThrow("staff_not_authorised_to_begin_work");
    await db.exec("rollback to blocked");
    await expect(db.query("insert into staff_kiosk_settings values($1,true)", [STAFF_A])).rejects.toThrow("staff_not_authorised_to_begin_work");
    await db.exec("rollback to blocked");
    await confirm();
    await db.query("insert into rota_shifts(organisation_id,staff_id,shift_date) values($1,$2,'2020-09-20')", [ORG_A, STAFF_A]);
    await db.query("insert into staff_kiosk_settings values($1,true)", [STAFF_A]);
    await db.exec("savepoint before_receipt");
    await expect(db.exec("update rota_shifts set shift_date='2020-09-19'")).rejects.toThrow("staff_not_authorised_to_begin_work");
    await db.exec("rollback to before_receipt");
  });

  it("guards new kiosk clock-ins even for an already enabled person, but preserves clock-outs and correction evidence", async () => {
    await db.exec("savepoint blocked");
    await expect(db.query("insert into clock_events(organisation_id,staff_id,event_type,event_timestamp) values($1,$2,'clock_in','2020-09-21')", [ORG_A, STAFF_A])).rejects.toThrow("staff_not_authorised_to_begin_work");
    await db.exec("rollback to blocked");
    await db.query("insert into clock_events(organisation_id,staff_id,event_type,event_timestamp) values($1,$2,'clock_out','2020-09-21')", [ORG_A, STAFF_A]);
    await db.query("insert into clock_events(organisation_id,staff_id,event_type,event_timestamp,event_source,manager_correction) values($1,$2,'clock_in','2020-09-21','manager',true)", [ORG_A, STAFF_A]);
    await confirm();
    await db.query("insert into clock_events(organisation_id,staff_id,event_type,event_timestamp) values($1,$2,'clock_in','2020-09-19T23:00:00Z')", [ORG_A, STAFF_A]);
    expect((await db.query("select * from clock_events")).rows).toHaveLength(3);
  });

  it.each([["2020-09-19T23:00:00Z", "2020-09-19", false], ["2020-09-19T23:00:00Z", "2020-09-20", true],
    ["2020-03-29T23:00:00Z", "2020-03-29", false], ["2020-10-25T23:00:00Z", "2020-10-25", true]] as const)
  ("uses London dates with UTC sessions: %s", async (timestamp, date, expected) => {
    await confirm("2020-01-01");
    await db.exec("set local timezone='UTC'");
    await db.query("update staff_central_records set start_authorised_at=$1", [timestamp]);
    expect(await eligible(date)).toBe(expected);
  });

  it.each(["verified", "legacy_recorded", "not_started"])("view, helper and application agree for %s", async (status) => {
    await db.query("update staff_central_records set dbs_status=$1", [status]);
    if (status !== "not_started") await confirm();
    const view = (await db.query<{ may_begin_work: boolean; dbs_receipt_confirmed: boolean }>("select * from staff_recruitment_readiness where staff_id=$1", [STAFF_A])).rows[0];
    const day = (await db.query<{ work_date: string }>("select (statement_timestamp() at time zone 'Europe/London')::date::text as work_date")).rows[0].work_date;
    const app = deriveRecruitmentReadiness({
      active: true, engagementType: "employee", proposedStartDate: "2010-01-01", dbsRequirement: "required",
      dbsCheckLevel: "enhanced_childrens_barred_list", dbsStatus: status as "verified" | "legacy_recorded" | "not_started",
      dbsCertificateReceivedDate: "2020-09-20", dbsReceiptConfirmed: view.dbs_receipt_confirmed, dbsRecorded: true,
      dbsVerifiedAt: "2020-01-01T00:00:00Z", hasFullDbsReference: true, suitabilityStatus: "suitable",
      suitabilityDecidedAt: "2020-01-01T00:00:00Z", startAuthorisedAt: "2020-01-01T00:00:00Z", volunteerException: null,
    }, day);
    expect(view.may_begin_work).toBe(await eligible(day));
    expect(app.mayStartWork).toBe(view.may_begin_work);
  });
});
