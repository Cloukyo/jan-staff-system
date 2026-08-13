-- Commercial Workstream 7D: initial staffing. No invitation, kiosk registration,
-- PIN, trial activation, Go Live, payroll or offline authority is introduced.

alter table public.staff_profiles add column external_staff_id text;
create unique index staff_profiles_commercial_external_staff_key
  on public.staff_profiles(organisation_id,lower(external_staff_id))
  where organisation_id is not null and external_staff_id is not null;

alter table public.staff_import_batches
  add column onboarding_session_id uuid references public.onboarding_sessions(id) on delete restrict,
  add column safe_filename text,
  add column file_digest text check (file_digest is null or file_digest ~ '^[a-f0-9]{64}$'),
  add column expires_at timestamptz,
  add column reviewed_set_hash text check (reviewed_set_hash is null or reviewed_set_hash ~ '^[a-f0-9]{64}$'),
  add column excluded_rows integer not null default 0 check (excluded_rows >= 0);
alter table public.staff_import_rows
  add column source_row_number integer check (source_row_number between 2 and 251),
  add column row_decision text not null default 'include' check (row_decision in ('include','exclude','needs_review','confirm_new')),
  add column warning_codes jsonb not null default '[]'::jsonb,
  add column attendance_eligible_requested boolean not null default false;
alter table public.staff_import_rows add column redacted_at timestamptz;
alter table public.staff_import_rows drop constraint if exists staff_import_rows_organisation_id_batch_id_external_key_key;
create unique index staff_import_rows_nonempty_external_key
  on public.staff_import_rows(organisation_id,batch_id,lower(external_key)) where btrim(external_key)<>'';
alter table public.staff_kiosk_settings
  add column onboarding_attendance_eligible boolean not null default false;

alter table public.onboarding_step_states drop constraint onboarding_step_states_step_key_check;
alter table public.onboarding_step_states add constraint onboarding_step_states_step_key_check check (step_key in (
  'owner_security','legal_acceptance','owner_account','organisation','first_site','subscription','settings',
  'staff','staffing','manager_invitations','staff_invitations','kiosk','initial_rota','readiness','go_live'
));

alter table public.onboarding_command_receipts drop constraint onboarding_command_receipts_command_type_check;
alter table public.onboarding_command_receipts add constraint onboarding_command_receipts_command_type_check check (command_type in (
  'save_step_draft','accept_legal_documents','complete_owner_setup','create_organisation','create_first_site',
  'select_plan','save_settings','save_staff_draft','create_staff','preview_staff_import','review_staff_import_row','commit_staff_import',
  'complete_staffing','skip_staffing','create_manager_invitations','create_staff_invitations',
  'start_kiosk_registration','confirm_kiosk_connection','evaluate_readiness','go_live'
));

create unique index staff_import_batches_active_onboarding_key
  on public.staff_import_batches(onboarding_session_id) where onboarding_session_id is not null and committed_at is null;

create or replace function private.redact_expired_staffing_batches(target_session_id uuid)
returns void language sql volatile security definer set search_path='' as $$
  update public.staff_import_rows r set input_data='{}',normalised_data='{}',external_key='redacted_'||r.id::text,
    redacted_at=coalesce(r.redacted_at,now())
  from public.staff_import_batches b where b.id=r.batch_id and b.onboarding_session_id=target_session_id
    and b.expires_at<=now() and r.redacted_at is null
$$;

create or replace function private.redact_all_expired_staffing_batches()
returns integer language plpgsql security definer set search_path='' as $$
declare changed_count integer;
begin
  update public.staff_import_rows r set input_data='{}',normalised_data='{}',external_key='redacted_'||r.id::text,
    redacted_at=coalesce(r.redacted_at,now())
  from public.staff_import_batches b where b.id=r.batch_id and b.expires_at<=now() and r.redacted_at is null;
  get diagnostics changed_count=row_count; return changed_count;
end $$;

do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron')
    and not exists(select 1 from pg_extension where extname='pg_cron') then
    execute 'create extension pg_cron';
  end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute $query$select cron.schedule('commercial-staffing-retention','17 * * * *','select private.redact_all_expired_staffing_batches()')$query$;
  end if;
end $$;

drop policy if exists staff_import_batches_read on public.staff_import_batches;
create policy staff_import_batches_read on public.staff_import_batches for select to authenticated
  using ((expires_at is null or expires_at>now()) and private.has_site_permission(organisation_id,site_id,'staff.manage'));
drop policy if exists staff_import_rows_read on public.staff_import_rows;
create policy staff_import_rows_read on public.staff_import_rows for select to authenticated using (
  private.has_site_permission(organisation_id,site_id,'staff.manage') and exists(select 1 from public.staff_import_batches b
    where b.id=staff_import_rows.batch_id and (b.expires_at is null or b.expires_at>now()))
);

alter table public.onboarding_events drop constraint onboarding_events_event_type_check;
alter table public.onboarding_events add constraint onboarding_events_event_type_check check(event_type in (
  'workflow_started','onboarding_started','signup_started','owner_email_verified','owner_mfa_enrolled','owner_mfa_ready','owner_security_completed','legal_acceptance_completed',
  'organisation_creation_started','organisation_created','first_site_started','first_site_validation_failed',
  'first_site_defaults_created','first_site_created','plan_selection_started','plan_selected','trial_selected',
  'trial_pending_created','subscription_step_completed','trial_activated','settings_completed','staff_import_started',
  'staffing_started','staff_manual_created','staff_import_uploaded','staff_import_validated','staff_import_reviewed','staff_import_committed',
  'staffing_skipped','staffing_completed','manager_invitations_created','staff_invitations_created',
  'kiosk_registration_started','kiosk_connected','readiness_evaluated','go_live_blocked','go_live_completed',
  'restricted_mode_entered','subscription_recovered'
));

