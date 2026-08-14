import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { USER_A_OWNER, resetTenantDatabaseRole, setTenantAuthUser } from "./helpers/tenant-primitives-db";
import { createReadinessOnboardingDatabase } from "./helpers/onboarding-persistence-db";

const key = (n: number) => `81000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Snapshot = { session: { id: string; organisationId: string | null; revision: string; status: string }; legalDocuments: Array<{documentType:string;documentVersion:string;locale:string}>; siteSummary:{siteId:string;displayName:string}|null; kiosk:{registration:{registrationId:string}|null}; readiness?: Readiness; liveSummary?: {trialStartedAt:string;trialEndsAt:string;kioskConnected:boolean;offlineEnabled:false}|null };
type Readiness = { fingerprint:string; overallStatus:string; blockerCount:number; warningCount:number; progressPercent:number; items:Array<{key:string;status:string;severity:string}> };

async function command(db:PGlite,s:Snapshot,type:string,n:number,payload:unknown){return (await db.query<{x:{commandResult:{outcome:string;resultCode:string;sessionRevision:string};bootstrap:Snapshot;readiness:Readiness|null}}>("select public.execute_onboarding_bootstrap_command($1::jsonb)x",[JSON.stringify({schemaVersion:1,workflowKey:"commercial_customer_v1",workflowVersion:1,sessionId:s.session.id,commandType:type,idempotencyKey:key(n),expectedSessionRevision:s.session.revision,payload})])).rows[0].x;}

async function configured(db:PGlite){
  let s=(await db.query<{x:Snapshot}>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
  s=(await command(db,s,"accept_legal_documents",1,{acceptances:s.legalDocuments.map(d=>({documentType:d.documentType,documentVersion:d.documentVersion,locale:d.locale})),safeRequestMetadata:{source:"commercial_onboarding"}})).bootstrap;
  s=(await command(db,s,"create_organisation",2,{displayName:"Northstar Example",legalName:"Northstar Example Limited",contactEmail:"owner@example.invalid",country:"GB",timezone:"Europe/London",postalAddress:{line1:"1 Fictional Way",locality:"Exampleton",postcode:"ZZ1 1ZZ"}})).bootstrap;
  s=(await command(db,s,"create_first_site",3,{siteName:"Northstar Central",contactPhone:"+44 20 7946 0999",country:"GB",timezone:"Europe/London",postalAddress:{line1:"2 Fictional Way",locality:"Exampleton",postcode:"ZZ1 1ZZ"},openingHours:Array.from({length:7},(_,i)=>({dayOfWeek:i+1,intervals:i<5?[{opensAt:"08:00",closesAt:"18:00"}]:[]})),workWeekStarts:1,operationalDayBoundary:"04:00"})).bootstrap;
  s=(await command(db,s,"select_plan",4,{planKey:"preview_standard",planVersion:1,selection:"free_trial"})).bootstrap;
  await resetTenantDatabaseRole(db);
  await db.query("insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,email,active) values('ready-staff-1',$1,'Morgan Example','Morgan','staff','morgan@example.invalid',true)",[s.session.organisationId]);
  await db.query("insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary) values($1,'ready-staff-1',$2,current_date,true)",[s.session.organisationId,s.siteSummary!.siteId]);
  await db.query("update public.staff_kiosk_settings set kiosk_enabled=true,pin_hash='fictional-hash',pin_reset_required=false,onboarding_attendance_eligible=true where staff_id='ready-staff-1'");
  await db.query("update public.onboarding_step_states set status='complete',revision=revision+1,started_at=coalesce(started_at,now()),completed_at=now(),last_saved_at=now() where session_id=$1 and step_key in('staffing','manager_invitations','staff_invitations','kiosk')",[s.session.id]);
  await db.query("insert into public.commercial_kiosk_registrations(organisation_id,site_id,requested_by_membership_id,intended_device_name,secret_hash,status,expires_at) select $1,$2,m.id,'Reception',decode(md5(random()::text)||md5(random()::text),'hex'),'pending',now()+interval '10 minutes' from public.organisation_memberships m where m.organisation_id=$1 and m.auth_user_id=$3",[s.session.organisationId,s.siteSummary!.siteId,USER_A_OWNER]);
  const reg=(await db.query<{id:string}>("select id from public.commercial_kiosk_registrations where organisation_id=$1",[s.session.organisationId])).rows[0];
  const device=(await db.query<{id:string}>("insert into public.kiosk_devices(device_name,token_hash,active,expires_at,organisation_id,site_id,activated_by_membership_id,offline_enabled,registration_id,last_heartbeat_at,roster_verified_at) select 'Reception',sha256(convert_to('fixture-live-device-token-1234567890','UTF8')),true,now()+interval '180 days',$1,$2,m.id,false,$3,now(),now() from public.organisation_memberships m where m.organisation_id=$1 and m.auth_user_id=$4 returning id",[s.session.organisationId,s.siteSummary!.siteId,reg.id,USER_A_OWNER])).rows[0];
  await db.query("update public.commercial_kiosk_registrations set status='verified',claimed_device_id=$1,claimed_at=now(),verified_at=now(),revision=revision+1 where id=$2",[device.id,reg.id]);
  await db.query("update public.onboarding_sessions set current_step_key='readiness',revision=revision+1 where id=$1",[s.session.id]);
  await setTenantAuthUser(db,USER_A_OWNER,"aal2");
  return (await db.query<{x:Snapshot}>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
}

describe("authoritative commercial readiness and Go Live",()=>{
  let db:PGlite;
  beforeEach(async()=>{db=await createReadinessOnboardingDatabase();await setTenantAuthUser(db,USER_A_OWNER,"aal2");},30000);
  afterEach(async()=>db?.close());

  it("derives blockers and a stable fingerprint from authoritative state",async()=>{
    const s=await configured(db);
    await resetTenantDatabaseRole(db);await db.exec("set timezone='Pacific/Honolulu'");await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const first=await command(db,s,"evaluate_readiness",10,{});
    const second=await command(db,first.bootstrap,"evaluate_readiness",11,{});
    expect(first.readiness).toMatchObject({overallStatus:"ready",blockerCount:0,progressPercent:100});
    expect(second.readiness?.fingerprint).toBe(first.readiness?.fingerprint);
    await resetTenantDatabaseRole(db);await db.query("update public.kiosk_devices set last_heartbeat_at=now(),roster_verified_at=now(),health_revision=health_revision+2 where organisation_id=$1",[s.session.organisationId]);await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const healthyPoll=await command(db,second.bootstrap,"evaluate_readiness",12,{});
    expect(healthyPoll.readiness?.fingerprint).toBe(second.readiness?.fingerprint);
    await resetTenantDatabaseRole(db);
    await db.query("insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,email,active) values('ready-staff-2',$1,'Taylor Example','Taylor','staff','taylor@example.invalid',true)",[s.session.organisationId]);
    await db.query("insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary) values($1,'ready-staff-2',$2,(now() at time zone 'Europe/London')::date,false)",[s.session.organisationId,s.siteSummary!.siteId]);
    await db.query("update public.staff_kiosk_settings set kiosk_enabled=true,pin_hash='fictional-hash-2',pin_reset_required=false,onboarding_attendance_eligible=true where staff_id='ready-staff-2'");
    await db.query("update public.staff_kiosk_settings set onboarding_attendance_eligible=false where staff_id='ready-staff-1'");
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const rosterChanged=await command(db,healthyPoll.bootstrap,"evaluate_readiness",13,{});
    expect(rosterChanged.readiness?.fingerprint).not.toBe(healthyPoll.readiness?.fingerprint);
    expect(rosterChanged.readiness?.items).toContainEqual(expect.objectContaining({key:"kiosk_roster",status:"blocked"}));
    await resetTenantDatabaseRole(db);await db.query("update public.kiosk_devices set active=false,revoked_at=now(),revoked_by_membership_id=activated_by_membership_id where organisation_id=$1",[s.session.organisationId]);await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const changed=await command(db,rosterChanged.bootstrap,"evaluate_readiness",14,{});
    expect(changed.readiness?.fingerprint).not.toBe(first.readiness?.fingerprint);
    expect(changed.readiness?.items).toContainEqual(expect.objectContaining({key:"online_kiosk",status:"blocked"}));
  });

  it("atomically starts one 60-day trial and leaves offline and attendance evidence unchanged",async()=>{
    const s=await configured(db);const review=await command(db,s,"evaluate_readiness",20,{});
    const live=await command(db,review.bootstrap,"go_live",21,{readinessFingerprint:review.readiness!.fingerprint,acknowledgedWarnings:["sole_manager"]});
    const replay=await command(db,review.bootstrap,"go_live",21,{readinessFingerprint:review.readiness!.fingerprint,acknowledgedWarnings:["sole_manager"]});
    expect(live.commandResult).toMatchObject({outcome:"succeeded",resultCode:"go_live_completed"});
    expect(replay.commandResult.outcome).toBe("replayed");
    await resetTenantDatabaseRole(db);
    const state=(await db.query<{state:string;days:number;events:number;warning_events:number;offline:number;clock_events:number;session_status:string}>("select sub.state,(extract(epoch from(sub.trial_ends_at-sub.trial_started_at))/86400)::int days,(select count(*)::int from public.organisation_subscription_state_events where subscription_id=sub.id and to_state='trial_active')events,(select count(*)::int from public.onboarding_events where organisation_id=sub.organisation_id and event_type='readiness_warning_acknowledged')warning_events,(select count(*)::int from public.kiosk_devices where organisation_id=sub.organisation_id and offline_enabled)offline,(select count(*)::int from public.clock_events where organisation_id=sub.organisation_id)clock_events,(select status from public.onboarding_sessions where organisation_id=sub.organisation_id)session_status from public.organisation_subscriptions sub where sub.organisation_id=$1 and sub.is_current",[s.session.organisationId])).rows[0];
    expect(state).toEqual({state:"trial_active",days:60,events:1,warning_events:1,offline:0,clock_events:0,session_status:"live"});
  });

  it("rejects stale fingerprints and AAL1 without partial activation",async()=>{
    const s=await configured(db);const review=await command(db,s,"evaluate_readiness",30,{});
    const stale=await command(db,review.bootstrap,"go_live",31,{readinessFingerprint:"f".repeat(64),acknowledgedWarnings:["sole_manager"]});
    expect(stale.commandResult.resultCode).toBe("readiness_changed");
    await setTenantAuthUser(db,USER_A_OWNER,"aal1");
    const denied=await command(db,review.bootstrap,"go_live",32,{readinessFingerprint:review.readiness!.fingerprint,acknowledgedWarnings:["sole_manager"]});
    expect(denied.commandResult.resultCode).toBe("mfa_required");
    await resetTenantDatabaseRole(db);
    expect((await db.query<{state:string}>("select state from public.organisation_subscriptions where organisation_id=$1",[s.session.organisationId])).rows[0].state).toBe("trial_pending");
  });

  it("keeps skipped or later-invalid staffing as a blocker and rejects the stale review",async()=>{
    const s=await configured(db);const review=await command(db,s,"evaluate_readiness",40,{});
    await resetTenantDatabaseRole(db);await db.query("update public.staff_profiles set active=false where organisation_id=$1",[s.session.organisationId]);await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const rejected=await command(db,review.bootstrap,"go_live",41,{readinessFingerprint:review.readiness!.fingerprint,acknowledgedWarnings:["sole_manager"]});
    expect(rejected.commandResult.resultCode).toBe("readiness_changed");
    expect(rejected.readiness?.items).toContainEqual(expect.objectContaining({key:"staff_present",status:"blocked"}));
  });

  it("protects live and trial history, unlocks only online attendance, and cannot restart the trial",async()=>{
    const s=await configured(db);
    expect((await db.query<{x:{ok:boolean;code:string}}>("select public.perform_commercial_kiosk_attendance_action('fixture-live-device-token-1234567890','ready-staff-1','4826','clock_in','0',$1)x",[key(50)])).rows[0].x.code).toBe("pre_live");
    await db.query("select set_config('app.commercial_go_live',$1,true)",[s.session.organisationId]);
    await expect(db.query("update public.organisations set operational_state='live',went_live_at=now() where id=$1",[s.session.organisationId])).rejects.toThrow(/permission denied|guarded Go Live/i);
    const review=await command(db,s,"evaluate_readiness",51,{});const live=await command(db,review.bootstrap,"go_live",52,{readinessFingerprint:review.readiness!.fingerprint,acknowledgedWarnings:["sole_manager"]});
    const firstTimes=(await db.query<{started:string;ends:string}>("select trial_started_at::text started,trial_ends_at::text ends from public.organisation_subscriptions where organisation_id=$1",[s.session.organisationId])).rows[0];
    expect((await db.query<{x:{ok:boolean;code:string}}>("select public.perform_commercial_kiosk_attendance_action('fixture-live-device-token-1234567890','ready-staff-1','4826','clock_in','0',$1)x",[key(53)])).rows[0].x.ok).toBe(true);
    expect((await db.query<{x:{ok:boolean;code:string}}>("select public.perform_commercial_kiosk_attendance_action('fixture-live-device-token-1234567890','ready-staff-1','4826','clock_out','fixture-revision',$1)x",[key(54)])).rows[0].x.ok).toBe(true);
    await expect(db.query("update public.organisations set operational_state='pre_live',went_live_at=null where id=$1",[s.session.organisationId])).rejects.toThrow(/permission denied|guarded Go Live|immutable/i);
    await resetTenantDatabaseRole(db);await db.query("update public.kiosk_devices set last_heartbeat_at=now()-interval '6 minutes' where organisation_id=$1",[s.session.organisationId]);await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const degraded=await command(db,live.bootstrap,"evaluate_readiness",55,{});
    expect(degraded.bootstrap.session.status).toBe("live");
    expect(degraded.bootstrap.liveSummary?.kioskConnected).toBe(false);
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const second=await command(db,degraded.bootstrap,"go_live",56,{readinessFingerprint:degraded.readiness!.fingerprint,acknowledgedWarnings:["sole_manager"]});
    expect(second.commandResult.outcome).not.toBe("succeeded");
    await resetTenantDatabaseRole(db);
    const secondTimes=(await db.query<{started:string;ends:string}>("select trial_started_at::text started,trial_ends_at::text ends from public.organisation_subscriptions where organisation_id=$1",[s.session.organisationId])).rows[0];
    expect(secondTimes).toEqual(firstTimes);
    const attendance=(await db.query<{events:number;distinct_events:number;duration_seconds:number}>("select count(*)::int events,count(distinct id)::int distinct_events,extract(epoch from(max(event_timestamp)-min(event_timestamp)))::int duration_seconds from public.clock_events where organisation_id=$1 and staff_id='ready-staff-1'",[s.session.organisationId])).rows[0];
    expect(attendance.events).toBe(2);
    expect(attendance.distinct_events).toBe(2);
    expect(attendance.duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it("derives omitted safety blockers and optional warnings from current database state",async()=>{
    let s=await configured(db);
    const ready=await command(db,s,"evaluate_readiness",60,{});s=ready.bootstrap;

    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.organisation_invitations(organisation_id,invited_email,token_hash,status,expires_at,invited_by_membership_id,invitation_kind,template_version,staff_id)
      select $1,'morgan.account@example.invalid',sha256(convert_to('fictional-pending-staff-invitation','UTF8')),'pending',now()+interval '7 days',m.id,'staff','staff_invitation_v1','ready-staff-1'
      from public.organisation_memberships m where m.organisation_id=$1 and m.auth_user_id=$2`,[s.session.organisationId,USER_A_OWNER]);
    await db.query("update public.kiosk_devices set last_heartbeat_at=now()-interval '6 minutes' where organisation_id=$1",[s.session.organisationId]);
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const staleDevice=await command(db,s,"evaluate_readiness",61,{});s=staleDevice.bootstrap;
    expect(staleDevice.readiness?.fingerprint).not.toBe(ready.readiness?.fingerprint);
    expect(staleDevice.readiness?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"kiosk_heartbeat",status:"blocked"}),
      expect.objectContaining({key:"staff_account_linkage",status:"warning"}),
      expect.objectContaining({key:"initial_rota",status:"not_applicable"}),
      expect.objectContaining({key:"compliance_follow_up",status:"warning"}),
    ]));

    await resetTenantDatabaseRole(db);
    await db.query("update public.kiosk_devices set last_heartbeat_at=now(),roster_verified_at=now(),expires_at=now()-interval '1 second' where organisation_id=$1",[s.session.organisationId]);
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const expiredCredential=await command(db,s,"evaluate_readiness",62,{});s=expiredCredential.bootstrap;
    expect(expiredCredential.readiness?.items).toContainEqual(expect.objectContaining({key:"online_kiosk",status:"blocked"}));

    await resetTenantDatabaseRole(db);
    await db.query("update public.kiosk_devices set expires_at=now()+interval '180 days' where organisation_id=$1",[s.session.organisationId]);
    await db.query("update public.staff_kiosk_settings set pin_reset_required=true where staff_id='ready-staff-1'");
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const noPin=await command(db,s,"evaluate_readiness",63,{});s=noPin.bootstrap;
    expect(noPin.readiness?.items).toContainEqual(expect.objectContaining({key:"pin_ready_staff",status:"blocked"}));

    await resetTenantDatabaseRole(db);
    await db.query("update public.staff_kiosk_settings set pin_reset_required=false where staff_id='ready-staff-1'");
    await db.query("update public.organisation_sites set active=false where organisation_id=$1",[s.session.organisationId]);
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const noSite=await command(db,s,"evaluate_readiness",64,{});s=noSite.bootstrap;
    expect(noSite.readiness?.items).toContainEqual(expect.objectContaining({key:"first_site",status:"blocked"}));

    await resetTenantDatabaseRole(db);
    await db.query("update public.organisation_sites set active=true where organisation_id=$1",[s.session.organisationId]);
    await db.query("update public.organisations set timezone='UTC' where id=$1",[s.session.organisationId]);
    await db.query("update public.organisation_settings set default_timezone='UTC' where organisation_id=$1",[s.session.organisationId]);
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const unsupported=await command(db,s,"evaluate_readiness",65,{});s=unsupported.bootstrap;
    expect(unsupported.readiness?.items).toContainEqual(expect.objectContaining({key:"organisation_settings",status:"blocked"}));

    await resetTenantDatabaseRole(db);
    await db.query("update public.organisations set timezone='Europe/London' where id=$1",[s.session.organisationId]);
    await db.query("update public.organisation_settings set default_timezone='Europe/London' where organisation_id=$1",[s.session.organisationId]);
    await db.query("update public.organisations set status='suspended' where id=$1",[s.session.organisationId]);
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const suspended=await command(db,s,"evaluate_readiness",66,{});s=suspended.bootstrap;
    expect(suspended.readiness?.items).toContainEqual(expect.objectContaining({key:"organisation_active",status:"blocked"}));

    await resetTenantDatabaseRole(db);
    await db.query("update public.organisations set status='trial' where id=$1",[s.session.organisationId]);
    await db.query("update public.legal_document_versions set is_current=false where document_type='terms_of_service' and locale='en-GB'");
    await db.query("insert into public.legal_document_versions(document_type,document_version,locale,title,summary,effective_at,is_current) values('terms_of_service','2026-09','en-GB','Updated fictional terms','A fictional later version for readiness testing.',now(),true)");
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    const staleLegal=await command(db,s,"evaluate_readiness",67,{});
    expect(staleLegal.readiness?.fingerprint).not.toBe(ready.readiness?.fingerprint);
    expect(staleLegal.readiness?.items).toContainEqual(expect.objectContaining({key:"legal_acceptance",status:"blocked"}));
  });

  it("uses exact 60-day timestamp arithmetic across month, leap-year and UK clock changes",async()=>{
    const s=await configured(db);
    await resetTenantDatabaseRole(db);await db.exec("set timezone='Europe/London'");
    const trial=(await db.query<{subscription_id:string;membership_id:string}>("select sub.id subscription_id,m.id membership_id from public.organisation_subscriptions sub join public.organisation_memberships m on m.organisation_id=sub.organisation_id and m.auth_user_id=$2 where sub.organisation_id=$1 and sub.is_current",[s.session.organisationId,USER_A_OWNER])).rows[0];
    await db.query("select private.transition_commercial_subscription($1,'trial_pending','trial_active',true,'2026-03-28 12:00+00'::timestamptz,'2026-03-28 12:00+00'::timestamptz+interval '1440 hours',null,'fixture_exact_trial_window',$2)",[trial.subscription_id,trial.membership_id]);
    const persisted=(await db.query<{seconds:number}>("select extract(epoch from(trial_ends_at-trial_started_at))::int seconds from public.organisation_subscriptions where id=$1",[trial.subscription_id])).rows[0];
    expect(persisted.seconds).toBe(60*24*60*60);
    const values=(await db.query<{start:string;finish:string;seconds:number}>(`select start_at::text start,(start_at+interval '1440 hours')::text finish,extract(epoch from((start_at+interval '1440 hours')-start_at))::int seconds from unnest(array['2028-01-31 12:00+00'::timestamptz,'2028-02-29 12:00+00'::timestamptz,'2026-03-28 12:00+00'::timestamptz,'2026-10-24 12:00+00'::timestamptz])start_at`)).rows;
    expect(values).toHaveLength(4);expect(values.every((value)=>value.seconds===60*24*60*60)).toBe(true);
  });
});
