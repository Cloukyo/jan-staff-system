-- Commercial Workstream 7G: site-bound online kiosk registration and PIN readiness.
-- No Go Live, trial activation, offline authority, attendance evidence or billing-provider behaviour is introduced.

alter table public.kiosk_devices alter column activated_by drop not null;
alter table public.organisation_settings add column kiosk_registration_lifetime_minutes integer not null default 10 check(kiosk_registration_lifetime_minutes between 5 and 20);
alter table public.kiosk_devices drop constraint if exists kiosk_device_revocation;
alter table public.kiosk_devices add constraint kiosk_device_revocation check (
  (active and revoked_by is null and revoked_by_membership_id is null and revoked_at is null)
  or (not active and revoked_at is not null and ((organisation_id is null and revoked_by is not null) or (organisation_id is not null and revoked_by_membership_id is not null)))
);
alter table public.kiosk_devices
  add column registration_id uuid,
  add column credential_revision bigint not null default 1 check(credential_revision>0),
  add column credential_rotated_at timestamptz,
  add column last_heartbeat_at timestamptz,
  add column app_version text check(app_version is null or app_version~'^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$'),
  add column protocol_version integer check(protocol_version is null or protocol_version between 1 and 1000),
  add column platform_category text check(platform_category is null or platform_category in('tablet','desktop','mobile','unknown')),
  add column roster_verified_at timestamptz,
  add column health_revision bigint not null default 0 check(health_revision>=0),
  add constraint kiosk_devices_commercial_activation_actor check(
    organisation_id is null or (activated_by is null and activated_by_membership_id is not null)),
  add constraint kiosk_devices_commercial_offline_setup check(
    organisation_id is null or (offline_enabled=false and hardware_verified_at is null));