create or replace function private.commercial_staffing_capacity(target_organisation_id uuid, requested_units integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with current_subscription as (
    select id from public.organisation_subscriptions where organisation_id=target_organisation_id and is_current limit 1
  ), entitlement as (
    select integer_value::integer limit_value from public.organisation_entitlements e join current_subscription s on s.id=e.subscription_id
    where e.organisation_id=target_organisation_id and e.capability_key='staff.active.limit' and e.superseded_at is null
  ), usage as (
    select count(*)::integer used from public.staff_profiles where organisation_id=target_organisation_id and active
  ) select jsonb_build_object('allowed',coalesce(usage.used + requested_units <= entitlement.limit_value,false),
    'limit',entitlement.limit_value,'currentUsage',usage.used,'requestedUnits',requested_units,'grantsTenantAccess',false)
  from usage left join entitlement on true
$$;

create or replace function private.enforce_commercial_staff_capacity()
returns trigger language plpgsql security definer set search_path='' as $$
declare decision jsonb;
begin
  if new.organisation_id is null or not new.active
    or (tg_op='UPDATE' and old.organisation_id is not distinct from new.organisation_id and old.active) then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.organisation_id::text,7421));
  if not exists(select 1 from public.organisation_entitlements where organisation_id=new.organisation_id
    and capability_key='staff.active.limit' and superseded_at is null) then raise exception 'staff_entitlement_required' using errcode='23514'; end if;
  decision:=private.commercial_staffing_capacity(new.organisation_id,1);
  if not coalesce((decision->>'allowed')::boolean,false) then raise exception 'staff_limit_exceeded' using errcode='23514'; end if;
  return new;
end $$;

create or replace function private.secure_commercial_staff_defaults()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.organisation_id is not null then
    insert into public.staff_kiosk_settings(staff_id,kiosk_enabled,pin_hash,pin_reset_required,onboarding_attendance_eligible)
    values(new.id,false,null,true,false) on conflict(staff_id) do nothing;
  end if;
  return new;
end $$;

create trigger staff_profiles_commercial_capacity before insert or update of organisation_id,active on public.staff_profiles
  for each row execute function private.enforce_commercial_staff_capacity();
create trigger staff_profiles_commercial_secure_defaults after insert on public.staff_profiles
  for each row execute function private.secure_commercial_staff_defaults();

create or replace function private.commercial_staffing_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with session_state as (select * from public.onboarding_sessions where id=target_session_id),
  site as (select s.id,s.name as display_name from public.organisation_sites s join session_state x on x.organisation_id=s.organisation_id order by s.created_at,s.id limit 1),
  capacity as (select private.commercial_staffing_capacity(x.organisation_id,0) value from session_state x),
  batch as (select b.* from public.staff_import_batches b join session_state x on x.id=b.onboarding_session_id
    order by b.created_at desc limit 1),
  rows_value as (select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'sourceRowNumber',r.source_row_number,'externalStaffId',r.external_key,
    'fullName',r.normalised_data->>'fullName','email',nullif(r.normalised_data->>'email',''),
    'jobRole',r.normalised_data->>'jobRole','attendanceEligible',r.attendance_eligible_requested,
    'decision',r.row_decision,'validationCodes',r.validation_errors || r.warning_codes,'importedStaffId',r.imported_staff_id
  ) order by r.source_row_number),'[]'::jsonb) rows from public.staff_import_rows r join batch b on b.id=r.batch_id
    where b.expires_at>now() and b.status<>'committed' and r.redacted_at is null)
  select jsonb_build_object(
    'firstSiteId',(select id from site),'firstSiteName',(select display_name from site),
    'activeStaffCount',coalesce(((select value from capacity)->>'currentUsage')::int,0),
    'staffLimit',((select value from capacity)->>'limit')::int,
    'remainingStaffAllowance',greatest(0,coalesce(((select value from capacity)->>'limit')::int,0)-coalesce(((select value from capacity)->>'currentUsage')::int,0)),
    'committedThisStep',(select count(*)::int from public.onboarding_events e where e.session_id=target_session_id and e.event_type='staff_manual_created')
      + coalesce((select sum(b.valid_rows)::int from public.staff_import_batches b where b.onboarding_session_id=target_session_id and b.status='committed'),0),
    'skipped',coalesce((select status='skipped' from public.onboarding_step_states where session_id=target_session_id and step_key='staffing'),false),
    'activeBatch',(select jsonb_build_object('id',b.id,'status',case when b.expires_at<=now() and b.status<>'committed' then 'expired'
      when b.status='previewing' then 'validating' when b.status='preview_ready' then 'ready' else b.status::text end,
      'safeFilename',b.safe_filename,'totalRows',b.total_rows,
      'includedRows',(select count(*)::int from public.staff_import_rows r where r.batch_id=b.id and r.row_decision in('include','confirm_new')),
      'excludedRows',(select count(*)::int from public.staff_import_rows r where r.batch_id=b.id and r.row_decision='exclude'),
      'invalidRows',(select count(*)::int from public.staff_import_rows r where r.batch_id=b.id and r.row_decision='needs_review'),
      'expiresAt',b.expires_at,'rows',(select rows from rows_value)) from batch b)
  )
$$;

