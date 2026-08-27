-- Commercial Workstream 7H: authoritative readiness, atomic Go Live and trial activation.
-- Online attendance only. This migration creates no billing-provider or offline authority.

alter table public.organisations
  add column operational_state text not null default 'pre_live'
    check (operational_state in ('pre_live','live')),
  add column went_live_at timestamptz;
alter table public.organisations add constraint organisations_live_timestamp_check
  check ((operational_state='live')=(went_live_at is not null));
alter table public.organisation_subscriptions drop constraint organisation_subscriptions_check1;
alter table public.organisation_subscriptions add constraint organisation_subscriptions_exact_trial_window_check
  check (state<>'trial_active' or (ordinary_initial_trial and trial_duration_days=60 and trial_started_at is not null
    and trial_ends_at=trial_started_at+interval '1440 hours'));
revoke update on public.organisations from authenticated;
grant update(legal_name,display_name,slug,status,country_code,timezone,billing_email,archived_at,updated_at,
  contact_email,contact_phone,address_line_1,address_line_2,locality,region,postcode,logo_metadata)
  on public.organisations to authenticated;

create table public.onboarding_readiness_snapshots(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.onboarding_sessions(id) on delete restrict,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  evaluator_version integer not null check(evaluator_version=2),
  workflow_revision bigint not null check(workflow_revision>=0),
  fingerprint text not null check(fingerprint~'^[0-9a-f]{64}$'),
  overall_status text not null check(overall_status in('blocked','ready','live','degraded')),
  blocker_count integer not null check(blocker_count>=0),
  warning_count integer not null check(warning_count>=0),
  items jsonb not null check(jsonb_typeof(items)='array' and not(items::text~*'(token|secret|password|pin_hash|email|address|staff_name)')),
  evaluated_by_auth_user_id uuid references auth.users(id) on delete restrict,
  evaluated_at timestamptz not null default now(),
  unique(organisation_id,id),
  foreign key(session_id,organisation_id) references public.onboarding_sessions(id,organisation_id) on delete restrict
);
create index onboarding_readiness_session_time on public.onboarding_readiness_snapshots(session_id,evaluated_at desc);

create table public.organisation_lifecycle_audit_events(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  event_type text not null check(event_type in('organisation_went_live')),
  actor_auth_user_id uuid references auth.users(id) on delete restrict,
  actor_membership_id uuid not null,
  request_id uuid not null,
  safe_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(safe_metadata)='object' and not(safe_metadata::text~*'(token|secret|password|pin|email|address|name)')),
  occurred_at timestamptz not null default now(),
  foreign key(organisation_id,actor_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict,
  unique(organisation_id,request_id,event_type)
);

alter table public.onboarding_readiness_snapshots enable row level security;
alter table public.organisation_lifecycle_audit_events enable row level security;
revoke all on public.onboarding_readiness_snapshots,public.organisation_lifecycle_audit_events from public,anon,authenticated;
grant select on public.onboarding_readiness_snapshots,public.organisation_lifecycle_audit_events to authenticated;
create policy onboarding_readiness_owner_read on public.onboarding_readiness_snapshots for select to authenticated
  using(private.has_permission(organisation_id,'organisation.manage'));
create policy organisation_lifecycle_audit_read on public.organisation_lifecycle_audit_events for select to authenticated
  using(private.has_permission(organisation_id,'organisation.audit.read'));

create or replace function private.prevent_commercial_audit_mutation()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'commercial lifecycle evidence is append-only' using errcode='23514';end$$;
create trigger onboarding_readiness_no_mutation before update or delete on public.onboarding_readiness_snapshots
  for each row execute function private.prevent_commercial_audit_mutation();
create trigger organisation_lifecycle_no_mutation before update or delete on public.organisation_lifecycle_audit_events
  for each row execute function private.prevent_commercial_audit_mutation();

create or replace function private.protect_organisation_live_state()
returns trigger language plpgsql set search_path='' as $$begin
  if (new.operational_state is distinct from old.operational_state or new.went_live_at is distinct from old.went_live_at)
     and coalesce(current_setting('app.commercial_go_live',true),'')<>old.id::text then
    raise exception 'organisation live state requires the guarded Go Live boundary' using errcode='42501';
  end if;
  if old.went_live_at is not null and new.went_live_at is distinct from old.went_live_at then
    raise exception 'organisation Go Live time is immutable' using errcode='23514';
  end if;
  return new;
end$$;
create trigger organisations_protect_live_state before update of operational_state,went_live_at on public.organisations
  for each row execute function private.protect_organisation_live_state();

create or replace function private.commercial_readiness_item(
  item_key text,category_key text,is_ready boolean,severity_value text,title_value text,
  ready_explanation text,blocked_explanation text,repair_route text,evidence_revision text,
  nonready_status text default 'blocked'
) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('key',item_key,'category',category_key,'status',case when is_ready then 'ready' else nonready_status end,
    'severity',severity_value,'title',title_value,'explanation',case when is_ready then ready_explanation else blocked_explanation end,
    'remediationRoute',case when is_ready then null else repair_route end,'evidenceRevision',evidence_revision)
$$;