create table public.commercial_kiosk_registrations(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  site_id uuid not null,
  requested_by_membership_id uuid not null,
  intended_device_name text not null check(length(btrim(intended_device_name)) between 3 and 100),
  secret_hash bytea not null unique check(octet_length(secret_hash)=32),
  claimant_nonce_hash bytea,
  status text not null default 'pending' check(status in('pending','claimed','verified','expired','revoked','failed')),
  claimed_device_id uuid,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  verified_at timestamptz,
  revoked_at timestamptz,
  replaced_by_registration_id uuid,
  revision bigint not null default 0 check(revision>=0),
  safe_audit_metadata jsonb not null default '{}'::jsonb check(
    jsonb_typeof(safe_audit_metadata)='object' and not(safe_audit_metadata::text~*'(token|secret|password|pin|email|address|name)')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organisation_id,id), unique(organisation_id,site_id,id),
  foreign key(organisation_id,site_id) references public.organisation_sites(organisation_id,id) on delete restrict,
  foreign key(organisation_id,requested_by_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict,
  foreign key(replaced_by_registration_id) references public.commercial_kiosk_registrations(id) on delete restrict,
  check(expires_at>created_at),
  check((status='pending' and claimed_device_id is null and claimed_at is null and verified_at is null and revoked_at is null)
    or (status='claimed' and claimed_device_id is not null and claimed_at is not null and verified_at is null and revoked_at is null)
    or (status='verified' and claimed_device_id is not null and claimed_at is not null and verified_at is not null and revoked_at is null)
    or (status in('expired','failed') and claimed_device_id is null and claimed_at is null and verified_at is null)
    or (status='revoked' and revoked_at is not null))
);
create unique index commercial_kiosk_one_pending_per_site on public.commercial_kiosk_registrations(organisation_id,site_id)
  where status='pending';
create index commercial_kiosk_registration_expiry on public.commercial_kiosk_registrations(status,expires_at);

alter table public.kiosk_devices add constraint kiosk_devices_registration_fk foreign key(registration_id)
  references public.commercial_kiosk_registrations(id) on delete restrict;
alter table public.commercial_kiosk_registrations add constraint commercial_kiosk_claimed_device_fk
  foreign key(organisation_id,site_id,claimed_device_id) references public.kiosk_devices(organisation_id,site_id,id) on delete restrict;

create table public.commercial_kiosk_claim_attempts(
  id bigint generated always as identity primary key,
  registration_id uuid references public.commercial_kiosk_registrations(id) on delete restrict,
  attempt_scope_hash bytea not null check(octet_length(attempt_scope_hash)=32),
  claimant_nonce_hash bytea not null check(octet_length(claimant_nonce_hash)=32),
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index commercial_kiosk_claim_attempt_window on public.commercial_kiosk_claim_attempts(attempt_scope_hash,claimant_nonce_hash,attempted_at desc);

alter table public.commercial_kiosk_registrations enable row level security;
alter table public.commercial_kiosk_claim_attempts enable row level security;
revoke all on public.commercial_kiosk_registrations,public.commercial_kiosk_claim_attempts from public,anon,authenticated;
grant select on public.commercial_kiosk_registrations to authenticated;
create policy commercial_kiosk_registration_manager_read on public.commercial_kiosk_registrations for select to authenticated
  using(private.has_site_permission(organisation_id,site_id,'kiosk.read'));

alter table public.onboarding_command_receipts drop constraint onboarding_command_receipts_command_type_check;
alter table public.onboarding_command_receipts add constraint onboarding_command_receipts_command_type_check check(command_type in(
  'save_step_draft','accept_legal_documents','complete_owner_setup','create_organisation','create_first_site','select_plan','save_settings',
  'save_staff_draft','create_staff','preview_staff_import','review_staff_import_row','commit_staff_import','complete_staffing','skip_staffing',
  'create_manager_invitation','resend_manager_invitation','revoke_manager_invitation','acknowledge_sole_manager','complete_manager_invitation_step',
  'create_staff_invitations','resend_staff_invitation','revoke_staff_invitation','skip_staff_invitation_step','complete_staff_invitation_step',
  'start_kiosk_registration','replace_kiosk_registration','revoke_kiosk_device','set_kiosk_staff_pin','confirm_kiosk_connection','evaluate_readiness','go_live'));
alter table public.onboarding_events drop constraint onboarding_events_event_type_check;
alter table public.onboarding_events drop constraint onboarding_events_actor_type_check;
alter table public.onboarding_events add constraint onboarding_events_actor_type_check check(actor_type in('owner','member','device','system','billing_provider','support'));
alter table public.onboarding_events add constraint onboarding_events_event_type_check check(event_type in(
  'workflow_started','onboarding_started','signup_started','owner_email_verified','owner_mfa_enrolled','owner_mfa_ready','owner_security_completed','legal_acceptance_completed',
  'organisation_creation_started','organisation_created','first_site_started','first_site_validation_failed','first_site_defaults_created','first_site_created',
  'plan_selection_started','plan_selected','trial_selected','trial_pending_created','subscription_step_completed','trial_activated','settings_completed',
  'staff_import_started','staffing_started','staff_manual_created','staff_import_uploaded','staff_import_validated','staff_import_reviewed','staff_import_committed','staffing_skipped','staffing_completed',
  'manager_invitation_step_started','manager_invitation_created','manager_invitation_delivery_failed','manager_invitation_resent','manager_invitation_revoked','manager_invitation_accepted','sole_manager_acknowledged','manager_invitation_step_completed',
  'staff_invitation_step_started','staff_invitation_created','staff_invitation_delivery_failed','staff_invitation_resent','staff_invitation_revoked','staff_invitation_accepted','staff_invitation_step_skipped','staff_invitation_step_completed',
  'kiosk_setup_started','kiosk_registration_started','kiosk_registration_created','kiosk_registration_claimed','kiosk_connected','kiosk_roster_verified','kiosk_pin_readiness_verified','kiosk_revoked','kiosk_replaced','kiosk_setup_completed',
  'readiness_evaluated','go_live_blocked','go_live_completed','workflow_abandoned'));

create or replace function private.commercial_kiosk_registration_secret()
returns text language plpgsql volatile security definer set search_path='' as $$
declare bytes bytea:=extensions.gen_random_bytes(16);alphabet constant text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';answer text:='';i integer;
begin for i in 0..15 loop answer:=answer||substr(alphabet,(get_byte(bytes,i)%32)+1,1);end loop;return answer;end$$;

create or replace function private.commercial_kiosk_snapshot(target_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype;r public.commercial_kiosk_registrations%rowtype;d public.kiosk_devices%rowtype;staff_rows jsonb;eligible_count integer:=0;pin_count integer:=0;offline_count integer:=0;recent boolean:=false;roster_ok boolean:=false;
begin
  select * into s from public.onboarding_sessions where id=target_session_id;
  select * into r from public.commercial_kiosk_registrations where organisation_id=s.organisation_id order by created_at desc limit 1;
  if r.claimed_device_id is not null then select * into d from public.kiosk_devices where id=r.claimed_device_id;end if;
  select coalesce(jsonb_agg(jsonb_build_object('staffId',p.id,'displayName',p.display_name,'siteAssigned',true,'attendanceEligible',true,'pinRequired',true,
    'pinReady',coalesce(k.kiosk_enabled and k.pin_hash is not null and not k.pin_reset_required,false),
    'visibleOnKiosk',coalesce(k.kiosk_enabled and k.pin_hash is not null and not k.pin_reset_required,false)) order by p.display_name,p.id),'[]'::jsonb),
    count(*)::int,count(*) filter(where k.kiosk_enabled and k.pin_hash is not null and not k.pin_reset_required)::int
    into staff_rows,eligible_count,pin_count
    from public.staff_profiles p join public.staff_site_assignments a on a.organisation_id=p.organisation_id and a.staff_id=p.id
    join public.staff_kiosk_settings k on k.staff_id=p.id
    where p.organisation_id=s.organisation_id and p.active and k.onboarding_attendance_eligible
      and a.site_id=coalesce(r.site_id,(select id from public.organisation_sites where organisation_id=s.organisation_id and active and archived_at is null order by created_at limit 1))
      and a.effective_from<=current_date and(a.effective_to is null or a.effective_to>=current_date);
  recent:=d.id is not null and d.active and d.last_heartbeat_at>=now()-interval '5 minutes';
  roster_ok:=d.id is not null and d.roster_verified_at is not null and d.roster_verified_at>=coalesce(d.last_heartbeat_at,d.roster_verified_at)-interval '5 minutes';
  if d.id is not null then
    select count(*)::int into offline_count from public.kiosk_offline_authorisations
    where kiosk_device_id=d.id and revoked_at is null and expires_at>now();
  end if;
  return jsonb_build_object(
    'availableSites',coalesce((select jsonb_agg(jsonb_build_object('siteId',site.id,'displayName',site.name) order by site.name) from public.organisation_sites site where site.organisation_id=s.organisation_id and site.active and site.archived_at is null),'[]'::jsonb),
    'registration',case when r.id is null then null else jsonb_build_object('registrationId',r.id,'siteId',r.site_id,'deviceName',r.intended_device_name,'status',case when r.status='pending' and r.expires_at<=now() then 'expired' else r.status end,'expiresAt',r.expires_at,'claimedDeviceId',r.claimed_device_id,'revision',r.revision::text) end,
    'device',case when d.id is null then null else jsonb_build_object('deviceId',d.id,'siteId',d.site_id,'deviceName',d.device_name,'active',d.active,'status',case when not d.active then 'revoked' when recent then 'connected' when d.last_heartbeat_at is null then 'waiting' else 'connection_problem' end,'lastSeenAt',d.last_heartbeat_at,'appVersion',d.app_version,'protocolVersion',d.protocol_version,'platformCategory',d.platform_category) end,
    'readiness',jsonb_build_object('complete',r.status='verified' and d.active and d.organisation_id=s.organisation_id and d.site_id=r.site_id and recent and roster_ok and eligible_count>0 and pin_count>0 and not d.offline_enabled and offline_count=0,
      'registrationReady',r.status in('claimed','verified'),'deviceActive',coalesce(d.active,false),'bindingValid',d.id is not null and d.organisation_id=s.organisation_id and d.site_id=r.site_id,
      'heartbeatRecent',recent,'rosterVerified',roster_ok,'eligibleStaffCount',eligible_count,'pinReadyStaffCount',pin_count,'offlineDisabled',coalesce(not d.offline_enabled,true),'offlineAuthorisationCount',offline_count),
    'staff',staff_rows);
end$$;

alter function private.commercial_onboarding_snapshot(uuid) rename to commercial_onboarding_snapshot_7f;
alter function public.get_or_create_onboarding_bootstrap() rename to get_or_create_onboarding_bootstrap_7f;
alter function public.get_or_create_onboarding_bootstrap_7f() set schema private;
alter function public.execute_onboarding_bootstrap_command(jsonb) rename to execute_onboarding_bootstrap_command_7f;
alter function public.execute_onboarding_bootstrap_command_7f(jsonb) set schema private;

create or replace function private.commercial_onboarding_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.commercial_onboarding_snapshot_7f(target_session_id)||jsonb_build_object(
    'steps',coalesce((select jsonb_agg(jsonb_build_object('stepKey',step_key,'status',status,'revision',revision::text,'draftPayload',draft_payload,'validationSummary',validation_summary)
      order by case step_key when 'owner_security' then 1 when 'legal_acceptance' then 2 when 'organisation' then 3 when 'first_site' then 4 when 'subscription' then 5 when 'staffing' then 6 when 'manager_invitations' then 7 when 'staff_invitations' then 8 when 'kiosk' then 9 else 99 end)
      from public.onboarding_step_states where session_id=target_session_id and step_key in('owner_security','legal_acceptance','organisation','first_site','subscription','staffing','manager_invitations','staff_invitations','kiosk')),'[]'::jsonb),
    'kiosk',private.commercial_kiosk_snapshot(target_session_id));
$$;

create or replace function public.get_or_create_onboarding_bootstrap()
returns jsonb language plpgsql security definer set search_path='' as $$
declare initial jsonb;target_id uuid;
begin
  initial:=private.get_or_create_onboarding_bootstrap_7f();target_id:=(initial->'session'->>'id')::uuid;
  insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision)
    select id,organisation_id,'kiosk',1,'not_started',0 from public.onboarding_sessions where id=target_id on conflict(session_id,step_key) do nothing;
  update public.commercial_kiosk_registrations set status='expired',revision=revision+1,updated_at=now() where status='pending' and expires_at<=now();
  return private.commercial_onboarding_snapshot(target_id);
end$$;

create or replace function private.execute_kiosk_onboarding_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare s public.onboarding_sessions%rowtype;m public.organisation_memberships%rowtype;receipt public.onboarding_command_receipts%rowtype;existing public.onboarding_command_receipts%rowtype;
  payload jsonb:=command_envelope->'payload';command_type text:=command_envelope->>'commandType';key_value uuid;expected_revision bigint;hash_value text;code text;issues jsonb:='[]';safe_ref jsonb:='{}';response_ref jsonb:='{}';event_name text;raw_secret text;r public.commercial_kiosk_registrations%rowtype;new_registration public.commercial_kiosk_registrations%rowtype;d public.kiosk_devices%rowtype;staff public.staff_profiles%rowtype;kiosk_snapshot jsonb;lifetime_minutes integer:=10;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if jsonb_typeof(command_envelope)<>'object' or jsonb_typeof(payload)<>'object' or command_envelope->>'schemaVersion'<>'1' or command_envelope->>'workflowKey'<>'commercial_customer_v1' or command_envelope->>'workflowVersion'<>'1' or not((command_envelope->>'sessionId')~*'^[0-9a-f-]{36}$') or not((command_envelope->>'idempotencyKey')~*'^[0-9a-f-]{36}$') or not((command_envelope->>'expectedSessionRevision')~'^(0|[1-9][0-9]*)$') then raise exception 'invalid onboarding command envelope' using errcode='22023';end if;
  key_value:=(command_envelope->>'idempotencyKey')::uuid;expected_revision:=(command_envelope->>'expectedSessionRevision')::bigint;hash_value:=private.onboarding_request_digest(command_envelope);
  select * into s from public.onboarding_sessions where id=(command_envelope->>'sessionId')::uuid for update;
  if not found or s.organisation_id is null then code:='permission_denied';end if;
  if code is null then select * into m from public.organisation_memberships where organisation_id=s.organisation_id and auth_user_id=auth.uid() and status='active' for update;if not found then code:='permission_denied';end if;end if;
  if code is null and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then code:='mfa_required';end if;
  if code is null and s.revision<>expected_revision then code:='stale_session_revision';end if;
  select * into existing from public.onboarding_command_receipts where session_id=s.id and command_type=command_type and idempotency_key=key_value;
  if found then
    if code in('permission_denied','mfa_required') then return private.onboarding_command_response(command_envelope,'permission_denied','not_saved',code,'{}',s.revision,'[]',null)||jsonb_build_object('bootstrap',null);end if;
    if existing.request_hash<>hash_value then code:='idempotency_key_reused';
    elsif existing.status in('succeeded','failed_final') then return private.onboarding_command_response(command_envelope,case when existing.status='succeeded' then 'replayed' else existing.result_outcome end,existing.result_data_state,existing.result_code,coalesce(existing.result_reference,'{}'),existing.result_session_revision,coalesce(existing.result_issues,'[]'),coalesce(existing.result_readiness,private.onboarding_foundation_readiness(s.id,existing.id)))||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(s.id));end if;
  end if;
  if existing.id is null then insert into public.onboarding_command_receipts(session_id,organisation_id,command_type,idempotency_key,request_hash,status) values(s.id,s.organisation_id,command_type,key_value,hash_value,'processing') returning * into receipt;else receipt:=existing;end if;
  select kiosk_registration_lifetime_minutes into lifetime_minutes from public.organisation_settings where organisation_id=s.organisation_id;
  if code is null and command_type='start_kiosk_registration' then
    if (select count(*) from jsonb_object_keys(payload))<>2 or not(payload?'siteId' and payload?'deviceName') or payload->>'siteId'!~*'^[0-9a-f-]{36}$' or length(btrim(payload->>'deviceName')) not between 3 and 100 then code:='invalid_kiosk_registration_payload';end if;
    if code is null and not private.has_site_permission(s.organisation_id,(payload->>'siteId')::uuid,'kiosk.manage') then code:='permission_denied';end if;
    if code is null then
      update public.commercial_kiosk_registrations set status='expired',revision=revision+1,updated_at=now() where organisation_id=s.organisation_id and site_id=(payload->>'siteId')::uuid and status='pending' and expires_at<=now();
      if exists(select 1 from public.commercial_kiosk_registrations where organisation_id=s.organisation_id and site_id=(payload->>'siteId')::uuid and status='pending') then code:='registration_already_pending';
      elsif exists(select 1 from public.kiosk_devices where organisation_id=s.organisation_id and site_id=(payload->>'siteId')::uuid and active) then code:='active_device_exists';end if;
    end if;
    if code is null then raw_secret:=private.commercial_kiosk_registration_secret();insert into public.commercial_kiosk_registrations(organisation_id,site_id,requested_by_membership_id,intended_device_name,secret_hash,expires_at,safe_audit_metadata) values(s.organisation_id,(payload->>'siteId')::uuid,m.id,btrim(payload->>'deviceName'),sha256(convert_to(raw_secret,'UTF8')),now()+make_interval(mins=>lifetime_minutes),jsonb_build_object('source','commercial_onboarding')) returning * into r;safe_ref:=jsonb_build_object('kioskRegistrationId',r.id,'siteId',r.site_id);response_ref:=safe_ref;event_name:='kiosk_registration_created';end if;
  elsif code is null and command_type='set_kiosk_staff_pin' then
    if (select count(*) from jsonb_object_keys(payload))<>2 or not(payload?'staffId' and payload?'temporaryPin') or payload->>'staffId'!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$' or payload->>'temporaryPin'!~'^\d{4,6}$' then code:='invalid_kiosk_pin_payload';end if;
    select * into r from public.commercial_kiosk_registrations where organisation_id=s.organisation_id and status in('claimed','verified') order by created_at desc limit 1;
    if code is null and(r.id is null or not private.has_site_permission(s.organisation_id,r.site_id,'kiosk.manage')) then code:='permission_denied';end if;
    if code is null then select * into staff from public.staff_profiles where organisation_id=s.organisation_id and id=payload->>'staffId' and active for update;if not found or not exists(select 1 from public.staff_site_assignments a where a.organisation_id=s.organisation_id and a.site_id=r.site_id and a.staff_id=staff.id and a.effective_from<=current_date and(a.effective_to is null or a.effective_to>=current_date)) then code:='staff_not_eligible';end if;end if;
    if code is null and not public.kiosk_pin_is_acceptable(payload->>'temporaryPin') then code:='weak_pin';end if;
    if code is null then update public.staff_kiosk_settings set kiosk_enabled=true,pin_hash=extensions.crypt(payload->>'temporaryPin',extensions.gen_salt('bf',12)),pin_updated_at=now(),pin_reset_required=false,failed_attempt_count=0,locked_until=null where staff_id=staff.id;if not found then insert into public.staff_kiosk_settings(staff_id,kiosk_enabled,pin_hash,pin_updated_at,pin_reset_required,failed_attempt_count,locked_until,onboarding_attendance_eligible) values(staff.id,true,extensions.crypt(payload->>'temporaryPin',extensions.gen_salt('bf',12)),now(),false,0,null,true);end if;safe_ref:=jsonb_build_object('kioskRegistrationId',r.id);response_ref:=safe_ref;event_name:='kiosk_pin_readiness_verified';end if;
  elsif code is null and command_type='confirm_kiosk_connection' then
    if payload<>'{}'::jsonb then code:='invalid_kiosk_confirmation_payload';end if;
    kiosk_snapshot:=private.commercial_kiosk_snapshot(s.id);
    if code is null and not coalesce((kiosk_snapshot->'readiness'->>'complete')::boolean,false) then code:='kiosk_not_ready';end if;
    if code is null then select * into r from public.commercial_kiosk_registrations where organisation_id=s.organisation_id and status='verified' order by created_at desc limit 1;safe_ref:=jsonb_build_object('kioskRegistrationId',r.id,'kioskDeviceId',r.claimed_device_id,'siteId',r.site_id);response_ref:=safe_ref;event_name:='kiosk_setup_completed';end if;
  elsif code is null and command_type in('revoke_kiosk_device','replace_kiosk_registration') then
    if (select count(*) from jsonb_object_keys(payload))<>1 or not(payload?'registrationId') or payload->>'registrationId'!~*'^[0-9a-f-]{36}$' then code:='invalid_kiosk_registration_reference';end if;
    if code is null then select * into r from public.commercial_kiosk_registrations where id=(payload->>'registrationId')::uuid and organisation_id=s.organisation_id for update;if not found or not private.has_site_permission(s.organisation_id,r.site_id,'kiosk.manage') then code:='permission_denied';end if;end if;
    if code is null and r.status not in('pending','claimed','verified') then code:='registration_not_replaceable';end if;
    if code is null and command_type='replace_kiosk_registration' and exists(select 1 from public.kiosk_devices other_device where other_device.organisation_id=r.organisation_id and other_device.site_id=r.site_id and other_device.active and other_device.id is distinct from r.claimed_device_id) then code:='active_device_exists';end if;
    if code is null then if r.claimed_device_id is not null then update public.kiosk_devices set active=false,revoked_by=null,revoked_by_membership_id=m.id,revoked_at=now(),token_hash=sha256(extensions.gen_random_bytes(32)),credential_revision=credential_revision+1 where id=r.claimed_device_id and active;end if;update public.commercial_kiosk_registrations set status='revoked',revoked_at=coalesce(revoked_at,now()),revision=revision+1,updated_at=now() where id=r.id;
      if command_type='replace_kiosk_registration' then raw_secret:=private.commercial_kiosk_registration_secret();insert into public.commercial_kiosk_registrations(organisation_id,site_id,requested_by_membership_id,intended_device_name,secret_hash,expires_at,safe_audit_metadata) values(r.organisation_id,r.site_id,m.id,r.intended_device_name,sha256(convert_to(raw_secret,'UTF8')),now()+make_interval(mins=>lifetime_minutes),jsonb_build_object('source','commercial_onboarding')) returning * into new_registration;update public.commercial_kiosk_registrations set replaced_by_registration_id=new_registration.id where id=r.id;safe_ref:=jsonb_build_object('kioskRegistrationId',new_registration.id,'kioskDeviceId',r.claimed_device_id,'siteId',r.site_id);event_name:='kiosk_replaced';else safe_ref:=jsonb_build_object('kioskRegistrationId',r.id,'kioskDeviceId',r.claimed_device_id);event_name:='kiosk_revoked';end if;response_ref:=safe_ref;end if;
  elsif code is null then code:='unsupported_kiosk_command';end if;
  if code is not null then issues:=jsonb_build_array(jsonb_build_object('code',code,'message',case when code='stale_session_revision' then 'Onboarding changed after this page was opened. Reload and try again.' else 'Nothing was saved. Review the kiosk setup and try again.' end,'fieldPath','[]'::jsonb,'repairRoute','/onboarding/kiosk'));update public.onboarding_command_receipts set status='failed_final',result_code=code,result_outcome=case when code='stale_session_revision' then 'workflow_changed' when code in('permission_denied','mfa_required') then 'permission_denied' else 'validation_failed' end,result_data_state='not_saved',result_session_revision=s.revision,result_issues=issues,completed_at=now() where id=receipt.id;return private.onboarding_command_response(command_envelope,case when code='stale_session_revision' then 'workflow_changed' when code in('permission_denied','mfa_required') then 'permission_denied' else 'validation_failed' end,'not_saved',code,'{}',s.revision,issues,private.onboarding_foundation_readiness(s.id,receipt.id))||jsonb_build_object('bootstrap',case when code='permission_denied' then null else private.commercial_onboarding_snapshot(s.id) end);end if;
  if event_name='kiosk_setup_completed' then update public.onboarding_step_states set status='complete',revision=revision+1,started_at=coalesce(started_at,now()),completed_at=now(),last_saved_at=now(),completed_by_auth_user_id=auth.uid() where session_id=s.id and step_key='kiosk';update public.onboarding_sessions set current_step_key='readiness',revision=revision+1,last_activity_at=now() where id=s.id returning * into s;else update public.onboarding_step_states set status='in_progress',revision=revision+1,started_at=coalesce(started_at,now()),completed_at=null,last_saved_at=now() where session_id=s.id and step_key='kiosk';update public.onboarding_sessions set current_step_key='kiosk',revision=revision+1,last_activity_at=now() where id=s.id returning * into s;end if;
  insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata) values(s.id,s.organisation_id,event_name,'kiosk','member',auth.uid(),m.id,key_value,s.revision,jsonb_build_object('statusCode',event_name,'resourceCounts',jsonb_build_object('devices',case when event_name in('kiosk_registration_created','kiosk_pin_readiness_verified') then 0 else 1 end)));
  update public.onboarding_command_receipts set status='succeeded',result_code=event_name,result_outcome='succeeded',result_data_state='saved',result_session_revision=s.revision,result_reference=safe_ref,result_issues='[]',completed_at=now() where id=receipt.id;
  return private.onboarding_command_response(command_envelope,'succeeded','saved',event_name,safe_ref,s.revision,'[]',private.onboarding_foundation_readiness(s.id,receipt.id))||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(s.id))||case when raw_secret is null then '{}'::jsonb else jsonb_build_object('oneTimeRegistrationCode',raw_secret,'registrationExpiresAt',coalesce(new_registration.expires_at,r.expires_at)) end;