alter function private.commercial_onboarding_snapshot(uuid) rename to commercial_onboarding_snapshot_7c;
alter function public.get_or_create_onboarding_bootstrap() rename to get_or_create_onboarding_bootstrap_7c;
alter function public.get_or_create_onboarding_bootstrap_7c() set schema private;
alter function public.execute_onboarding_bootstrap_command(jsonb) rename to execute_onboarding_bootstrap_command_7c;
alter function public.execute_onboarding_bootstrap_command_7c(jsonb) set schema private;

create or replace function private.commercial_onboarding_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.commercial_onboarding_snapshot_7c(target_session_id)
    || jsonb_build_object('steps',coalesce((select jsonb_agg(jsonb_build_object('stepKey',step_key,'status',status,'revision',revision::text,
      'draftPayload',draft_payload,'validationSummary',validation_summary) order by case step_key when 'owner_security' then 1 when 'legal_acceptance' then 2
      when 'organisation' then 3 when 'first_site' then 4 when 'subscription' then 5 when 'staffing' then 6 else 99 end)
      from public.onboarding_step_states where session_id=target_session_id and step_key in
      ('owner_security','legal_acceptance','organisation','first_site','subscription','staffing')),'[]'::jsonb),
      'staffing',private.commercial_staffing_snapshot(target_session_id))
$$;

create or replace function public.get_or_create_onboarding_bootstrap()
returns jsonb language plpgsql security definer set search_path='' as $$
declare initial jsonb; target_id uuid;
begin
  initial:=private.get_or_create_onboarding_bootstrap_7c(); target_id:=(initial->'session'->>'id')::uuid;
  perform private.redact_expired_staffing_batches(target_id);
  insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision)
    select id,organisation_id,'staffing',1,'not_started',0 from public.onboarding_sessions where id=target_id
    on conflict(session_id,step_key) do nothing;
  return private.commercial_onboarding_snapshot(target_id);
end $$;

create or replace function private.execute_commercial_staffing_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  current_auth_user_id uuid:=auth.uid(); session_row public.onboarding_sessions%rowtype; member public.organisation_memberships%rowtype;
  receipt public.onboarding_command_receipts%rowtype; existing public.onboarding_command_receipts%rowtype;
  payload jsonb:=command_envelope->'payload'; command_type text:=command_envelope->>'commandType'; key_value uuid;
  expected_revision bigint; hash_value text; site_row public.organisation_sites%rowtype; result_code text; issues jsonb:='[]';
  reference jsonb:='{}'; capacity jsonb; staff_id_value text; batch_id_value uuid; row_value jsonb; errors jsonb; warnings jsonb;
  included_count int; imported_ids jsonb:='[]'; now_date date:=(now() at time zone 'Europe/London')::date; parsed_start_date date; event_name text;