create or replace function private.commercial_onboarding_readiness(target_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype;o public.organisations%rowtype;sub public.organisation_subscriptions%rowtype;
  site public.organisation_sites%rowtype;device public.kiosk_devices%rowtype;items jsonb;critical jsonb;fingerprint text;
  owner_ok boolean;legal_ok boolean;org_settings_ok boolean;site_settings_ok boolean;operating_ok boolean;subscription_ok boolean;entitlements_ok boolean;
  staff_count integer:=0;assignment_count integer:=0;eligible_count integer:=0;pin_count integer:=0;manager_count integer:=0;pending_managers integer:=0;pending_staff integer:=0;broken_links integer:=0;
  roster_state jsonb:='[]'::jsonb;roster_source_updated_at timestamptz;
  registration_ok boolean:=false;heartbeat_ok boolean:=false;roster_ok boolean:=false;offline_count integer:=0;prelive_events integer:=0;attendance_safe boolean:=false;
  blocker_count integer;warning_count integer;overall text;evaluated timestamptz:=clock_timestamp();operational_date date;
begin
  select * into s from public.onboarding_sessions where id=target_session_id;
  if not found or s.organisation_id is null then raise exception 'onboarding session unavailable' using errcode='42501';end if;
  select * into o from public.organisations where id=s.organisation_id;
  select * into sub from public.organisation_subscriptions where organisation_id=o.id and is_current order by created_at desc limit 1;
  select * into site from public.organisation_sites where organisation_id=o.id and active and archived_at is null order by created_at,id limit 1;
  operational_date:=(evaluated at time zone coalesce(site.timezone,o.timezone,'Europe/London'))::date;
  select * into device from public.kiosk_devices where organisation_id=o.id and site_id=site.id order by active desc,created_at desc limit 1;
  owner_ok:=exists(select 1 from auth.users u join public.organisation_memberships m on m.auth_user_id=u.id and m.organisation_id=o.id and m.status='active'
    join public.membership_role_assignments r on r.organisation_id=m.organisation_id and r.membership_id=m.id and r.role='organisation_owner' and r.scope_type='organisation' and r.revoked_at is null
    where u.id=s.owner_auth_user_id and u.email_confirmed_at is not null)
    and coalesce(auth.jwt()->>'aal','aal1')='aal2';
  legal_ok:=not exists(select 1 from public.legal_document_versions d where d.is_current and d.locale='en-GB' and not exists(
    select 1 from public.legal_acceptances a where a.auth_user_id=s.owner_auth_user_id and a.onboarding_session_id=s.id and a.document_type=d.document_type and a.document_version=d.document_version and a.locale=d.locale));
  org_settings_ok:=o.country_code='GB' and o.timezone='Europe/London' and exists(
    select 1 from public.organisation_settings os where os.organisation_id=o.id and os.default_timezone=o.timezone and os.work_week_starts between 1 and 7);
  site_settings_ok:=site.id is not null and site.country_code='GB' and site.timezone='Europe/London' and exists(
    select 1 from public.site_settings ss where ss.organisation_id=o.id and ss.site_id=site.id and coalesce(ss.timezone_override,site.timezone)=site.timezone
      and coalesce(ss.work_week_starts_override,(select os.work_week_starts from public.organisation_settings os where os.organisation_id=o.id)) between 1 and 7);
  operating_ok:=site_settings_ok and exists(select 1 from public.site_settings ss where ss.organisation_id=o.id and ss.site_id=site.id and ss.opening_time is not null and ss.closing_time>ss.opening_time
    and jsonb_typeof(ss.operating_overrides->'openingHours')='array' and ss.operating_overrides->>'operationalDayBoundary'~'^(0[0-5]:[0-5][0-9]|06:00)$');
  subscription_ok:=sub.id is not null and ((o.operational_state='pre_live' and sub.state='trial_pending' and sub.trial_started_at is null and sub.trial_ends_at is null)
    or(o.operational_state='live' and sub.state in('trial_active','active')));
  entitlements_ok:=sub.id is not null and exists(select 1 from public.organisation_entitlements e where e.organisation_id=o.id and e.subscription_id=sub.id and e.capability_key='attendance.core' and e.value_type='boolean' and e.boolean_value)
    and exists(select 1 from public.organisation_entitlements e where e.organisation_id=o.id and e.subscription_id=sub.id and e.capability_key='attendance.offline' and e.value_type='boolean' and not e.boolean_value);
  select count(*)::int into staff_count from public.staff_profiles p where p.organisation_id=o.id and p.active;
  select count(distinct a.staff_id)::int into assignment_count from public.staff_site_assignments a join public.staff_profiles p on p.organisation_id=a.organisation_id and p.id=a.staff_id and p.active
    where a.organisation_id=o.id and a.site_id=site.id and a.effective_from<=operational_date and(a.effective_to is null or a.effective_to>=operational_date);
  select count(*)::int,count(*) filter(where k.kiosk_enabled and k.pin_hash is not null and not k.pin_reset_required)::int into eligible_count,pin_count
    from public.staff_profiles p join public.staff_site_assignments a on a.organisation_id=p.organisation_id and a.staff_id=p.id and a.site_id=site.id
    join public.staff_kiosk_settings k on k.staff_id=p.id where p.organisation_id=o.id and p.active and k.onboarding_attendance_eligible
      and a.effective_from<=operational_date and(a.effective_to is null or a.effective_to>=operational_date);
  select coalesce(jsonb_agg(jsonb_build_array(p.id,k.onboarding_attendance_eligible,k.kiosk_enabled,k.pin_hash is not null,k.pin_reset_required) order by p.id),'[]'::jsonb),
    max(greatest(p.updated_at,a.updated_at,k.updated_at)) into roster_state,roster_source_updated_at
    from public.staff_profiles p join public.staff_site_assignments a on a.organisation_id=p.organisation_id and a.staff_id=p.id and a.site_id=site.id
    join public.staff_kiosk_settings k on k.staff_id=p.id where p.organisation_id=o.id and p.active
      and a.effective_from<=operational_date and(a.effective_to is null or a.effective_to>=operational_date);
  select count(distinct m.id)::int into manager_count from public.organisation_memberships m join public.membership_role_assignments r on r.organisation_id=m.organisation_id and r.membership_id=m.id and r.revoked_at is null
    where m.organisation_id=o.id and m.status='active' and r.role in('organisation_owner','organisation_admin','site_manager');
  select count(*) filter(where invitation_kind='manager' and status='pending')::int,count(*) filter(where invitation_kind='staff' and status='pending')::int into pending_managers,pending_staff
    from public.organisation_invitations where organisation_id=o.id;
  select count(*)::int into broken_links from public.staff_profiles p where p.organisation_id=o.id and p.auth_user_id is not null and not exists(
    select 1 from public.organisation_memberships m where m.organisation_id=o.id and m.auth_user_id=p.auth_user_id and m.staff_id=p.id and m.status='active');
  registration_ok:=device.id is not null and device.active and device.token_hash is not null and device.expires_at>evaluated and device.registration_id is not null and exists(
    select 1 from public.commercial_kiosk_registrations r where r.id=device.registration_id and r.organisation_id=o.id and r.site_id=site.id and r.claimed_device_id=device.id and r.status='verified');
  heartbeat_ok:=registration_ok and device.last_heartbeat_at>=evaluated-interval '5 minutes';
  roster_ok:=heartbeat_ok and device.roster_verified_at>=evaluated-interval '5 minutes'
    and device.roster_verified_at>=coalesce(roster_source_updated_at,device.roster_verified_at);
  select count(*)::int into offline_count from public.kiosk_devices d left join public.kiosk_offline_authorisations a on a.kiosk_device_id=d.id and a.revoked_at is null and a.expires_at>evaluated
    where d.organisation_id=o.id and(d.offline_enabled or a.id is not null);
  select count(*)::int into prelive_events from public.clock_events e where e.organisation_id=o.id and o.operational_state='pre_live';
  attendance_safe:=site.id is not null and registration_ok and eligible_count>0 and pin_count>0 and prelive_events=0;
  items:=jsonb_build_array(
    private.commercial_readiness_item('owner_security','account',owner_ok,'blocker','Owner account','Your verified owner account and multi-factor authentication are ready.','Verify the owner account and complete multi-factor authentication.','/onboarding','owner:'||s.revision),
    private.commercial_readiness_item('legal_acceptance','account',legal_ok,'blocker','Legal documents','Current legal documents are accepted.','Accept the current legal documents before going live.','/onboarding/legal','legal:'||legal_ok::int),
    private.commercial_readiness_item('organisation_active','organisation',o.archived_at is null and o.status in('trial','active'),'blocker','Organisation','Your organisation is active.','Restore the organisation before going live.','/onboarding/organisation','organisation:'||o.status::text||':'||coalesce(o.archived_at::text,'active')),
    private.commercial_readiness_item('organisation_settings','organisation',org_settings_ok,'blocker','Organisation settings','Required organisation settings are ready.','Review organisation settings.','/onboarding/organisation','organisation_settings:'||org_settings_ok::int),
    private.commercial_readiness_item('ownership_state','organisation',manager_count>0,'blocker','Ownership','An active organisation owner is present.','Restore an active organisation owner.','/onboarding/managers','ownership:'||manager_count),
    private.commercial_readiness_item('first_site','site',site.id is not null,'blocker','First site','Your first site is active.','Create and activate your first site.','/onboarding/site','site:'||coalesce(site.id::text,'missing')),
    private.commercial_readiness_item('site_settings','site',site_settings_ok,'blocker','Site settings','Required site settings are ready.','Review the site settings.','/onboarding/site','site_settings:'||site_settings_ok::int),
    private.commercial_readiness_item('site_operating_configuration','site',operating_ok,'blocker','Operating hours','Operating hours and operational day settings are valid.','Correct the site operating hours.','/onboarding/site','operating:'||operating_ok::int),
    private.commercial_readiness_item('subscription_pending','plan',subscription_ok,'blocker','Free trial','The selected plan is ready to start.','Review the selected free-trial plan.','/onboarding/plan','subscription:'||coalesce(sub.id::text,'missing')||':'||coalesce(sub.state,'missing')),
    private.commercial_readiness_item('entitlements_materialised','plan',entitlements_ok,'blocker','Plan access','Core online attendance access is prepared.','Review plan access before going live.','/onboarding/plan','entitlements:'||entitlements_ok::int),
    private.commercial_readiness_item('staff_present','staff',staff_count>0,'blocker','Staff','At least one active staff member is present.','Add an active staff member.','/onboarding/staffing','staff:'||staff_count),
    private.commercial_readiness_item('staff_site_assignment','staff',assignment_count>0,'blocker','Site assignments','At least one staff member is assigned to this site.','Assign a staff member to the first site.','/onboarding/staffing','assignments:'||assignment_count),
    private.commercial_readiness_item('attendance_eligible_staff','staff',eligible_count>0,'blocker','Attendance eligibility','At least one staff member is eligible for attendance.','Make at least one assigned staff member attendance eligible.','/onboarding/staffing','eligible:'||eligible_count),
    private.commercial_readiness_item('manager_coverage','managers',manager_count>1,'warning','Manager coverage','Manager coverage is ready.','The owner is currently the sole manager. You can continue after acknowledging this.','/onboarding/managers','managers:'||manager_count,'warning'),
    private.commercial_readiness_item('staff_account_linkage','staff_accounts',broken_links=0 and pending_staff=0,'warning','Staff accounts','Staff account links are consistent.','Some optional staff account invitations or links still need attention.','/onboarding/staff-invitations','staff_accounts:'||broken_links||':'||pending_staff,'warning'),
    private.commercial_readiness_item('online_kiosk','clocking_device',registration_ok,'blocker','Clocking device','An active site-bound device is registered.','Reconnect or replace the clocking device.','/onboarding/kiosk','device:'||coalesce(device.id::text,'missing')||':'||coalesce(device.health_revision,0)),
    private.commercial_readiness_item('kiosk_heartbeat','clocking_device',heartbeat_ok,'blocker','Device connection','The clocking device has checked in recently.','Open the clocking device and restore its connection.','/onboarding/kiosk','heartbeat:'||coalesce(device.last_heartbeat_at::text,'missing')),
    private.commercial_readiness_item('kiosk_roster','clocking_device',roster_ok,'blocker','Kiosk roster','The clocking device recently verified its staff roster.','Refresh the staff roster on the clocking device.','/onboarding/kiosk','roster:'||coalesce(device.roster_verified_at::text,'missing')),
    private.commercial_readiness_item('pin_ready_staff','clocking_device',pin_count>0,'blocker','PIN readiness','At least one eligible staff member has a usable PIN.','Complete PIN setup for an eligible staff member.','/onboarding/kiosk','pin_ready:'||pin_count),
    private.commercial_readiness_item('attendance_safety','attendance',attendance_safe,'blocker','Attendance safety','The online attendance path is safely tenant-bound.','Resolve attendance setup before going live.','/onboarding/kiosk','attendance:'||attendance_safe::int),
    private.commercial_readiness_item('pre_live_evidence','attendance',prelive_events=0,'blocker','Pre-live evidence','No attendance evidence was created during setup.','Contact support because attendance evidence exists before Go Live.',null,'evidence:'||prelive_events),
    private.commercial_readiness_item('offline_disabled','attendance',offline_count=0 and coalesce(not device.offline_enabled,true),'blocker','Offline attendance','Offline attendance remains disabled.','Disable offline attendance before going live.',null,'offline:'||offline_count||':'||coalesce(device.offline_enabled,false)::int),
    private.commercial_readiness_item('initial_rota','staff',false,'optional','Initial rota','An initial rota is available.','A rota is optional and can be created after Go Live.','/rota','rota:optional','not_applicable'),
    private.commercial_readiness_item('compliance_follow_up','organisation',false,'warning','Compliance follow-up','Configured compliance requirements are ready.','Industry compliance records can be completed after Go Live.','/compliance','compliance:post_live','warning'));
  select count(*) filter(where value->>'severity'='blocker' and value->>'status'<>'ready')::int,
    count(*) filter(where value->>'severity'='warning' and value->>'status'='warning')::int into blocker_count,warning_count from jsonb_array_elements(items)value;
  critical:=jsonb_build_object('sessionRevision',s.revision,'owner',owner_ok,'legal',legal_ok,'organisation',jsonb_build_array(o.id,o.operational_state,o.status,o.archived_at,o.country_code,o.timezone,org_settings_ok),
    'site',jsonb_build_array(site.id,site.active,site.archived_at,site.country_code,site.timezone,site_settings_ok,operating_ok),'subscription',jsonb_build_array(sub.id,sub.state,sub.plan_key,sub.plan_version,sub.ordinary_initial_trial,sub.trial_started_at,sub.trial_ends_at,entitlements_ok),
    'staff',jsonb_build_array(staff_count,assignment_count,eligible_count,pin_count,broken_links,roster_state),'managers',jsonb_build_array(manager_count,pending_managers,pending_staff),
    'kiosk',jsonb_build_array(device.id,device.active,registration_ok,heartbeat_ok,roster_ok,coalesce(device.offline_enabled,false)),'attendance',jsonb_build_array(prelive_events,offline_count));
  fingerprint:=encode(extensions.digest(critical::text,'sha256'),'hex');
  overall:=case when o.operational_state='live' and blocker_count=0 then 'live' when o.operational_state='live' then 'degraded' when blocker_count=0 then 'ready' else 'blocked' end;
  return jsonb_build_object('evaluatorVersion',2,'sessionId',s.id,'organisationId',o.id,'workflowRevision',s.revision::text,'fingerprint',fingerprint,
    'overallStatus',overall,'blockerCount',blocker_count,'warningCount',warning_count,'progressPercent',case when blocker_count=0 then 100 else greatest(0,100-blocker_count*5) end,
    'evaluatedAt',evaluated,'items',items);
end$$;

alter function private.commercial_onboarding_snapshot(uuid) rename to commercial_onboarding_snapshot_7g;
alter function public.get_or_create_onboarding_bootstrap() rename to get_or_create_onboarding_bootstrap_7g;
alter function public.get_or_create_onboarding_bootstrap_7g() set schema private;
alter function public.execute_onboarding_bootstrap_command(jsonb) rename to execute_onboarding_bootstrap_command_7g;
alter function public.execute_onboarding_bootstrap_command_7g(jsonb) set schema private;

create or replace function private.commercial_live_summary(target_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when o.operational_state<>'live' then null else jsonb_build_object('organisationId',o.id,'organisationName',o.display_name,
    'siteId',site.id,'siteName',site.name,'subscriptionId',sub.id,'subscriptionState',sub.state,'trialStartedAt',sub.trial_started_at,'trialEndsAt',sub.trial_ends_at,
    'staffCount',(select count(*)::int from public.staff_profiles p where p.organisation_id=o.id and p.active),'kioskConnected',exists(select 1 from public.kiosk_devices d where d.organisation_id=o.id and d.site_id=site.id and d.active and d.last_heartbeat_at>=now()-interval '5 minutes'),
    'offlineEnabled',exists(select 1 from public.kiosk_devices d where d.organisation_id=o.id and d.offline_enabled)) end
  from public.onboarding_sessions s join public.organisations o on o.id=s.organisation_id
  join lateral(select * from public.organisation_sites x where x.organisation_id=o.id order by x.active desc,x.created_at limit 1)site on true
  join public.organisation_subscriptions sub on sub.organisation_id=o.id and sub.is_current where s.id=target_session_id
$$;

create or replace function private.commercial_onboarding_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.commercial_onboarding_snapshot_7g(target_session_id)||jsonb_build_object(
    'steps',coalesce((select jsonb_agg(jsonb_build_object('stepKey',step_key,'status',status,'revision',revision::text,'draftPayload',draft_payload,'validationSummary',validation_summary)
      order by case step_key when 'owner_security' then 1 when 'legal_acceptance' then 2 when 'organisation' then 3 when 'first_site' then 4 when 'subscription' then 5 when 'staffing' then 6 when 'manager_invitations' then 7 when 'staff_invitations' then 8 when 'kiosk' then 9 when 'readiness' then 10 when 'go_live' then 11 else 99 end)
      from public.onboarding_step_states where session_id=target_session_id and step_key in('owner_security','legal_acceptance','organisation','first_site','subscription','staffing','manager_invitations','staff_invitations','kiosk','readiness','go_live')),'[]'::jsonb),
    'readiness',case when (select organisation_id from public.onboarding_sessions where id=target_session_id) is null then null else private.commercial_onboarding_readiness(target_session_id) end,
    'liveSummary',private.commercial_live_summary(target_session_id));
$$;

create or replace function public.get_or_create_onboarding_bootstrap()
returns jsonb language plpgsql security definer set search_path='' as $$declare initial jsonb;target uuid;begin
  initial:=private.get_or_create_onboarding_bootstrap_7g();target:=(initial->'session'->>'id')::uuid;
  insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision)
    select id,organisation_id,key,1,'not_started',0 from public.onboarding_sessions cross join unnest(array['readiness','go_live'])key where id=target
    on conflict(session_id,step_key) do nothing;
  return private.commercial_onboarding_snapshot(target);
end$$;

create or replace function private.execute_readiness_go_live_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype;m public.organisation_memberships%rowtype;receipt public.onboarding_command_receipts%rowtype;existing public.onboarding_command_receipts%rowtype;
  command_type_value text:=command_envelope->>'commandType';payload jsonb:=command_envelope->'payload';key_value uuid;expected bigint;request_hash text;readiness jsonb;issues jsonb;code text;
  snapshot_id uuid;sub public.organisation_subscriptions%rowtype;started timestamptz;warning_ack boolean:=false;reference jsonb:='{}';event_name text;
begin
  if command_envelope is null or jsonb_typeof(command_envelope)<>'object' or command_type_value not in('evaluate_readiness','go_live')
    or not coalesce(command_envelope->>'sessionId','')~*'^[0-9a-f-]{36}$' or not coalesce(command_envelope->>'idempotencyKey','')~*'^[0-9a-f-]{36}$'
    or not coalesce(command_envelope->>'expectedSessionRevision','')~'^(0|[1-9][0-9]*)$' or jsonb_typeof(payload)<>'object' then raise exception 'invalid readiness command' using errcode='22023';end if;
  key_value:=(command_envelope->>'idempotencyKey')::uuid;expected:=(command_envelope->>'expectedSessionRevision')::bigint;request_hash:=private.onboarding_request_digest(command_envelope);
  select * into s from public.onboarding_sessions where id=(command_envelope->>'sessionId')::uuid for update;
  if not found or auth.uid() is null or s.owner_auth_user_id<>auth.uid() or s.organisation_id is null then
    return private.onboarding_command_response(command_envelope,'permission_denied','not_saved','permission_denied','{}',expected,jsonb_build_array(jsonb_build_object('code','permission_denied','message','This onboarding command is not available.','fieldPath','[]'::jsonb,'repairRoute',null)),null)||jsonb_build_object('bootstrap',null);
  end if;
  select * into m from public.organisation_memberships where organisation_id=s.organisation_id and auth_user_id=auth.uid() and status='active' and private.has_permission(s.organisation_id,'billing.manage') for update;
  if not found then code:='permission_denied';elsif coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then code:='mfa_required';end if;
  if code is null then select * into existing from public.onboarding_command_receipts r where r.session_id=s.id and r.command_type=command_type_value and r.idempotency_key=key_value;
    if found then if existing.request_hash<>request_hash then code:='idempotency_key_reused';elsif existing.status in('succeeded','failed_final') then
      return private.onboarding_command_response(command_envelope,case when existing.status='succeeded' then 'replayed' else existing.result_outcome end,existing.result_data_state,existing.result_code,existing.result_reference,existing.result_session_revision,existing.result_issues,
        private.commercial_onboarding_readiness(s.id))||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(s.id));end if;end if;end if;
  if code is null then insert into public.onboarding_command_receipts(session_id,organisation_id,command_type,idempotency_key,request_hash,status) values(s.id,s.organisation_id,command_type_value,key_value,request_hash,'processing') returning * into receipt;end if;
  if code is null and s.revision<>expected then code:='stale_session_revision';end if;
  if code is null and command_type_value='evaluate_readiness' and payload<>'{}'::jsonb then code:='invalid_readiness_payload';end if;
  if code is null and command_type_value='go_live' then
    if (select count(*) from jsonb_object_keys(payload))<>2 or not(payload?'readinessFingerprint') or not(payload?'acknowledgedWarnings')
      or payload->>'readinessFingerprint'!~'^[0-9a-f]{64}$' or jsonb_typeof(payload->'acknowledgedWarnings')<>'array'
      or exists(select 1 from jsonb_array_elements_text(payload->'acknowledgedWarnings')w where w<>'sole_manager') then code:='invalid_go_live_confirmation';end if;
  end if;
  if code is null then readiness:=private.commercial_onboarding_readiness(s.id);end if;
  if code is null and command_type_value='go_live' then
    if payload->>'readinessFingerprint'<>readiness->>'fingerprint' then code:='readiness_changed';
    elsif readiness->>'overallStatus'<>'ready' then code:='readiness_blocked';
    elsif exists(select 1 from jsonb_array_elements(readiness->'items')i where i->>'key'='manager_coverage' and i->>'status'='warning')
      and not(payload->'acknowledgedWarnings'?'sole_manager') and not exists(select 1 from public.onboarding_events e where e.session_id=s.id and e.event_type='sole_manager_acknowledged') then code:='warning_acknowledgement_required';end if;
    select * into sub from public.organisation_subscriptions where organisation_id=s.organisation_id and is_current for update;
    if code is null and(sub.id is null or sub.state<>'trial_pending' or not sub.ordinary_initial_trial or sub.trial_started_at is not null or sub.trial_ends_at is not null) then code:='subscription_not_eligible';end if;
  end if;
  if code is not null then
    issues:=jsonb_build_array(jsonb_build_object('code',code,'message',case code when 'mfa_required' then 'Complete multi-factor authentication before going live.' when 'stale_session_revision' then 'Onboarding changed after this page was opened. Reload and try again.' when 'readiness_changed' then 'Setup changed after this review. Reload the latest readiness before going live.' when 'readiness_blocked' then 'Resolve every setup item marked Needs attention before going live.' when 'warning_acknowledgement_required' then 'Acknowledge the sole-manager warning before going live.' else 'Nothing was saved. Review setup and try again.' end,'fieldPath','[]'::jsonb,'repairRoute',case when code='mfa_required' then '/mfa' else '/onboarding/readiness' end));
    if receipt.id is not null then update public.onboarding_command_receipts set status='failed_final',result_code=code,result_outcome=case when code in('stale_session_revision','readiness_changed') then 'workflow_changed' when code in('mfa_required','permission_denied') then 'permission_denied' else 'validation_failed' end,result_data_state='not_saved',result_session_revision=s.revision,result_issues=issues,completed_at=now() where id=receipt.id;end if;
    if command_type_value='go_live' and receipt.id is not null then insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata) values(s.id,s.organisation_id,'go_live_blocked','go_live','owner',auth.uid(),m.id,key_value,s.revision,jsonb_build_object('statusCode',code)) on conflict do nothing;end if;
    return private.onboarding_command_response(command_envelope,case when code in('stale_session_revision','readiness_changed') then 'workflow_changed' when code in('mfa_required','permission_denied') then 'permission_denied' else 'validation_failed' end,'not_saved',code,'{}',s.revision,issues,readiness)||jsonb_build_object('bootstrap',case when code='permission_denied' then null else private.commercial_onboarding_snapshot(s.id) end);
  end if;
  if command_type_value='evaluate_readiness' then
    if s.status<>'live' and (exists(select 1 from public.onboarding_step_states where session_id=s.id and step_key='readiness'
      and status is distinct from (case when readiness->>'overallStatus'='ready' then 'complete' else 'blocked' end))
      or s.status is distinct from (case when readiness->>'overallStatus'='ready' then 'ready' else 'needs_attention' end)) then
      update public.onboarding_step_states set status=case when readiness->>'overallStatus'='ready' then 'complete' else 'blocked' end,revision=revision+1,started_at=coalesce(started_at,now()),completed_at=case when readiness->>'overallStatus'='ready' then now() else null end,last_saved_at=now(),completed_by_auth_user_id=case when readiness->>'overallStatus'='ready' then auth.uid() else null end where session_id=s.id and step_key='readiness';
      update public.onboarding_sessions set status=case when readiness->>'overallStatus'='ready' then 'ready' else 'needs_attention' end,current_step_key=case when readiness->>'overallStatus'='ready' then 'go_live' else 'readiness' end,ready_at=case when readiness->>'overallStatus'='ready' then coalesce(ready_at,now()) else null end,revision=revision+1,last_activity_at=now() where id=s.id returning * into s;
      readiness:=private.commercial_onboarding_readiness(s.id);
    end if;
    insert into public.onboarding_readiness_snapshots(session_id,organisation_id,evaluator_version,workflow_revision,fingerprint,overall_status,blocker_count,warning_count,items,evaluated_by_auth_user_id,evaluated_at)
      values(s.id,s.organisation_id,2,s.revision,readiness->>'fingerprint',readiness->>'overallStatus',(readiness->>'blockerCount')::int,(readiness->>'warningCount')::int,readiness->'items',auth.uid(),(readiness->>'evaluatedAt')::timestamptz) returning id into snapshot_id;
    insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata) values(s.id,s.organisation_id,'readiness_evaluated','readiness','owner',auth.uid(),m.id,key_value,s.revision,jsonb_build_object('statusCode',readiness->>'overallStatus','resourceCounts',jsonb_build_object('blockers',(readiness->>'blockerCount')::int,'warnings',(readiness->>'warningCount')::int)));
    reference:=jsonb_build_object('readinessSnapshotId',snapshot_id,'organisationId',s.organisation_id);
    update public.onboarding_command_receipts set status='succeeded',result_code='readiness_evaluated',result_outcome='succeeded',result_data_state='saved',result_session_revision=s.revision,result_reference=reference,result_issues='[]',completed_at=now() where id=receipt.id;
    return private.onboarding_command_response(command_envelope,'succeeded','saved','readiness_evaluated',reference,s.revision,'[]',readiness)||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(s.id));
  end if;
  started:=clock_timestamp();
  perform set_config('app.commercial_go_live',s.organisation_id::text,true);
  update public.organisations set operational_state='live',went_live_at=started,updated_at=started where id=s.organisation_id;
  perform private.transition_commercial_subscription(sub.id,'trial_pending','trial_active',true,started,started+interval '1440 hours',null,'go_live_trial_activation',m.id);
  insert into public.organisation_entitlements(organisation_id,subscription_id,capability_key,value_type,boolean_value,integer_value,source_plan_key,source_plan_version,effective_at,superseded_at)
    select s.organisation_id,sub.id,p.capability_key,p.value_type,p.boolean_value,p.integer_value,p.plan_key,p.plan_version,started,null from public.plan_entitlements p where p.plan_key=sub.plan_key and p.plan_version=sub.plan_version
    on conflict(organisation_id,subscription_id,capability_key) do update set effective_at=excluded.effective_at,superseded_at=null;
  if exists(select 1 from public.organisation_entitlements e where e.organisation_id=s.organisation_id and e.capability_key='attendance.offline' and(e.boolean_value or e.value_type<>'boolean')) then raise exception 'offline entitlement invariant failed' using errcode='23514';end if;
  if exists(select 1 from public.kiosk_devices d where d.organisation_id=s.organisation_id and d.offline_enabled) or exists(select 1 from public.kiosk_offline_authorisations a join public.kiosk_devices d on d.id=a.kiosk_device_id where d.organisation_id=s.organisation_id and a.revoked_at is null and a.expires_at>started) then raise exception 'offline attendance invariant failed' using errcode='23514';end if;
  update public.onboarding_step_states set status='complete',revision=revision+1,started_at=coalesce(started_at,started),completed_at=started,last_saved_at=started,completed_by_auth_user_id=auth.uid() where session_id=s.id and step_key in('readiness','go_live') and status<>'complete';
  update public.onboarding_sessions set status='live',current_step_key='go_live',go_live_at=started,completed_by_membership_id=m.id,revision=revision+1,last_activity_at=started,updated_at=started where id=s.id returning * into s;
  if payload->'acknowledgedWarnings'?'sole_manager' then
    insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata)
      values(s.id,s.organisation_id,'readiness_warning_acknowledged','go_live','owner',auth.uid(),m.id,key_value,s.revision,jsonb_build_object('statusCode','sole_manager'));
  end if;
  insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata)
    select s.id,s.organisation_id,event_type,'go_live','owner',auth.uid(),m.id,key_value,s.revision,jsonb_build_object('statusCode',case event_type when 'trial_activated' then 'trial_active' else 'complete' end)
    from unnest(array['go_live_requested','trial_activated','organisation_went_live','go_live_completed','onboarding_completed'])event_type;
  insert into public.organisation_lifecycle_audit_events(organisation_id,event_type,actor_auth_user_id,actor_membership_id,request_id,safe_metadata) values(s.organisation_id,'organisation_went_live',auth.uid(),m.id,key_value,jsonb_build_object('statusCode','live'));
  readiness:=private.commercial_onboarding_readiness(s.id);reference:=jsonb_build_object('organisationId',s.organisation_id,'subscriptionId',sub.id);
  update public.onboarding_command_receipts set status='succeeded',result_code='go_live_completed',result_outcome='succeeded',result_data_state='saved',result_session_revision=s.revision,result_reference=reference,result_issues='[]',completed_at=started where id=receipt.id;
  return private.onboarding_command_response(command_envelope,'succeeded','saved','go_live_completed',reference,s.revision,'[]',readiness)||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(s.id));