end$$;

create or replace function public.execute_onboarding_bootstrap_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin
  if command_envelope->>'commandType' in('start_kiosk_registration','replace_kiosk_registration','revoke_kiosk_device','set_kiosk_staff_pin','confirm_kiosk_connection') then return private.execute_kiosk_onboarding_command(command_envelope);end if;
  return private.execute_onboarding_bootstrap_command_7f(command_envelope);
end$$;

create or replace function public.claim_commercial_kiosk(registration_id uuid,registration_secret text,claimant_nonce text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.commercial_kiosk_registrations%rowtype;d public.kiosk_devices%rowtype;nonce_hash bytea;scope_hash bytea;provided_hash bytea;raw_token text;attempts integer;total_attempts integer;
begin
  if registration_secret!~'^[A-HJ-NP-Z2-9]{16}$' or claimant_nonce!~'^[A-Za-z0-9_-]{43,128}$' then return jsonb_build_object('outcome','invalid_code');end if;
  nonce_hash:=sha256(convert_to(claimant_nonce,'UTF8'));provided_hash:=sha256(convert_to(registration_secret,'UTF8'));scope_hash:=coalesce(sha256(convert_to(registration_id::text,'UTF8')),provided_hash);
  select count(*)::int,count(*) filter(where attempt.claimant_nonce_hash=nonce_hash)::int into total_attempts,attempts from public.commercial_kiosk_claim_attempts attempt where attempt.attempt_scope_hash=scope_hash and not attempt.succeeded and attempt.attempted_at>now()-interval '5 minutes';
  if attempts>=6 or total_attempts>=30 then return jsonb_build_object('outcome','rate_limited');end if;
  if registration_id is null then select * into r from public.commercial_kiosk_registrations where secret_hash=provided_hash for update;else select * into r from public.commercial_kiosk_registrations where id=claim_commercial_kiosk.registration_id for update;end if;
  if not found or r.secret_hash<>provided_hash then insert into public.commercial_kiosk_claim_attempts(registration_id,attempt_scope_hash,claimant_nonce_hash,succeeded) values(case when found then r.id else null end,scope_hash,nonce_hash,false);return jsonb_build_object('outcome','invalid_code');end if;
  if r.status='pending' and r.expires_at<=now() then update public.commercial_kiosk_registrations set status='expired',revision=revision+1,updated_at=now() where id=r.id;return jsonb_build_object('outcome','expired');end if;
  if r.status in('expired','revoked','failed') then return jsonb_build_object('outcome',r.status);end if;
  if r.status in('claimed','verified') and r.claimant_nonce_hash<>nonce_hash then return jsonb_build_object('outcome','already_claimed');end if;
  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  if r.status='pending' then
    insert into public.kiosk_devices(device_name,token_hash,active,expires_at,activated_by,organisation_id,site_id,activated_by_membership_id,offline_enabled,hardware_verified_at,registration_id,credential_rotated_at)
      values(r.intended_device_name,sha256(convert_to(raw_token,'UTF8')),true,now()+interval '180 days',null,r.organisation_id,r.site_id,r.requested_by_membership_id,false,null,r.id,now()) returning * into d;
    update public.commercial_kiosk_registrations set status='claimed',claimed_device_id=d.id,claimant_nonce_hash=nonce_hash,claimed_at=now(),revision=revision+1,updated_at=now() where id=r.id;
    insert into public.commercial_kiosk_claim_attempts(registration_id,attempt_scope_hash,claimant_nonce_hash,succeeded) values(r.id,scope_hash,nonce_hash,true);
    insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,workflow_revision,safe_metadata) select s.id,r.organisation_id,'kiosk_registration_claimed','kiosk','device',s.revision,jsonb_build_object('statusCode','claimed','resourceId',d.id) from public.onboarding_sessions s where s.organisation_id=r.organisation_id order by s.created_at limit 1;
    return jsonb_build_object('outcome','claimed','deviceId',d.id,'deviceToken',raw_token,'organisationId',r.organisation_id,'siteId',r.site_id,'expiresAt',d.expires_at);
  end if;
  update public.kiosk_devices set token_hash=sha256(convert_to(raw_token,'UTF8')),credential_revision=credential_revision+1,credential_rotated_at=now(),expires_at=now()+interval '180 days' where id=r.claimed_device_id and active returning * into d;
  if not found then return jsonb_build_object('outcome','revoked');end if;
  return jsonb_build_object('outcome','recovered','deviceId',d.id,'deviceToken',raw_token,'organisationId',d.organisation_id,'siteId',d.site_id,'expiresAt',d.expires_at);