begin
  if current_auth_user_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if jsonb_typeof(command_envelope)<>'object' or jsonb_typeof(payload)<>'object'
    or command_envelope->>'schemaVersion'<>'1' or command_envelope->>'workflowKey'<>'commercial_customer_v1'
    or command_envelope->>'workflowVersion'<>'1' or not ((command_envelope->>'sessionId')~*'^[0-9a-f-]{36}$')
    or not ((command_envelope->>'idempotencyKey')~*'^[0-9a-f-]{36}$') or not ((command_envelope->>'expectedSessionRevision')~'^(0|[1-9][0-9]*)$') then
    raise exception 'invalid onboarding command envelope' using errcode='22023'; end if;
  key_value:=(command_envelope->>'idempotencyKey')::uuid; expected_revision:=(command_envelope->>'expectedSessionRevision')::bigint;
  hash_value:=private.onboarding_request_digest(command_envelope);
  select * into session_row from public.onboarding_sessions where id=(command_envelope->>'sessionId')::uuid for update;
  if not found or session_row.owner_auth_user_id<>auth.uid() or session_row.organisation_id is null then result_code:='permission_denied'; end if;
  if result_code is null then select * into member from public.organisation_memberships where organisation_id=session_row.organisation_id
    and auth_user_id=current_auth_user_id and status='active' and private.has_permission(session_row.organisation_id,'staff.manage') for update;
    if not found then result_code:='staff_access_required'; end if; end if;
  if result_code is null and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then result_code:='mfa_required'; end if;
  if result_code is null then perform private.redact_expired_staffing_batches(session_row.id); end if;
  if result_code is null and session_row.revision<>expected_revision then result_code:='stale_session_revision'; end if;
  if result_code is null and not exists(select 1 from public.onboarding_step_states where session_id=session_row.id and step_key='subscription' and status='complete') then result_code:='subscription_required'; end if;
  if result_code is null then select * into site_row from public.organisation_sites where organisation_id=session_row.organisation_id order by created_at,id limit 1;
    if not found then result_code:='first_site_required'; end if; end if;
  select * into existing from public.onboarding_command_receipts r where r.session_id=session_row.id
    and r.command_type=(command_envelope->>'commandType') and r.idempotency_key=key_value;
  if found then
    if result_code in('permission_denied','staff_access_required','mfa_required') then
      issues:=jsonb_build_array(jsonb_build_object('code',result_code,'message','This staffing command is not available. Nothing was saved.',
        'fieldPath','[]'::jsonb,'repairRoute',case when result_code='mfa_required' then '/mfa' else '/onboarding/staffing' end));
      return private.onboarding_command_response(command_envelope,'permission_denied','not_saved',result_code,'{}',session_row.revision,
        issues,null)||jsonb_build_object('bootstrap',null);
    end if;
    if existing.request_hash<>hash_value then
      issues:=jsonb_build_array(jsonb_build_object('code','idempotency_key_reused','message','This submission key was already used for different staffing details. Nothing was saved.',
        'fieldPath','[]'::jsonb,'repairRoute','/onboarding/staffing'));
      return private.onboarding_command_response(command_envelope,'validation_failed','not_saved','idempotency_key_reused','{}',session_row.revision,
        issues,private.onboarding_foundation_readiness(session_row.id,existing.id))
        ||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(session_row.id));
    elsif existing.status in('succeeded','failed_final') then
      return private.onboarding_command_response(command_envelope,case when existing.status='succeeded' then 'replayed' else existing.result_outcome end,
        existing.result_data_state,existing.result_code,coalesce(existing.result_reference,'{}'),existing.result_session_revision,
        coalesce(existing.result_issues,'[]'),coalesce(existing.result_readiness,private.onboarding_foundation_readiness(session_row.id,existing.id)))
        ||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(session_row.id));
    end if;
  end if;
  if existing.id is null then insert into public.onboarding_command_receipts(session_id,organisation_id,command_type,idempotency_key,request_hash,status)
    values(session_row.id,session_row.organisation_id,command_type,key_value,hash_value,'processing') returning * into receipt; else receipt:=existing; end if;

  if result_code is null and command_type='save_staff_draft' then
    if exists(select 1 from jsonb_object_keys(payload) k where k not in
      ('externalStaffId','fullName','displayName','email','employmentStatus','startDate','jobRole','attendanceEligible'))
      or exists(select 1 from jsonb_each(payload) entry where entry.key<>'attendanceEligible' and jsonb_typeof(entry.value)<>'string')
      or (payload?'attendanceEligible' and jsonb_typeof(payload->'attendanceEligible')<>'boolean')
      or length(coalesce(payload->>'externalStaffId',''))>64 or length(coalesce(payload->>'fullName',''))>160
      or length(coalesce(payload->>'displayName',''))>80 or length(coalesce(payload->>'email',''))>254
      or length(coalesce(payload->>'employmentStatus',''))>40 or length(coalesce(payload->>'startDate',''))>32
      or length(coalesce(payload->>'jobRole',''))>40 then result_code:='invalid_staff_draft';
    else
      update public.onboarding_step_states set draft_payload=payload,status='in_progress',revision=revision+1,
        started_at=coalesce(started_at,now()),last_saved_at=now() where session_id=session_row.id and step_key='staffing';
      event_name:='staffing_started';
    end if;
  elsif result_code is null and command_type='create_staff' then
    if (select count(*) from jsonb_object_keys(payload)) not between 7 and 8 or not (payload?'externalStaffId' and payload?'fullName' and payload?'displayName'
      and payload?'employmentStatus' and payload?'startDate' and payload?'jobRole' and payload?'attendanceEligible') then result_code:='invalid_staff_payload'; end if;
    if result_code is null and exists(select 1 from jsonb_object_keys(payload) k where k not in
      ('externalStaffId','fullName','displayName','email','employmentStatus','startDate','jobRole','attendanceEligible')) then result_code:='invalid_staff_payload'; end if;
    if result_code is null and (jsonb_typeof(payload->'externalStaffId')<>'string' or jsonb_typeof(payload->'fullName')<>'string'
      or jsonb_typeof(payload->'displayName')<>'string' or jsonb_typeof(payload->'employmentStatus')<>'string'
      or jsonb_typeof(payload->'startDate')<>'string' or jsonb_typeof(payload->'jobRole')<>'string'
      or jsonb_typeof(payload->'attendanceEligible')<>'boolean'
      or (payload?'email' and jsonb_typeof(payload->'email')<>'string')) then result_code:='invalid_staff_payload'; end if;
    if result_code is null and (length(btrim(payload->>'fullName')) not between 2 and 160
      or length(btrim(payload->>'displayName')) not between 1 and 80
      or (nullif(btrim(payload->>'email'),'') is not null and (length(btrim(payload->>'email'))>254
        or not (payload->>'email' ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')))) then result_code:='invalid_staff_payload'; end if;
    if result_code is null and (payload->>'externalStaffId')!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then result_code:='invalid_staff_identifier'; end if;
    if result_code is null and payload->>'jobRole' not in('staff','supervisor','manager') then result_code:='unsupported_role'; end if;
    if result_code is null and payload->>'employmentStatus' not in('active','future_starter') then result_code:='invalid_employment_status'; end if;
    if result_code is null and not (payload->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$') then result_code:='invalid_start_date'; end if;
    begin perform (payload->>'startDate')::date; exception when others then result_code:='invalid_start_date'; end;
    if result_code is null and (payload->>'startDate')::date<now_date then result_code:='invalid_assignment_dates'; end if;
    staff_id_value:='onboard_'||substr(encode(extensions.digest(session_row.organisation_id::text||':'||lower(payload->>'externalStaffId'),'sha256'),'hex'),1,24);
    if result_code is null and exists(select 1 from public.staff_profiles where organisation_id=session_row.organisation_id
      and (id=staff_id_value or lower(external_staff_id)=lower(payload->>'externalStaffId'))) then result_code:='duplicate_staff_identifier'; end if;
    if result_code is null and nullif(lower(btrim(payload->>'email')),'') is not null and exists(select 1 from public.staff_profiles where organisation_id=session_row.organisation_id and lower(email)=lower(btrim(payload->>'email'))) then result_code:='duplicate_staff_email'; end if;
    capacity:=private.commercial_staffing_capacity(session_row.organisation_id,case when payload->>'employmentStatus'='active' then 1 else 0 end);
    if result_code is null and not coalesce((capacity->>'allowed')::boolean,false) then result_code:='staff_limit_exceeded'; end if;
    if result_code is null then
      insert into public.staff_profiles(id,organisation_id,external_staff_id,full_name,display_name,employment_role,appointment_date,email,active)
      values(staff_id_value,session_row.organisation_id,btrim(payload->>'externalStaffId'),btrim(payload->>'fullName'),btrim(payload->>'displayName'),payload->>'jobRole',(payload->>'startDate')::date,
        nullif(lower(btrim(payload->>'email')),''),payload->>'employmentStatus'='active');
      insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary,employment_role,created_by_membership_id)
      values(session_row.organisation_id,staff_id_value,site_row.id,(payload->>'startDate')::date,true,payload->>'jobRole',member.id);
      insert into public.staff_kiosk_settings(staff_id,kiosk_enabled,pin_hash,pin_reset_required,onboarding_attendance_eligible)
      values(staff_id_value,false,null,true,(payload->>'attendanceEligible')::boolean)
      on conflict(staff_id) do update set kiosk_enabled=false,pin_hash=null,pin_reset_required=true,
        onboarding_attendance_eligible=excluded.onboarding_attendance_eligible;
      reference:=jsonb_build_object('staffId',staff_id_value,'siteId',site_row.id); event_name:='staff_manual_created';
    end if;
  elsif result_code is null and command_type='preview_staff_import' then
    if not(payload?'safeFilename' and payload?'fileDigest' and payload?'rows') or jsonb_typeof(payload->'rows')<>'array'
      or jsonb_array_length(payload->'rows') not between 1 and 250 then result_code:='invalid_import_payload'; end if;
    if result_code is null and ((select count(*) from jsonb_object_keys(payload))<>3
      or jsonb_typeof(payload->'safeFilename')<>'string' or length(btrim(payload->>'safeFilename')) not between 1 and 120
      or not (payload->>'safeFilename' ~* '^[A-Za-z0-9][A-Za-z0-9._ -]*\.csv$')
      or jsonb_typeof(payload->'fileDigest')<>'string' or not (payload->>'fileDigest' ~ '^[a-f0-9]{64}$')
      or exists(select 1 from jsonb_array_elements(payload->'rows') candidate where jsonb_typeof(candidate)<>'object'
        or not (candidate?'sourceRowNumber' and candidate?'externalStaffId' and candidate?'fullName' and candidate?'displayName'
          and candidate?'employmentStatus' and candidate?'startDate' and candidate?'jobRole' and candidate?'attendanceEligible')
        or exists(select 1 from jsonb_object_keys(candidate) k where k not in
          ('sourceRowNumber','externalStaffId','fullName','displayName','email','employmentStatus','startDate','jobRole','siteName','attendanceEligible'))
        or jsonb_typeof(candidate->'sourceRowNumber')<>'number' or not ((candidate->>'sourceRowNumber')~'^[0-9]+$')
        or (candidate->>'sourceRowNumber')::int not between 2 and 251
        or jsonb_typeof(candidate->'externalStaffId')<>'string' or jsonb_typeof(candidate->'fullName')<>'string'
        or jsonb_typeof(candidate->'displayName')<>'string' or jsonb_typeof(candidate->'employmentStatus')<>'string'
        or jsonb_typeof(candidate->'startDate')<>'string' or jsonb_typeof(candidate->'jobRole')<>'string'
        or jsonb_typeof(candidate->'attendanceEligible') not in('boolean','string')
        or (candidate?'email' and jsonb_typeof(candidate->'email')<>'string')
        or (candidate?'siteName' and jsonb_typeof(candidate->'siteName')<>'string'))
    ) then result_code:='invalid_import_payload'; end if;
    if result_code is null then
      update public.staff_import_batches set committed_at=coalesce(committed_at,now()) where onboarding_session_id=session_row.id and committed_at is null;
      insert into public.staff_import_batches(organisation_id,site_id,idempotency_key,request_hash,status,total_rows,created_by_membership_id,
        onboarding_session_id,safe_filename,file_digest,expires_at)
      values(session_row.organisation_id,site_row.id,key_value::text,substr(hash_value,1,32),'previewing',jsonb_array_length(payload->'rows'),member.id,
        session_row.id,btrim(payload->>'safeFilename'),payload->>'fileDigest',now()+interval '7 days') returning id into batch_id_value;
      for row_value in select value from jsonb_array_elements(payload->'rows') loop
        errors:='[]'; warnings:='[]';
        if btrim(coalesce(row_value->>'externalStaffId',''))='' then errors:=errors||'["missing_required_field"]'::jsonb; end if;
        if btrim(coalesce(row_value->>'fullName',''))='' then errors:=errors||'["missing_required_field"]'::jsonb; end if;
        if btrim(coalesce(row_value->>'externalStaffId',''))<>'' and not (row_value->>'externalStaffId' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') then errors:=errors||'["missing_required_field"]'::jsonb; end if;
        if length(btrim(coalesce(row_value->>'fullName',''))) not between 1 and 160 or length(btrim(coalesce(row_value->>'displayName',''))) not between 1 and 80 then errors:=errors||'["missing_required_field"]'::jsonb; end if;
        if nullif(btrim(row_value->>'email'),'') is not null and not (row_value->>'email' ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then errors:=errors||'["malformed_email"]'::jsonb; end if;
        if row_value->>'jobRole' not in('staff','supervisor','manager') then errors:=errors||'["unsupported_role"]'::jsonb; end if;
        if row_value->>'employmentStatus' not in('active','future_starter') then errors:=errors||'["invalid_employment_status"]'::jsonb; end if;
        if jsonb_typeof(row_value->'attendanceEligible')<>'boolean' then errors:=errors||'["invalid_attendance_eligibility"]'::jsonb; end if;
        if row_value->>'startDate' ~ '^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$' then errors:=errors||'["ambiguous_date"]'::jsonb;
        elsif not (row_value->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$') then errors:=errors||'["malformed_date"]'::jsonb;
        else begin parsed_start_date:=(row_value->>'startDate')::date; exception when others then parsed_start_date:=null;errors:=errors||'["malformed_date"]'::jsonb; end; end if;
        if parsed_start_date is not null and parsed_start_date<now_date then errors:=errors||'["invalid_assignment_dates"]'::jsonb; end if;
        if nullif(btrim(row_value->>'siteName'),'') is not null and lower(btrim(row_value->>'siteName')) <> lower(site_row.name) then errors:=errors||'["unknown_site"]'::jsonb; end if;
        if exists(select 1 from public.staff_import_rows r where r.batch_id=batch_id_value and lower(r.external_key)=lower(row_value->>'externalStaffId')) then errors:=errors||'["duplicate_external_id_upload"]'::jsonb; end if;
        staff_id_value:='onboard_'||substr(encode(extensions.digest(session_row.organisation_id::text||':'||lower(row_value->>'externalStaffId'),'sha256'),'hex'),1,24);
        if exists(select 1 from public.staff_profiles where organisation_id=session_row.organisation_id
          and (id=staff_id_value or lower(external_staff_id)=lower(row_value->>'externalStaffId'))) then errors:=errors||'["duplicate_external_id_organisation"]'::jsonb; end if;
        if nullif(lower(btrim(row_value->>'email')),'') is not null and exists(select 1 from public.staff_profiles where organisation_id=session_row.organisation_id and lower(email)=lower(btrim(row_value->>'email'))) then errors:=errors||'["duplicate_email_organisation"]'::jsonb; end if;
        if nullif(lower(btrim(row_value->>'email')),'') is not null and exists(select 1 from public.staff_import_rows r where r.batch_id=batch_id_value and lower(r.normalised_data->>'email')=lower(btrim(row_value->>'email'))) then errors:=errors||'["duplicate_email_upload"]'::jsonb; end if;
        if exists(select 1 from public.staff_profiles where organisation_id=session_row.organisation_id and lower(full_name)=lower(btrim(row_value->>'fullName'))) then warnings:=warnings||'["probable_duplicate_name"]'::jsonb; end if;
        insert into public.staff_import_rows(organisation_id,batch_id,site_id,source_row,source_row_number,external_key,proposed_staff_id,status,input_data,normalised_data,
          validation_errors,warning_codes,row_decision,attendance_eligible_requested)
        values(session_row.organisation_id,batch_id_value,site_row.id,row_value->>'sourceRowNumber',(row_value->>'sourceRowNumber')::int,row_value->>'externalStaffId',staff_id_value,
          case when jsonb_array_length(errors)>0 then 'invalid'::public.staff_import_row_status else 'valid'::public.staff_import_row_status end,'{}',
          jsonb_build_object('fullName',btrim(row_value->>'fullName'),'displayName',btrim(row_value->>'displayName'),'email',nullif(lower(btrim(row_value->>'email')),''),
            'employmentStatus',row_value->>'employmentStatus','startDate',row_value->>'startDate','jobRole',row_value->>'jobRole'),errors,warnings,
          case when jsonb_array_length(errors)>0 or jsonb_array_length(warnings)>0 then 'needs_review' else 'include' end,
          case when jsonb_typeof(row_value->'attendanceEligible')='boolean' then (row_value->>'attendanceEligible')::boolean else false end);
      end loop;
      update public.staff_import_batches b set valid_rows=x.valid_rows,invalid_rows=x.invalid_rows,status=case when x.invalid_rows=0 then 'preview_ready'::public.staff_import_batch_status else 'invalid'::public.staff_import_batch_status end
      from(select count(*) filter(where status='valid')::int valid_rows,count(*) filter(where status='invalid')::int invalid_rows from public.staff_import_rows where batch_id=batch_id_value)x where b.id=batch_id_value;
      reference:=jsonb_build_object('importBatchId',batch_id_value,'siteId',site_row.id); event_name:='staff_import_validated';
    end if;
  elsif result_code is null and command_type='review_staff_import_row' then
    update public.staff_import_rows r set row_decision=payload->>'decision'
    from public.staff_import_batches b where r.id=(payload->>'rowId')::uuid and r.batch_id=(payload->>'batchId')::uuid and b.id=r.batch_id
      and b.onboarding_session_id=session_row.id and b.organisation_id=session_row.organisation_id and b.expires_at>now()
      and b.status<>'committed'
      and ((payload->>'decision')='exclude' or ((payload->>'decision')='confirm_new' and r.validation_errors='[]'::jsonb));
    if not found then result_code:='import_row_not_available'; else
      update public.staff_import_batches set excluded_rows=(select count(*)::int from public.staff_import_rows where batch_id=id and row_decision='exclude'),
        invalid_rows=(select count(*)::int from public.staff_import_rows where batch_id=id and row_decision='needs_review') where id=(payload->>'batchId')::uuid;
      reference:=jsonb_build_object('importBatchId',(payload->>'batchId')::uuid); event_name:='staff_import_reviewed'; end if;
  elsif result_code is null and command_type='commit_staff_import' then
    select id into batch_id_value from public.staff_import_batches where id=(payload->>'batchId')::uuid and onboarding_session_id=session_row.id
      and organisation_id=session_row.organisation_id and expires_at>now() for update;
    if not found then result_code:='import_batch_not_available'; end if;
    if result_code is null and exists(select 1 from public.staff_import_batches where id=batch_id_value and status='committed') then
      if (select reviewed_set_hash from public.staff_import_batches where id=batch_id_value)<>payload->>'reviewedSetHash' then result_code:='reviewed_set_changed';
      else reference:=jsonb_build_object('importBatchId',batch_id_value,'staffIds',coalesce((select jsonb_agg(imported_staff_id order by imported_staff_id)
        from public.staff_import_rows where batch_id=batch_id_value and imported_staff_id is not null),'[]'::jsonb));
      update public.onboarding_command_receipts set status='succeeded',result_code='staff_import_committed',result_outcome='succeeded',
        result_data_state='saved',result_session_revision=session_row.revision,result_reference=reference,result_issues='[]',completed_at=now() where id=receipt.id;
      return private.onboarding_command_response(command_envelope,'replayed','saved','staff_import_committed',reference,session_row.revision,'[]',
        private.onboarding_foundation_readiness(session_row.id,receipt.id))||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(session_row.id));
      end if;
    end if;
    if result_code is null and exists(select 1 from public.staff_import_rows where batch_id=batch_id_value and row_decision='needs_review') then result_code:='import_requires_review'; end if;
    if result_code is null and (select encode(extensions.digest(coalesce(string_agg(r.id::text||':'||r.row_decision,',' order by r.id),''),'sha256'),'hex')
      from public.staff_import_rows r where r.batch_id=batch_id_value) <> payload->>'reviewedSetHash' then result_code:='reviewed_set_changed'; end if;
    if result_code is null and exists(select 1 from public.staff_import_rows r join public.staff_profiles p
      on p.organisation_id=session_row.organisation_id and (p.id=r.proposed_staff_id
        or lower(p.external_staff_id)=lower(r.external_key)
        or (p.email is not null and lower(p.email)=lower(r.normalised_data->>'email')))
      where r.batch_id=batch_id_value and r.row_decision in('include','confirm_new')) then result_code:='import_data_changed'; end if;
    select count(*)::int into included_count from public.staff_import_rows r where r.batch_id=batch_id_value and r.row_decision in('include','confirm_new');
    capacity:=private.commercial_staffing_capacity(session_row.organisation_id,(select count(*)::int from public.staff_import_rows r where r.batch_id=batch_id_value
      and r.row_decision in('include','confirm_new') and r.normalised_data->>'employmentStatus'='active'));
    if result_code is null and not coalesce((capacity->>'allowed')::boolean,false) then result_code:='staff_limit_exceeded'; end if;
    if result_code is null then
      for row_value in select to_jsonb(r) value from public.staff_import_rows r where r.batch_id=batch_id_value and r.row_decision in('include','confirm_new') order by r.source_row_number loop
        staff_id_value:=row_value->>'proposed_staff_id';
        insert into public.staff_profiles(id,organisation_id,external_staff_id,full_name,display_name,employment_role,appointment_date,email,active)
        values(staff_id_value,session_row.organisation_id,row_value->>'external_key',row_value->'normalised_data'->>'fullName',row_value->'normalised_data'->>'displayName',row_value->'normalised_data'->>'jobRole',
          (row_value->'normalised_data'->>'startDate')::date,nullif(row_value->'normalised_data'->>'email',''),row_value->'normalised_data'->>'employmentStatus'='active');
        insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary,employment_role,created_by_membership_id)
        values(session_row.organisation_id,staff_id_value,site_row.id,(row_value->'normalised_data'->>'startDate')::date,true,row_value->'normalised_data'->>'jobRole',member.id);
        insert into public.staff_kiosk_settings(staff_id,kiosk_enabled,pin_hash,pin_reset_required,onboarding_attendance_eligible)
        values(staff_id_value,false,null,true,(row_value->>'attendance_eligible_requested')::boolean)
        on conflict(staff_id) do update set kiosk_enabled=false,pin_hash=null,pin_reset_required=true,
          onboarding_attendance_eligible=excluded.onboarding_attendance_eligible;
        update public.staff_import_rows set status='committed',imported_staff_id=staff_id_value where id=(row_value->>'id')::uuid;
        imported_ids:=imported_ids||jsonb_build_array(staff_id_value);
      end loop;
      update public.staff_import_batches set status='committed',committed_at=now(),valid_rows=included_count,reviewed_set_hash=payload->>'reviewedSetHash' where id=batch_id_value;
      reference:=jsonb_build_object('importBatchId',batch_id_value,'staffIds',imported_ids); event_name:='staff_import_committed';
    end if;
  elsif result_code is null and command_type in('complete_staffing','skip_staffing') then
    if command_type='complete_staffing' and not exists(select 1 from public.staff_profiles where organisation_id=session_row.organisation_id) then result_code:='staff_required';
    elsif command_type='skip_staffing' and payload->>'acknowledgement'<>'staffing_not_ready' then result_code:='skip_acknowledgement_required';
    else event_name:=case when command_type='skip_staffing' then 'staffing_skipped' else 'staffing_completed' end; end if;
  else if result_code is null then result_code:='unsupported_staffing_command'; end if; end if;

  if result_code is not null then
    issues:=jsonb_build_array(jsonb_build_object('code',result_code,'message',case result_code when 'staff_limit_exceeded' then 'The selected plan staff allowance would be exceeded. No staff were created.'
      when 'stale_session_revision' then 'Onboarding changed after this page was opened. Reload and try again.' when 'mfa_required' then 'Complete multi-factor authentication before continuing.'
      when 'import_requires_review' then 'Review or exclude every flagged row before importing.' else 'Nothing was saved. Review the staffing details and try again.' end,
      'fieldPath','[]'::jsonb,'repairRoute',case when result_code='mfa_required' then '/mfa' else '/onboarding/staffing' end));
    update public.onboarding_command_receipts set status='failed_final',result_code=result_code,
      result_outcome=case when result_code='stale_session_revision' then 'workflow_changed' when result_code in('permission_denied','staff_access_required','mfa_required') then 'permission_denied' else 'validation_failed' end,
      result_data_state='not_saved',result_session_revision=session_row.revision,result_issues=issues,completed_at=now() where id=receipt.id;
    return private.onboarding_command_response(command_envelope,case when result_code='stale_session_revision' then 'workflow_changed' when result_code in('permission_denied','staff_access_required','mfa_required') then 'permission_denied' else 'validation_failed' end,
      'not_saved',result_code,'{}',session_row.revision,issues,private.onboarding_foundation_readiness(session_row.id,receipt.id))
      ||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(session_row.id));
  end if;

  if event_name in('staffing_skipped','staffing_completed') then
    update public.onboarding_step_states set status=case when event_name='staffing_skipped' then 'skipped' else 'complete' end,revision=revision+1,
      started_at=coalesce(started_at,now()),completed_at=now(),last_saved_at=now(),completed_by_auth_user_id=current_auth_user_id where session_id=session_row.id and step_key='staffing';
    update public.onboarding_sessions set current_step_key='manager_invitations',revision=revision+1,last_activity_at=now() where id=session_row.id returning * into session_row;
  else
    if command_type<>'save_staff_draft' then
      update public.onboarding_step_states set status=case when event_name='staff_import_validated' and exists(select 1 from public.staff_import_rows where batch_id=batch_id_value and row_decision='needs_review') then 'needs_review' else 'in_progress' end,
        revision=revision+1,started_at=coalesce(started_at,now()),last_saved_at=now(),completed_at=null where session_id=session_row.id and step_key='staffing';
    end if;
    update public.onboarding_sessions set current_step_key='staff',revision=revision+1,last_activity_at=now() where id=session_row.id returning * into session_row;
  end if;
  if event_name in('staff_manual_created','staff_import_validated') and not exists(select 1 from public.onboarding_events where session_id=session_row.id and event_type='staffing_started') then
    insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata)
    values(session_row.id,session_row.organisation_id,'staffing_started','staff','owner',current_auth_user_id,member.id,key_value,session_row.revision,
      jsonb_build_object('statusCode','started'));
  end if;
  if event_name='staff_import_validated' then
    insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata)
    values(session_row.id,session_row.organisation_id,'staff_import_uploaded','staff','owner',current_auth_user_id,member.id,key_value,session_row.revision,
      jsonb_build_object('statusCode','uploaded','resourceCounts',jsonb_build_object('rows',(select total_rows from public.staff_import_batches where id=batch_id_value))));
  end if;
  insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata)
  values(session_row.id,session_row.organisation_id,event_name,'staff','owner',current_auth_user_id,member.id,key_value,session_row.revision,
    jsonb_build_object('statusCode','saved','resourceCounts',jsonb_build_object(
      'created',coalesce(included_count,case when staff_id_value is null then 0 else 1 end))));
  update public.onboarding_command_receipts set status='succeeded',result_code=event_name,result_outcome='succeeded',result_data_state='saved',
    result_session_revision=session_row.revision,result_reference=reference,result_issues='[]',completed_at=now() where id=receipt.id;
  return private.onboarding_command_response(command_envelope,'succeeded','saved',event_name,reference,session_row.revision,'[]',private.onboarding_foundation_readiness(session_row.id,receipt.id))
    ||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(session_row.id));