end$$;

create or replace function public.execute_onboarding_bootstrap_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin
  if command_envelope->>'commandType' in('evaluate_readiness','go_live') then return private.execute_readiness_go_live_command(command_envelope);end if;
  return private.execute_onboarding_bootstrap_command_7g(command_envelope);
end$$;

alter function public.perform_commercial_kiosk_attendance_action(text,text,text,text,text,uuid) rename to perform_commercial_kiosk_attendance_action_7h;
create or replace function public.perform_commercial_kiosk_attendance_action(device_token text,target_staff_id text,candidate_pin text,requested_action text,expected_revision text,idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare d public.kiosk_devices%rowtype;decision jsonb;begin
  select * into d from public.kiosk_devices where token_hash=sha256(convert_to(device_token,'UTF8')) and active and expires_at>now() and organisation_id is not null and offline_enabled=false;
  if not found then return jsonb_build_object('ok',false,'code','device_required');end if;
  if not exists(select 1 from public.organisations o where o.id=d.organisation_id and o.operational_state='live' and o.went_live_at is not null) then return jsonb_build_object('ok',false,'code','pre_live','state','pre_live');end if;
  decision:=private.commercial_capability_decision(d.organisation_id,'attendance.core','{}'::jsonb);
  if not coalesce((decision->>'allowed')::boolean,false) then return jsonb_build_object('ok',false,'code',decision->>'decisionCode');end if;
  if exists(select 1 from public.kiosk_offline_authorisations a where a.kiosk_device_id=d.id and a.revoked_at is null and a.expires_at>now()) then return jsonb_build_object('ok',false,'code','offline_invariant_failed');end if;
  return public.perform_commercial_kiosk_attendance_action_7h(device_token,target_staff_id,candidate_pin,requested_action,expected_revision,idempotency_key);
end$$;

alter table public.onboarding_events drop constraint onboarding_events_event_type_check;
alter table public.onboarding_events add constraint onboarding_events_event_type_check check(event_type in(
  'workflow_started','onboarding_started','signup_started','owner_email_verified','owner_mfa_enrolled','owner_mfa_ready','owner_security_completed','legal_acceptance_completed',
  'organisation_creation_started','organisation_created','first_site_started','first_site_validation_failed','first_site_defaults_created','first_site_created',
  'plan_selection_started','plan_selected','trial_selected','trial_pending_created','subscription_step_completed','trial_activated','settings_completed',
  'staff_import_started','staffing_started','staff_manual_created','staff_import_uploaded','staff_import_validated','staff_import_reviewed','staff_import_committed','staffing_skipped','staffing_completed',
  'manager_invitation_step_started','manager_invitation_created','manager_invitation_delivery_failed','manager_invitation_resent','manager_invitation_revoked','manager_invitation_accepted','sole_manager_acknowledged','manager_invitation_step_completed',
  'staff_invitation_step_started','staff_invitation_created','staff_invitation_delivery_failed','staff_invitation_resent','staff_invitation_revoked','staff_invitation_accepted','staff_invitation_step_skipped','staff_invitation_step_completed',
  'kiosk_setup_started','kiosk_registration_started','kiosk_registration_created','kiosk_registration_claimed','kiosk_connected','kiosk_roster_verified','kiosk_pin_readiness_verified','kiosk_revoked','kiosk_replaced','kiosk_setup_completed',
  'readiness_evaluated','readiness_warning_acknowledged','go_live_requested','go_live_blocked','organisation_went_live','go_live_completed','onboarding_completed','workflow_abandoned'));

insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision)
select s.id,s.organisation_id,k,1,'not_started',0 from public.onboarding_sessions s cross join unnest(array['readiness','go_live'])k
on conflict(session_id,step_key) do nothing;

revoke all on function private.prevent_commercial_audit_mutation(),private.protect_organisation_live_state(),private.commercial_readiness_item(text,text,boolean,text,text,text,text,text,text,text),
  private.commercial_onboarding_readiness(uuid),private.commercial_live_summary(uuid),private.commercial_onboarding_snapshot_7g(uuid),private.get_or_create_onboarding_bootstrap_7g(),
  private.execute_onboarding_bootstrap_command_7g(jsonb),private.execute_readiness_go_live_command(jsonb),public.perform_commercial_kiosk_attendance_action_7h(text,text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_or_create_onboarding_bootstrap(),public.execute_onboarding_bootstrap_command(jsonb),public.perform_commercial_kiosk_attendance_action(text,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_or_create_onboarding_bootstrap(),public.execute_onboarding_bootstrap_command(jsonb) to authenticated;
grant execute on function public.perform_commercial_kiosk_attendance_action(text,text,text,text,text,uuid) to anon,authenticated;