end$$;

create or replace function public.record_commercial_kiosk_heartbeat(device_token text,app_version text,protocol_version integer,platform_category text)
returns jsonb language plpgsql security definer set search_path='' as $$declare d public.kiosk_devices%rowtype;r public.commercial_kiosk_registrations%rowtype;subscription_state text;
begin if device_token is null or length(device_token)<32 or app_version!~'^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$' or protocol_version not between 1 and 1000 or platform_category not in('tablet','desktop','mobile','unknown') then return jsonb_build_object('outcome','invalid_request');end if;
  update public.kiosk_devices set last_used_at=now(),last_heartbeat_at=now(),app_version=record_commercial_kiosk_heartbeat.app_version,protocol_version=record_commercial_kiosk_heartbeat.protocol_version,platform_category=record_commercial_kiosk_heartbeat.platform_category,health_revision=health_revision+1 where token_hash=sha256(convert_to(device_token,'UTF8')) and active and expires_at>now() and organisation_id is not null and offline_enabled=false returning * into d;
  if not found then return jsonb_build_object('outcome','device_rejected');end if;select * into r from public.commercial_kiosk_registrations where id=d.registration_id for update;if found and r.status='claimed' then update public.commercial_kiosk_registrations set status='verified',verified_at=now(),revision=revision+1,updated_at=now() where id=r.id;end if;select state into subscription_state from public.organisation_subscriptions where organisation_id=d.organisation_id and is_current order by created_at desc limit 1;return jsonb_build_object('outcome','connected','deviceId',d.id,'siteId',d.site_id,'healthRevision',(d.health_revision)::text,'preLive',coalesce(subscription_state not in('trial_active','active'),true),'offlineEnabled',false);end$$;