end $$;

create or replace function public.execute_onboarding_bootstrap_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if command_envelope->>'commandType' in('save_staff_draft','create_staff','preview_staff_import','review_staff_import_row','commit_staff_import','complete_staffing','skip_staffing') then
    return private.execute_commercial_staffing_command(command_envelope);
  end if;
  return private.execute_onboarding_bootstrap_command_7c(command_envelope);
end $$;

insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision)
select id,organisation_id,'staffing',1,'not_started',0 from public.onboarding_sessions on conflict(session_id,step_key) do nothing;

revoke all on function private.commercial_staffing_capacity(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function private.enforce_commercial_staff_capacity() from public,anon,authenticated,service_role;
revoke all on function private.secure_commercial_staff_defaults() from public,anon,authenticated,service_role;
revoke all on function private.redact_expired_staffing_batches(uuid) from public,anon,authenticated,service_role;
revoke all on function private.redact_all_expired_staffing_batches() from public,anon,authenticated,service_role;
revoke all on function private.commercial_staffing_snapshot(uuid) from public,anon,authenticated,service_role;
revoke all on function private.commercial_onboarding_snapshot_7c(uuid) from public,anon,authenticated,service_role;
revoke all on function private.get_or_create_onboarding_bootstrap_7c() from public,anon,authenticated,service_role;
revoke all on function private.execute_onboarding_bootstrap_command_7c(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.execute_commercial_staffing_command(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_or_create_onboarding_bootstrap() from public,anon,authenticated,service_role;
revoke all on function public.execute_onboarding_bootstrap_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_or_create_onboarding_bootstrap() to authenticated;
grant execute on function public.execute_onboarding_bootstrap_command(jsonb) to authenticated;
