import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  USER_A_OWNER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import { createKioskOnboardingDatabase } from "./helpers/onboarding-persistence-db";

type Snapshot = {
  session: { id: string; organisationId: string | null; revision: string };
  legalDocuments: Array<{ documentType: string; documentVersion: string; locale: string }>;
  siteSummary: { siteId: string } | null;
  kiosk: {
    registration: { registrationId: string; status: string } | null;
    device: { deviceId: string; active: boolean; status: string } | null;
    readiness: { complete: boolean; pinReadyStaffCount: number; offlineDisabled: true; offlineAuthorisationCount: number };
    staff: Array<{ staffId: string; pinReady: boolean; visibleOnKiosk: boolean }>;
  };
};

const key = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function command(db: PGlite, s: Snapshot, type: string, n: number, payload: unknown) {
  return (await db.query<{ x: { commandResult: { outcome: string; resultCode: string; resultReference: Record<string, string> }; oneTimeRegistrationCode?: string; registrationExpiresAt?: string; bootstrap: Snapshot } }>(
    "select public.execute_onboarding_bootstrap_command($1::jsonb)x",
    [JSON.stringify({ schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1, sessionId: s.session.id, commandType: type, idempotencyKey: key(n), expectedSessionRevision: s.session.revision, payload })],
  )).rows[0].x;
}

async function ready(db: PGlite) {
  let s = (await db.query<{ x: Snapshot }>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
  s = (await command(db, s, "accept_legal_documents", 1, { acceptances: s.legalDocuments.map((d) => ({ documentType: d.documentType, documentVersion: d.documentVersion, locale: d.locale })), safeRequestMetadata: { source: "commercial_onboarding" } })).bootstrap;
  s = (await command(db, s, "create_organisation", 2, { displayName: "Atlas Demo", legalName: "Atlas Demo Limited", contactEmail: "owner@example.invalid", country: "GB", timezone: "Europe/London", postalAddress: { line1: "1 Fictional Way", locality: "Exampleton", postcode: "ZZ1 1ZZ" } })).bootstrap;
  s = (await command(db, s, "create_first_site", 3, { siteName: "Atlas Central", contactPhone: "+44 20 7946 0999", country: "GB", timezone: "Europe/London", postalAddress: { line1: "2 Fictional Way", locality: "Exampleton", postcode: "ZZ1 1ZZ" }, openingHours: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, intervals: i < 5 ? [{ opensAt: "08:00", closesAt: "18:00" }] : [] })), workWeekStarts: 1, operationalDayBoundary: "04:00" })).bootstrap;
  s = (await command(db, s, "select_plan", 4, { planKey: "preview_standard", planVersion: 1, selection: "free_trial" })).bootstrap;
  s = (await command(db, s, "skip_staffing", 5, { acknowledgement: "staffing_not_ready" })).bootstrap;
  await resetTenantDatabaseRole(db);
  await db.query("insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,email,active) values('kiosk-staff-1',$1,'Taylor Example','Taylor','staff','taylor@example.invalid',true)", [s.session.organisationId]);
  await db.query("insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary) values($1,'kiosk-staff-1',$2,current_date,true)", [s.session.organisationId, s.siteSummary!.siteId]);
  await db.query("insert into public.staff_kiosk_settings(staff_id,kiosk_enabled,pin_hash,pin_reset_required,onboarding_attendance_eligible) values('kiosk-staff-1',false,null,true,true) on conflict(staff_id) do update set onboarding_attendance_eligible=true,kiosk_enabled=false,pin_hash=null,pin_reset_required=true");
  await db.query("update public.onboarding_step_states set status='complete',revision=revision+1,completed_at=now(),started_at=coalesce(started_at,now()) where session_id=$1 and step_key in('manager_invitations','staff_invitations')", [s.session.id]);
  await db.query("update public.onboarding_sessions set current_step_key='kiosk',revision=revision+1 where id=$1", [s.session.id]);
  await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  return (await db.query<{ x: Snapshot }>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
}