create or replace function public.verify_commercial_kiosk_roster(device_token text)
returns jsonb language plpgsql security definer set search_path='' as $$declare d public.kiosk_devices%rowtype;staff_rows jsonb;
begin select * into d from public.kiosk_devices where token_hash=sha256(convert_to(device_token,'UTF8')) and active and expires_at>now() and organisation_id is not null and offline_enabled=false for update;if not found or d.last_heartbeat_at is null then return jsonb_build_object('outcome','device_rejected','staff','[]'::jsonb);end if;
  select coalesce(jsonb_agg(jsonb_build_object('staffId',p.id,'displayName',p.display_name,'employmentRole',p.employment_role,'pinReady',k.pin_hash is not null and not k.pin_reset_required) order by p.display_name,p.id),'[]'::jsonb) into staff_rows from public.staff_profiles p join public.staff_site_assignments a on a.organisation_id=p.organisation_id and a.staff_id=p.id join public.staff_kiosk_settings k on k.staff_id=p.id where p.organisation_id=d.organisation_id and p.active and k.onboarding_attendance_eligible and a.site_id=d.site_id and a.effective_from<=current_date and(a.effective_to is null or a.effective_to>=current_date);
  update public.kiosk_devices set roster_verified_at=now(),health_revision=health_revision+1 where id=d.id;insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,workflow_revision,safe_metadata) select s.id,d.organisation_id,'kiosk_roster_verified','kiosk','device',s.revision,jsonb_build_object('statusCode','verified','resourceCounts',jsonb_build_object('staff',jsonb_array_length(staff_rows))) from public.onboarding_sessions s where s.organisation_id=d.organisation_id order by s.created_at limit 1;return jsonb_build_object('outcome','verified','siteId',d.site_id,'siteName',(select name from public.organisation_sites where organisation_id=d.organisation_id and id=d.site_id),'staff',staff_rows,'preLive',true);end$$;

