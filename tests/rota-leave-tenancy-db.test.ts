// @vitest-environment node

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A2,
  STAFF_A,
  STAFF_B,
  USER_A_OWNER,
  USER_A_STAFF,
  USER_A_SITE_MANAGER,
  WORK_AREA_A1,
  WORK_AREA_A2,
  createRotaLeaveTenancyDatabase,
  resetTenantDatabaseRole,
  setLegacyManager,
  setTenantAuthUser,
} from "./helpers/rota-leave-tenancy-db";

describe("rota and leave tenancy executable migration", () => {
  let db: PGlite;
  let weekA1: string;

  beforeAll(async () => {
    db = await createRotaLeaveTenancyDatabase();
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const result = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'create_week',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekStart: "2026-08-17", title: "Site A1" }), randomUUID()],
    );
    weekA1 = String(result.rows[0].result.weekId);
  }, 45_000);

  afterAll(async () => db.close());

  it("keeps inherited Jan rows wholly unowned", async () => {
    await resetTenantDatabaseRole(db);
    const result = await db.query<{ organisation_id: string | null; site_id: string | null }>(
      "select organisation_id::text,site_id::text from public.rota_weeks where id='40000000-0000-0000-0000-000000000001'",
    );
    expect(result.rows).toEqual([{ organisation_id: null, site_id: null }]);
  });

  it("creates a site-owned shift and replays an identical command", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const key = randomUUID();
    const payload = { weekId: weekA1, staffId: STAFF_A2, shiftDate: "2026-08-17", startTime: "09:00", endTime: "13:00", breakMinutes: 0, workAreaId: WORK_AREA_A1, workArea: "Blue" };
    const first = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify(payload), key],
    );
    const replay = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify(payload), key],
    );
    expect(first.rows[0].result.outcome).toBe("success");
    expect(replay.rows[0].result).toEqual(first.rows[0].result);
  });

  it("detects an overlap across another authorised site", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const created = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'create_week',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A2, JSON.stringify({ weekStart: "2026-08-17" }), randomUUID()],
    );
    const overlap = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A2, JSON.stringify({ weekId: created.rows[0].result.weekId, staffId: STAFF_A2, shiftDate: "2026-08-17", startTime: "11:00", endTime: "17:00", breakMinutes: 30, workAreaId: WORK_AREA_A2, workArea: "Green" }), randomUUID()],
    );
    expect(overlap.rows[0].result).toMatchObject({ outcome: "conflict", code: "cross_site_overlap" });
  });

  it("denies a site manager access to another site and another organisation", async () => {
    await setTenantAuthUser(db, USER_A_SITE_MANAGER, "aal2");
    const otherSite = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'create_week',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A2, JSON.stringify({ weekStart: "2026-08-24" }), randomUUID()],
    );
    const otherOrganisation = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'create_week',$3::jsonb,$4::uuid,null) result",
      [ORG_B, SITE_B1, JSON.stringify({ weekStart: "2026-08-24" }), randomUUID()],
    );
    expect(otherSite.rows[0].result.outcome).toBe("permission_denied");
    expect(otherOrganisation.rows[0].result.outcome).toBe("permission_denied");
  });

  it("rejects a work area from another site", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const result = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, staffId: STAFF_A2, shiftDate: "2026-08-18", startTime: "09:00", endTime: "13:00", breakMinutes: 0, workAreaId: WORK_AREA_A2 }), randomUUID()],
    );
    expect(result.rows[0].result).toMatchObject({ outcome: "conflict", code: "work_area_unavailable" });
  });

  it("rejects ambiguous dates and never allows an override to fabricate assignment history", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const ambiguous = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, staffId: STAFF_A2, shiftDate: "01/02/2026", startTime: "09:00", endTime: "13:00" }), randomUUID()],
    );
    const historicWeek = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'create_week',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekStart: "2026-07-20" }), randomUUID()],
    );
    const fabricated = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: historicWeek.rows[0].result.weekId, staffId: STAFF_A2, shiftDate: "2026-07-20", startTime: "09:00", endTime: "13:00", overrideReason: "Manager override" }), randomUUID()],
    );
    expect(ambiguous.rows[0].result).toMatchObject({ outcome: "invalid_request", code: "shift_time" });
    expect(fabricated.rows[0].result).toMatchObject({ outcome: "conflict", code: "assignment_required" });
  });

  it("returns typed failures for malformed direct RPC payloads", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const malformedShift = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, staffId: STAFF_A2, shiftDate: "2026-08-21", startTime: "09:00", endTime: "13:00", workAreaId: "not-a-uuid" }), randomUUID()],
    );
    const malformedLeave = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_leave_command($1,'create_leave',$2::jsonb,$3::uuid,null) result",
      [ORG_A, JSON.stringify({ staffId: STAFF_A2, leaveType: "invented", startDate: "2026-08-21", endDate: "2026-08-21", requestedMinutes: "many" }), randomUUID()],
    );
    const outsideWeek = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, staffId: STAFF_A2, shiftDate: "2026-08-24", startTime: "09:00", endTime: "13:00" }), randomUUID()],
    );
    const cancelled = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, staffId: STAFF_A2, shiftDate: "2026-08-22", startTime: "09:00", endTime: "13:00", breakMinutes: 0, breakUnspecified: true, status: "cancelled", workAreaId: WORK_AREA_A1 }), randomUUID()],
    );
    expect(malformedShift.rows[0].result).toMatchObject({ outcome: "invalid_request", code: "work_area" });
    expect(malformedLeave.rows[0].result).toMatchObject({ outcome: "invalid_request", code: "leave_type" });
    expect(outsideWeek.rows[0].result).toMatchObject({ outcome: "invalid_request", code: "week_date_required" });
    expect(cancelled.rows[0].result).toMatchObject({ outcome: "success", code: "shift_created" });
    await resetTenantDatabaseRole(db);
    const stored = await db.query<{ status: string; break_unspecified: boolean; work_area: string }>(
      "select status::text,break_unspecified,work_area from public.rota_shifts where id=$1",
      [cancelled.rows[0].result.shiftId],
    );
    expect(stored.rows).toEqual([{ status: "cancelled", break_unspecified: true, work_area: "Blue" }]);
  });

  it("allows staff self-service only for the linked staff profile", async () => {
    await setTenantAuthUser(db, USER_A_STAFF, "aal1");
    const own = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_leave_command($1,'create_leave',$2::jsonb,$3::uuid,null) result",
      [ORG_A, JSON.stringify({ sourceSiteId: SITE_A1, leaveType: "training", startDate: "2026-08-24", endDate: "2026-08-24", requestedMinutes: 480 }), randomUUID()],
    );
    const another = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_leave_command($1,'create_leave',$2::jsonb,$3::uuid,null) result",
      [ORG_A, JSON.stringify({ staffId: STAFF_A, sourceSiteId: SITE_A1, leaveType: "training", startDate: "2026-08-25", endDate: "2026-08-25", requestedMinutes: 480 }), randomUUID()],
    );
    expect(own.rows[0].result).toMatchObject({ outcome: "success", code: "leave_created" });
    expect(another.rows[0].result).toMatchObject({ outcome: "permission_denied" });
  });

  it("blocks inactive staff on the commercial path", async () => {
    await resetTenantDatabaseRole(db);
    await db.query("update public.staff_profiles set active=false where organisation_id=$1 and id=$2", [ORG_A, STAFF_A2]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const blocked = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, staffId: STAFF_A2, shiftDate: "2026-08-23", startTime: "09:00", endTime: "13:00" }), randomUUID()],
    );
    expect(blocked.rows[0].result).toMatchObject({ outcome: "conflict", code: "staff_inactive" });
    await resetTenantDatabaseRole(db);
    await db.query("update public.staff_profiles set active=true where organisation_id=$1 and id=$2", [ORG_A, STAFF_A2]);
  });

  it("applies a site closure only to that occurrence site", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(
      "insert into public.site_closures(organisation_id,site_id,starts_on,ends_on,label,created_by_membership_id) values($1,$2,'2026-08-20','2026-08-20','Fictional closure',$3)",
      [ORG_A, SITE_A1, "aa000000-0000-0000-0000-000000000001"],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const a1 = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, staffId: STAFF_A2, shiftDate: "2026-08-20", startTime: "09:00", endTime: "13:00" }), randomUUID()],
    );
    const a2Week = await db.query<{ id: string }>("select id::text from public.rota_weeks where organisation_id=$1 and site_id=$2 and week_start_date='2026-08-17' and status<>'archived'", [ORG_A, SITE_A2]);
    const a2 = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A2, JSON.stringify({ weekId: a2Week.rows[0].id, staffId: STAFF_A2, shiftDate: "2026-08-20", startTime: "09:00", endTime: "13:00" }), randomUUID()],
    );
    expect(a1.rows[0].result).toMatchObject({ outcome: "conflict", code: "site_closed" });
    expect(a2.rows[0].result).toMatchObject({ outcome: "success", code: "shift_created" });
  });

  it("does not expose another organisation's leave snapshot", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(db.query("select public.get_commercial_leave_snapshot($1)", [ORG_B])).rejects.toThrow(/access denied/i);
  });

  it("copies a day within the same tenant week with revision and replay protection", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const revision = await db.query<{ revision: number }>("select revision::integer from public.rota_weeks where id=$1", [weekA1]);
    const key = randomUUID();
    const payload = { weekId: weekA1, sourceDate: "2026-08-17", targetDate: "2026-08-19" };
    const first = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'copy_day',$3::jsonb,$4::uuid,$5) result",
      [ORG_A, SITE_A1, JSON.stringify(payload), key, revision.rows[0].revision],
    );
    const replay = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'copy_day',$3::jsonb,$4::uuid,$5) result",
      [ORG_A, SITE_A1, JSON.stringify(payload), key, revision.rows[0].revision],
    );
    expect(first.rows[0].result).toMatchObject({ outcome: "success", code: "day_copied", copiedShifts: 1 });
    expect(replay.rows[0].result).toEqual(first.rows[0].result);
  });

  it("saves and applies a site-fenced rota template", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const saved = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'save_week_as_template',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, name: "Fictional standard week" }), randomUUID()],
    );
    const target = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'create_week',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekStart: "2026-08-24" }), randomUUID()],
    );
    const applied = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'apply_template',$3::jsonb,$4::uuid,$5) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: target.rows[0].result.weekId, templateId: saved.rows[0].result.templateId, mode: "alongside" }), randomUUID(), target.rows[0].result.revision],
    );
    const crossSite = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'apply_template',$3::jsonb,$4::uuid,$5) result",
      [ORG_A, SITE_A2, JSON.stringify({ weekId: target.rows[0].result.weekId, templateId: saved.rows[0].result.templateId, mode: "alongside" }), randomUUID(), target.rows[0].result.revision],
    );
    expect(saved.rows[0].result).toMatchObject({ outcome: "success", code: "template_saved", copiedShifts: 2 });
    expect(applied.rows[0].result).toMatchObject({ outcome: "success", code: "template_applied", copiedShifts: 2 });
    expect(crossSite.rows[0].result.outcome).toBe("not_found");
  });

  it("creates organisation-owned leave and approval reports all affected sites without deleting shifts", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const before = await db.query<{ count: number }>("select count(*)::integer count from public.rota_shifts where organisation_id=$1 and staff_id=$2 and archived_at is null", [ORG_A, STAFF_A2]);
    const created = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_leave_command($1,'create_leave',$2::jsonb,$3::uuid,null) result",
      [ORG_A, JSON.stringify({ staffId: STAFF_A2, sourceSiteId: SITE_A1, leaveType: "annual_leave", startDate: "2026-08-17", endDate: "2026-08-18", dayPart: "full_day", requestedMinutes: 960 }), randomUUID()],
    );
    const reviewed = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_leave_command($1,'review_leave',$2::jsonb,$3::uuid,$4) result",
      [ORG_A, JSON.stringify({ leaveRequestId: created.rows[0].result.leaveRequestId, status: "approved" }), randomUUID(), created.rows[0].result.revision],
    );
    expect(reviewed.rows[0].result).toMatchObject({ outcome: "success", code: "leave_approved", affectedShiftCount: 1 });
    await resetTenantDatabaseRole(db);
    const shifts = await db.query<{ count: number }>("select count(*)::integer count from public.rota_shifts where organisation_id=$1 and staff_id=$2 and archived_at is null", [ORG_A, STAFF_A2]);
    expect(shifts.rows[0].count).toBe(before.rows[0].count);
  });

  it("returns tenant-safe published planned shifts only", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const week = await db.query<{ revision: number }>("select revision::integer from public.rota_weeks where id=$1", [weekA1]);
    await db.query(
      "select public.execute_commercial_rota_command($1,$2,'set_week_status',$3::jsonb,$4::uuid,$5)",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: weekA1, status: "published" }), randomUUID(), week.rows[0].revision],
    );
    const result = await db.query<{ site_id: string; staff_id: string; shift_date: string }>(
      "select site_id::text,staff_id,shift_date::text from public.get_commercial_planned_shifts($1,$2,'2026-08-17','2026-08-23',null)",
      [ORG_A, SITE_A1],
    );
    expect(result.rows).toEqual([
      { site_id: SITE_A1, staff_id: STAFF_A2, shift_date: "2026-08-17" },
      { site_id: SITE_A1, staff_id: STAFF_A2, shift_date: "2026-08-19" },
    ]);
  });

  it("archives live legacy rota work and skips inactive staff when copying preserved history", async () => {
    await resetTenantDatabaseRole(db);
    const staffId = "legacy-lifecycle-staff";
    const accountId = "99000000-0000-0000-0000-000000000002";
    await db.query("insert into public.staff_profiles(id,full_name,display_name,employment_role,active) values($1,'Fictional Legacy Staff','Fictional','Staff member',true)", [staffId]);
    await db.query("insert into public.staff_accounts(id,staff_id,role,active) values($1,$2,'staff',true)", [accountId, staffId]);
    await db.query("insert into public.staff_kiosk_settings(staff_id) values($1)", [staffId]);
    await db.exec(`
      insert into public.rota_weeks(id,week_start_date,status,created_by,updated_by) values
        ('49000000-0000-0000-0000-000000000001','2026-07-06','draft','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
        ('49000000-0000-0000-0000-000000000002',date_trunc('week',(clock_timestamp() at time zone 'Europe/London'))::date,'draft','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');
      insert into public.rota_shifts(rota_week_id,staff_id,shift_date,start_time,end_time,created_by,updated_by) values
        ('49000000-0000-0000-0000-000000000001','legacy-lifecycle-staff','2026-07-06','09:00','17:00','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001'),
        ('49000000-0000-0000-0000-000000000002','legacy-lifecycle-staff',(clock_timestamp() at time zone 'Europe/London')::date,'09:00','17:00','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');
      insert into public.rota_templates(id,name,created_by,updated_by) values('49000000-0000-0000-0000-000000000003','Fictional legacy template','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');
      insert into public.rota_template_shifts(template_id,staff_id,day_of_week,start_time,end_time,created_by,updated_by) values('49000000-0000-0000-0000-000000000003','legacy-lifecycle-staff',1,'09:00','17:00','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');
    `);
    await setLegacyManager(db);
    await db.query("select public.set_staff_profile_active($1,false)", [staffId]);
    await resetTenantDatabaseRole(db);
    const state = await db.query<{ active: boolean; past_archived: boolean; future_archived: boolean; template_archived: boolean; account_active: boolean; kiosk_enabled: boolean; audits: number }>(`
      select profile.active,
        (select archived_at is not null from public.rota_shifts where staff_id=$1 and shift_date='2026-07-06') past_archived,
        (select archived_at is not null from public.rota_shifts where staff_id=$1 and shift_date=(clock_timestamp() at time zone 'Europe/London')::date) future_archived,
        (select archived_at is not null from public.rota_template_shifts where staff_id=$1) template_archived,
        account.active account_active,kiosk.kiosk_enabled,
        (select count(*)::integer from public.staff_account_access_audit where staff_id=$1 and action='disabled') audits
      from public.staff_profiles profile join public.staff_accounts account on account.staff_id=profile.id
      join public.staff_kiosk_settings kiosk on kiosk.staff_id=profile.id where profile.id=$1
    `, [staffId]);
    expect(state.rows[0]).toEqual({ active: false, past_archived: false, future_archived: true, template_archived: true, account_active: false, kiosk_enabled: false, audits: 1 });
    const copied = await db.query<{ result: { copied_shifts: number } }>("select public.copy_previous_rota_week('2026-07-13') result");
    expect(copied.rows[0].result.copied_shifts).toBe(0);
  });

  it("deactivates commercial staff atomically across memberships, live rotas and templates without crossing tenants", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const futureWeek = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'create_week',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekStart: "2026-08-31" }), randomUUID()],
    );
    await db.query(
      "select public.execute_commercial_rota_command($1,$2,'save_shift',$3::jsonb,$4::uuid,null)",
      [ORG_A, SITE_A1, JSON.stringify({ weekId: futureWeek.rows[0].result.weekId, staffId: STAFF_A2, shiftDate: "2026-08-31", startTime: "09:00", endTime: "17:00" }), randomUUID()],
    );
    const result = await db.query<{ result: Record<string, unknown> }>(
      "select commercial_api_private.execute_commercial_admin_command($1,'deactivate_staff',$2::jsonb,$3::uuid,1) result",
      [ORG_A, JSON.stringify({ staffId: STAFF_A2 }), randomUUID()],
    );
    expect(result.rows[0].result).toMatchObject({ outcome: "success", code: "staff_deactivated" });
    await resetTenantDatabaseRole(db);
    const state = await db.query<{ active: boolean; membership_status: string; past_active: number; future_active: number; template_active: number; other_tenant_active: boolean; audits: number }>(`
      select profile.active,
        (select status::text from public.organisation_memberships where organisation_id=$1 and staff_id=$2) membership_status,
        (select count(*)::integer from public.rota_shifts where organisation_id=$1 and staff_id=$2 and shift_date<(clock_timestamp() at time zone 'Europe/London')::date and archived_at is null) past_active,
        (select count(*)::integer from public.rota_shifts where organisation_id=$1 and staff_id=$2 and shift_date>=(clock_timestamp() at time zone 'Europe/London')::date and archived_at is null) future_active,
        (select count(*)::integer from public.rota_template_shifts where organisation_id=$1 and staff_id=$2 and archived_at is null) template_active,
        (select active from public.staff_profiles where organisation_id=$3 and id=$4) other_tenant_active,
        (select count(*)::integer from public.test_admin_audit where staff_id=$2 and event_type='staff_deactivated') audits
      from public.staff_profiles profile where profile.organisation_id=$1 and profile.id=$2
    `, [ORG_A, STAFF_A2, ORG_B, STAFF_B]);
    expect(state.rows[0]).toMatchObject({ active: false, membership_status: "suspended", future_active: 0, template_active: 0, other_tenant_active: true, audits: 1 });
    expect(state.rows[0].past_active).toBeGreaterThan(0);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const copied = await db.query<{ result: Record<string, unknown> }>(
      "select public.execute_commercial_rota_command($1,$2,'copy_previous_week',$3::jsonb,$4::uuid,null) result",
      [ORG_A, SITE_A1, JSON.stringify({ weekStart: "2026-08-24" }), randomUUID()],
    );
    expect(copied.rows[0].result).toMatchObject({ outcome: "success", copiedShifts: 0 });
  });
});