describe("commercial online kiosk onboarding database", () => {
  let db: PGlite;
  beforeEach(async () => { db = await createKioskOnboardingDatabase(); await setTenantAuthUser(db, USER_A_OWNER, "aal2"); }, 30000);
  afterEach(async () => db?.close());

  it("creates one short-lived site-bound registration without storing the secret", async () => {
    const s = await ready(db);
    const first = await command(db, s, "start_kiosk_registration", 10, { siteId: s.siteSummary!.siteId, deviceName: "Front entrance" });
    const secret = first.oneTimeRegistrationCode!;
    expect(secret).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    expect(first.registrationExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const replay = await command(db, s, "start_kiosk_registration", 10, { siteId: s.siteSummary!.siteId, deviceName: "Front entrance" });
    expect(replay.commandResult.outcome).toBe("replayed");
    expect(replay.oneTimeRegistrationCode).toBeUndefined();
    await resetTenantDatabaseRole(db);
    const stored = (await db.query<{ raw: number; devices: number; offline: number }>("select count(*) filter(where to_jsonb(r)::text like '%'||$1||'%')::int raw,(select count(*)::int from public.kiosk_devices)devices,(select count(*)::int from public.kiosk_devices where offline_enabled)offline from public.commercial_kiosk_registrations r", [secret])).rows[0];
    expect(stored).toEqual({ raw: 0, devices: 0, offline: 0 });
  });

  it("claims atomically, recovers a lost response for the same browser, and rejects another browser", async () => {
    const s = await ready(db);
    const started = await command(db, s, "start_kiosk_registration", 20, { siteId: s.siteSummary!.siteId, deviceName: "Reception" });
    const registrationId = started.commandResult.resultReference.kioskRegistrationId;
    const secret = started.oneTimeRegistrationCode!;
    const claim = async (nonce: string) => (await db.query<{ x: { outcome: string; deviceId?: string; deviceToken?: string; organisationId?: string; siteId?: string } }>("select public.claim_commercial_kiosk($1,$2,$3)x", [registrationId, secret, nonce])).rows[0].x;
    const first = await claim("a".repeat(43));
    const recovered = await claim("a".repeat(43));
    const other = await claim("b".repeat(43));
    expect(first).toMatchObject({ outcome: "claimed", organisationId: s.session.organisationId, siteId: s.siteSummary!.siteId });
    expect(recovered).toMatchObject({ outcome: "recovered", deviceId: first.deviceId });
    expect(recovered.deviceToken).not.toBe(first.deviceToken);
    expect(other.outcome).toBe("already_claimed");
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: number }>("select count(*)::int count from public.kiosk_devices")).rows[0].count).toBe(1);
  });

  it("supports code-only tablet claim and limits repeated guessing", async () => {
    const s = await ready(db);
    const started = await command(db, s, "start_kiosk_registration", 25, { siteId: s.siteSummary!.siteId, deviceName: "Code entry tablet" });
    const secret = started.oneTimeRegistrationCode!;
    const manual = (await db.query<{ x: { outcome: string; siteId: string } }>("select public.claim_commercial_kiosk(null,$1,$2)x", [secret, "m".repeat(43)])).rows[0].x;
    expect(manual).toMatchObject({ outcome: "claimed", siteId: s.siteSummary!.siteId });
    for (let index = 0; index < 6; index += 1) await db.query("select public.claim_commercial_kiosk(null,'ZZZZZZZZZZZZZZZZ',$1)", ["x".repeat(43)]);
    expect((await db.query<{ x: { outcome: string } }>("select public.claim_commercial_kiosk(null,'ZZZZZZZZZZZZZZZZ',$1)x", ["x".repeat(43)])).rows[0].x.outcome).toBe("rate_limited");
  });

  it("proves heartbeat, roster and PIN readiness without creating attendance evidence", async () => {
    let s = await ready(db);
    const started = await command(db, s, "start_kiosk_registration", 30, { siteId: s.siteSummary!.siteId, deviceName: "Staff room" });
    const claimed = (await db.query<{ x: { deviceToken: string } }>("select public.claim_commercial_kiosk($1,$2,$3)x", [started.commandResult.resultReference.kioskRegistrationId, started.oneTimeRegistrationCode, "c".repeat(43)])).rows[0].x;
    expect((await db.query<{ x: { outcome: string } }>("select public.record_commercial_kiosk_heartbeat($1,'0.1.0',1,'tablet')x", [claimed.deviceToken])).rows[0].x.outcome).toBe("connected");
    const roster = (await db.query<{ x: { outcome: string; staff: Array<Record<string, unknown>> } }>("select public.verify_commercial_kiosk_roster($1)x", [claimed.deviceToken])).rows[0].x;
    expect(roster.staff).toEqual([expect.objectContaining({ staffId: "kiosk-staff-1", pinReady: false })]);
    s = (await db.query<{ x: Snapshot }>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
    const pin = await command(db, s, "set_kiosk_staff_pin", 31, { staffId: "kiosk-staff-1", temporaryPin: "4826" });
    expect(JSON.stringify(pin)).not.toContain("4826");
    await db.query("select public.verify_commercial_kiosk_roster($1)", [claimed.deviceToken]);
    s = (await db.query<{ x: Snapshot }>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
    const completed = await command(db, s, "confirm_kiosk_connection", 32, {});
    expect(completed.bootstrap.kiosk.readiness).toMatchObject({ complete: true, pinReadyStaffCount: 1, offlineDisabled: true, offlineAuthorisationCount: 0 });
    await resetTenantDatabaseRole(db);
    await db.query("insert into public.kiosk_offline_authorisations(kiosk_device_id,expires_at) select id,now()+interval '1 hour' from public.kiosk_devices limit 1");
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const fenced = (await db.query<{ x: Snapshot }>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
    expect(fenced.kiosk.readiness).toMatchObject({ complete: false, offlineAuthorisationCount: 1 });
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: number }>("select count(*)::int count from public.clock_events where organisation_id=$1", [s.session.organisationId])).rows[0].count).toBe(0);
    expect((await db.query<{ x: { ok: boolean; code: string } }>("select public.perform_commercial_kiosk_attendance_action($1,'kiosk-staff-1','4826','clock_in','0',$2)x", [claimed.deviceToken, key(39)])).rows[0].x).toMatchObject({ ok: false, code: "pre_live" });
  });

  it("rejects weak and year-like PINs without persisting plaintext", async () => {
    let s = await ready(db);
    const started = await command(db, s, "start_kiosk_registration", 35, { siteId: s.siteSummary!.siteId, deviceName: "PIN test tablet" });
    const claimed = (await db.query<{ x: { deviceToken: string } }>("select public.claim_commercial_kiosk(null,$1,$2)x", [started.oneTimeRegistrationCode, "p".repeat(43)])).rows[0].x;
    await db.query("select public.record_commercial_kiosk_heartbeat($1,'0.1.0',1,'tablet')", [claimed.deviceToken]);
    s = (await db.query<{ x: Snapshot }>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
    expect((await command(db, s, "set_kiosk_staff_pin", 36, { staffId: "kiosk-staff-1", temporaryPin: "1234" })).commandResult.resultCode).toBe("weak_pin");
    expect((await command(db, s, "set_kiosk_staff_pin", 37, { staffId: "kiosk-staff-1", temporaryPin: "2026" })).commandResult.resultCode).toBe("weak_pin");
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: number }>("select count(*)::int count from public.staff_kiosk_settings where pin_hash in('1234','2026')")).rows[0].count).toBe(0);
  });

  it("revokes the old credential and registers exactly one replacement device", async () => {
    let s = await ready(db);
    const started = await command(db, s, "start_kiosk_registration", 38, { siteId: s.siteSummary!.siteId, deviceName: "Replacement tablet" });
    const firstClaim = (await db.query<{ x: { deviceToken: string; deviceId: string } }>("select public.claim_commercial_kiosk($1,$2,$3)x", [started.commandResult.resultReference.kioskRegistrationId, started.oneTimeRegistrationCode, "r".repeat(43)])).rows[0].x;
    s = (await db.query<{ x: Snapshot }>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
    const replacement = await command(db, s, "replace_kiosk_registration", 39, { registrationId: started.commandResult.resultReference.kioskRegistrationId });
    expect(replacement.oneTimeRegistrationCode).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    expect(replacement.commandResult.resultReference.kioskRegistrationId).not.toBe(started.commandResult.resultReference.kioskRegistrationId);
    s = replacement.bootstrap;
    expect((await command(db, s, "replace_kiosk_registration", 40, { registrationId: started.commandResult.resultReference.kioskRegistrationId })).commandResult.resultCode).toBe("registration_not_replaceable");
    expect((await db.query<{ x: { outcome: string } }>("select public.record_commercial_kiosk_heartbeat($1,'0.1.0',1,'tablet')x", [firstClaim.deviceToken])).rows[0].x.outcome).not.toBe("connected");
    const secondClaim = (await db.query<{ x: { outcome: string; deviceId: string } }>("select public.claim_commercial_kiosk($1,$2,$3)x", [replacement.commandResult.resultReference.kioskRegistrationId, replacement.oneTimeRegistrationCode, "s".repeat(43)])).rows[0].x;
    expect(secondClaim.outcome).toBe("claimed");
    expect(secondClaim.deviceId).not.toBe(firstClaim.deviceId);
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ active: number; total: number }>("select count(*) filter(where active)::int active,count(*)::int total from public.kiosk_devices")).rows[0]).toEqual({ active: 1, total: 2 });
  });

  it("revokes immediately and fences another organisation and AAL1", async () => {
    const s = await ready(db);
    await setTenantAuthUser(db, USER_B_OWNER, "aal2");
    expect((await command(db, s, "start_kiosk_registration", 50, { siteId: s.siteSummary!.siteId, deviceName: "Wrong tenant" })).commandResult.resultCode).toBe("permission_denied");
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    expect((await command(db, s, "start_kiosk_registration", 51, { siteId: s.siteSummary!.siteId, deviceName: "AAL1 tablet" })).commandResult.resultCode).toBe("mfa_required");
  });
});