alter function public.perform_commercial_kiosk_attendance_action(text,text,text,text,text,uuid) rename to perform_commercial_kiosk_attendance_action_7g;
create or replace function public.perform_commercial_kiosk_attendance_action(device_token text,target_staff_id text,candidate_pin text,requested_action text,expected_revision text,idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare d public.kiosk_devices%rowtype;subscription_state text;
begin select * into d from public.kiosk_devices where token_hash=sha256(convert_to(device_token,'UTF8')) and active and expires_at>now();if not found or d.organisation_id is null then return jsonb_build_object('ok',false,'code','device_required');end if;
  select state into subscription_state from public.organisation_subscriptions where organisation_id=d.organisation_id and is_current order by created_at desc limit 1;
  if subscription_state is null or subscription_state not in('trial_active','active') then return jsonb_build_object('ok',false,'code','pre_live','state','pre_live');end if;
  return public.perform_commercial_kiosk_attendance_action_7g(device_token,target_staff_id,candidate_pin,requested_action,expected_revision,idempotency_key);end$$;

insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision) select id,organisation_id,'kiosk',1,'not_started',0 from public.onboarding_sessions on conflict(session_id,step_key) do nothing;

revoke all on function private.commercial_kiosk_registration_secret(),private.commercial_kiosk_snapshot(uuid),private.commercial_onboarding_snapshot_7f(uuid),private.get_or_create_onboarding_bootstrap_7f(),private.execute_onboarding_bootstrap_command_7f(jsonb),private.execute_kiosk_onboarding_command(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.perform_commercial_kiosk_attendance_action_7g(text,text,text,text,text,uuid),public.perform_commercial_kiosk_attendance_action(text,text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_or_create_onboarding_bootstrap(),public.execute_onboarding_bootstrap_command(jsonb),public.claim_commercial_kiosk(uuid,text,text),public.record_commercial_kiosk_heartbeat(text,text,integer,text),public.verify_commercial_kiosk_roster(text) from public,anon,authenticated,service_role;
grant execute on function public.get_or_create_onboarding_bootstrap(),public.execute_onboarding_bootstrap_command(jsonb) to authenticated;
grant execute on function public.claim_commercial_kiosk(uuid,text,text),public.record_commercial_kiosk_heartbeat(text,text,integer,text),public.verify_commercial_kiosk_roster(text) to anon,authenticated;
grant execute on function public.perform_commercial_kiosk_attendance_action(text,text,text,text,text,uuid) to anon,authenticated;
