-- Commercial Workstream 7E: manager invitations only. Staff invitations,
-- kiosk registration, trial activation, Go Live and offline authority remain excluded.

create extension if not exists supabase_vault with schema vault;
revoke all on vault.secrets,vault.decrypted_secrets from public,anon,authenticated;

alter type public.organisation_invitation_status add value if not exists 'superseded';

alter table public.organisation_invitations
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_invitation_id uuid,
  add column if not exists invitation_kind text not null default 'legacy' check (invitation_kind in ('legacy','manager')),
  add column if not exists template_version text not null default 'manager_invitation_v1',
  add column if not exists revoked_by_membership_id uuid,
  add column if not exists resend_of_invitation_id uuid,
  add constraint organisation_invitations_revoked_by_fk foreign key(organisation_id,revoked_by_membership_id)
    references public.organisation_memberships(organisation_id,id) on delete restrict,
  add constraint organisation_invitations_resend_of_fk foreign key(resend_of_invitation_id)
    references public.organisation_invitations(id) on delete restrict;
do $$begin
  if not exists(select 1 from pg_constraint where conname='organisation_invitations_superseded_by_fk') then
    alter table public.organisation_invitations add constraint organisation_invitations_superseded_by_fk
      foreign key(superseded_by_invitation_id) references public.organisation_invitations(id) on delete restrict deferrable initially deferred;
  end if;
end$$;

alter table public.organisation_settings add column if not exists manager_invitation_lifetime_days smallint not null default 7
  check(manager_invitation_lifetime_days between 1 and 30);

drop trigger if exists organisation_invitations_supersede_pending on public.organisation_invitations;

create table public.message_outbox (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  message_type text not null check(message_type='manager_invitation'), recipient_address text not null check(recipient_address=lower(recipient_address)),
  invitation_id uuid not null, template_version text not null check(template_version='manager_invitation_v1'),
  delivery_secret_id uuid references vault.secrets(id) on delete restrict,
  payload jsonb not null default '{}'::jsonb check(not (payload::text ~* '(token|password|secret|pin)')),
  delivery_status text not null default 'queued' check(delivery_status in('queued','processing','sent','retryable_failure','permanent_failure')),
  retry_count integer not null default 0 check(retry_count between 0 and 20), next_attempt_at timestamptz, last_attempt_at timestamptz,
  last_error_code text check(last_error_code is null or (length(last_error_code)<=80 and last_error_code~'^[A-Za-z0-9_.:-]+$')),
  provider_message_reference text, created_at timestamptz not null default now(), sent_at timestamptz, failed_at timestamptz,
  unique(organisation_id,id), foreign key(organisation_id,invitation_id) references public.organisation_invitations(organisation_id,id) on delete restrict
);
create unique index message_outbox_invitation_active_key on public.message_outbox(invitation_id) where delivery_status in('queued','processing','sent','retryable_failure');

create table public.manager_invitation_audit_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  invitation_id uuid not null, event_type text not null check(event_type in('created','delivery_failed','resent','revoked','accepted')),
  actor_auth_user_id uuid, actor_membership_id uuid, request_id uuid, safe_metadata jsonb not null default '{}'::jsonb
    check(not (safe_metadata::text ~* '(email|token|password|secret|pin|address)')),
  created_at timestamptz not null default now(),
  foreign key(organisation_id,invitation_id) references public.organisation_invitations(organisation_id,id) on delete restrict,
  foreign key(organisation_id,actor_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict
);

alter table public.message_outbox enable row level security;
alter table public.manager_invitation_audit_events enable row level security;
revoke all on public.message_outbox,public.manager_invitation_audit_events from public,anon,authenticated;
grant select on public.manager_invitation_audit_events to authenticated;
create policy manager_invitation_audit_select on public.manager_invitation_audit_events for select to authenticated
  using(private.has_permission(organisation_id,'organisation.audit.read'));

revoke select,insert,update,delete on public.organisation_invitations,public.organisation_invitation_roles,
  public.organisation_invitation_site_access from authenticated;
grant select on public.organisation_invitations,public.organisation_invitation_roles,public.organisation_invitation_site_access to authenticated;
drop policy if exists organisation_invitations_insert on public.organisation_invitations;
drop policy if exists organisation_invitations_update on public.organisation_invitations;
drop policy if exists organisation_invitation_roles_insert on public.organisation_invitation_roles;
drop policy if exists organisation_invitation_roles_update on public.organisation_invitation_roles;
drop policy if exists organisation_invitation_site_access_insert on public.organisation_invitation_site_access;
drop policy if exists organisation_invitation_site_access_update on public.organisation_invitation_site_access;

create or replace function private.can_grant_manager_role(target_organisation_id uuid,target_membership_id uuid,target_role text)
returns boolean language sql stable security definer set search_path='' as $$
  select target_role in('organisation_admin','hr_admin','payroll_admin','site_manager','scheduler') and exists(
    select 1 from public.organisation_memberships m join public.membership_role_assignments r
      on r.organisation_id=m.organisation_id and r.membership_id=m.id and r.revoked_at is null
    where m.organisation_id=target_organisation_id and m.id=target_membership_id and m.status='active'
      and r.scope_type='organisation' and (r.role='organisation_owner' or (r.role='organisation_admin' and target_role in('site_manager','scheduler')))
  )
$$;

create or replace function private.manager_invitation_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'soleManagerAcknowledged',coalesce((select status='skipped' from public.onboarding_step_states where session_id=target_session_id and step_key='manager_invitations'),false),
    'availableSites',coalesce((select jsonb_agg(jsonb_build_object('id',site.id,'name',site.name) order by site.name) from public.onboarding_sessions s join public.organisation_sites site on site.organisation_id=s.organisation_id and site.active and site.archived_at is null where s.id=target_session_id),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.invited_email,'role',r.role,'scopeType',r.scope_type,
      'siteIds',coalesce((select jsonb_agg(a.site_id order by a.site_id) from public.organisation_invitation_site_access a where a.invitation_id=i.id),'[]'::jsonb),
      'status',case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status::text end,
      'deliveryStatus',coalesce(case when o.delivery_status='processing' then 'queued' else o.delivery_status end,'permanent_failure'),'createdAt',i.created_at,'expiresAt',i.expires_at,'acceptedAt',i.accepted_at) order by i.created_at desc)
      from public.onboarding_sessions s join public.organisation_invitations i on i.organisation_id=s.organisation_id and i.invitation_kind='manager'
      join lateral(select role,scope_type from public.organisation_invitation_roles where invitation_id=i.id order by id limit 1)r on true
      left join lateral(select delivery_status from public.message_outbox where invitation_id=i.id order by created_at desc limit 1)o on true
      where s.id=target_session_id),'[]'::jsonb))
$$;

alter function private.commercial_onboarding_snapshot(uuid) rename to commercial_onboarding_snapshot_7d;
alter function public.get_or_create_onboarding_bootstrap() rename to get_or_create_onboarding_bootstrap_7d;
alter function public.get_or_create_onboarding_bootstrap_7d() set schema private;
alter function public.execute_onboarding_bootstrap_command(jsonb) rename to execute_onboarding_bootstrap_command_7d;
alter function public.execute_onboarding_bootstrap_command_7d(jsonb) set schema private;

create or replace function private.commercial_onboarding_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.commercial_onboarding_snapshot_7d(target_session_id)||jsonb_build_object(
    'steps',coalesce((select jsonb_agg(jsonb_build_object('stepKey',step_key,'status',status,'revision',revision::text,'draftPayload',draft_payload,'validationSummary',validation_summary)
      order by case step_key when 'owner_security' then 1 when 'legal_acceptance' then 2 when 'organisation' then 3 when 'first_site' then 4 when 'subscription' then 5 when 'staffing' then 6 when 'manager_invitations' then 7 else 99 end)
      from public.onboarding_step_states where session_id=target_session_id and step_key in('owner_security','legal_acceptance','organisation','first_site','subscription','staffing','manager_invitations')),'[]'::jsonb),
    'managerInvitations',private.manager_invitation_snapshot(target_session_id))
$$;

create or replace function public.get_or_create_onboarding_bootstrap()
returns jsonb language plpgsql security definer set search_path='' as $$
declare initial jsonb; target_id uuid;target_organisation_id uuid;released_secret_ids uuid[];
begin
  initial:=private.get_or_create_onboarding_bootstrap_7d();target_id:=(initial->'session'->>'id')::uuid;
  select organisation_id into target_organisation_id from public.onboarding_sessions where id=target_id;
  insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision)
    select id,organisation_id,'manager_invitations',1,'not_started',0 from public.onboarding_sessions where id=target_id
    on conflict(session_id,step_key) do nothing;
  select array_agg(outbox.delivery_secret_id) into released_secret_ids from public.message_outbox outbox join public.organisation_invitations invitation on invitation.id=outbox.invitation_id
    where invitation.organisation_id=target_organisation_id and invitation.invitation_kind='manager' and invitation.status='pending' and invitation.expires_at<=now() and outbox.delivery_status in('queued','processing','retryable_failure') and outbox.delivery_secret_id is not null;
  update public.message_outbox outbox set delivery_status='permanent_failure',failed_at=coalesce(failed_at,now()),last_error_code='invitation_expired',delivery_secret_id=null
    from public.organisation_invitations invitation where invitation.id=outbox.invitation_id and invitation.organisation_id=target_organisation_id and invitation.invitation_kind='manager' and invitation.status='pending' and invitation.expires_at<=now() and outbox.delivery_status in('queued','processing','retryable_failure');
  update public.organisation_invitations set status='expired' where organisation_id=target_organisation_id and invitation_kind='manager' and status='pending' and expires_at<=now();
  delete from vault.secrets where id=any(coalesce(released_secret_ids,'{}'::uuid[]));
  return private.commercial_onboarding_snapshot(target_id);
end $$;

alter table public.onboarding_command_receipts drop constraint onboarding_command_receipts_command_type_check;
alter table public.onboarding_command_receipts add constraint onboarding_command_receipts_command_type_check check(command_type in(
  'save_step_draft','accept_legal_documents','complete_owner_setup','create_organisation','create_first_site','select_plan','save_settings',
  'save_staff_draft','create_staff','preview_staff_import','review_staff_import_row','commit_staff_import','complete_staffing','skip_staffing',
  'create_manager_invitation','resend_manager_invitation','revoke_manager_invitation','acknowledge_sole_manager','complete_manager_invitation_step',
  'create_staff_invitations','start_kiosk_registration','confirm_kiosk_connection','evaluate_readiness','go_live'));
alter table public.onboarding_events drop constraint onboarding_events_event_type_check;
alter table public.onboarding_events add constraint onboarding_events_event_type_check check(event_type in(
  'workflow_started','onboarding_started','signup_started','owner_email_verified','owner_mfa_enrolled','owner_mfa_ready','owner_security_completed','legal_acceptance_completed',
  'organisation_creation_started','organisation_created','first_site_started','first_site_validation_failed','first_site_defaults_created','first_site_created',
  'plan_selection_started','plan_selected','trial_selected','trial_pending_created','subscription_step_completed','trial_activated','settings_completed',
  'staff_import_started','staffing_started','staff_manual_created','staff_import_uploaded','staff_import_validated','staff_import_reviewed','staff_import_committed','staffing_skipped','staffing_completed',
  'manager_invitation_step_started','manager_invitation_created','manager_invitation_delivery_failed','manager_invitation_resent','manager_invitation_revoked','manager_invitation_accepted','sole_manager_acknowledged','manager_invitation_step_completed',
  'staff_invitations_created','kiosk_registration_started','kiosk_connected','readiness_evaluated','go_live_blocked','go_live_completed','workflow_abandoned'));

create or replace function private.execute_manager_invitation_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare session_row public.onboarding_sessions%rowtype; member public.organisation_memberships%rowtype; receipt public.onboarding_command_receipts%rowtype;
  existing public.onboarding_command_receipts%rowtype; payload jsonb:=command_envelope->'payload'; command_type text:=command_envelope->>'commandType';
  key_value uuid;expected_revision bigint;hash_value text;result_code text;issues jsonb:='[]';reference jsonb:='{}';event_name text;lifetime_days integer:=7;
  invitation public.organisation_invitations%rowtype;new_invitation public.organisation_invitations%rowtype;new_invitation_id uuid;raw_token text;delivery_secret_id_value uuid;released_secret_ids uuid[];target_email text;target_role text;target_scope text;site_value jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501';end if;
  if jsonb_typeof(command_envelope)<>'object' or jsonb_typeof(payload)<>'object' or command_envelope->>'schemaVersion'<>'1'
    or command_envelope->>'workflowKey'<>'commercial_customer_v1' or command_envelope->>'workflowVersion'<>'1'
    or not((command_envelope->>'sessionId')~*'^[0-9a-f-]{36}$') or not((command_envelope->>'idempotencyKey')~*'^[0-9a-f-]{36}$')
    or not((command_envelope->>'expectedSessionRevision')~'^(0|[1-9][0-9]*)$') then raise exception 'invalid onboarding command envelope' using errcode='22023';end if;
  key_value:=(command_envelope->>'idempotencyKey')::uuid;expected_revision:=(command_envelope->>'expectedSessionRevision')::bigint;hash_value:=private.onboarding_request_digest(command_envelope);
  select * into session_row from public.onboarding_sessions where id=(command_envelope->>'sessionId')::uuid for update;
  if not found or session_row.owner_auth_user_id<>auth.uid() or session_row.organisation_id is null then result_code:='permission_denied';end if;
  if result_code is null then select * into member from public.organisation_memberships where organisation_id=session_row.organisation_id and auth_user_id=auth.uid() and status='active' for update;
    if not found or not private.has_permission(session_row.organisation_id,'membership.manage') then result_code:='permission_denied';end if;end if;
  if result_code is null then select manager_invitation_lifetime_days into lifetime_days from public.organisation_settings where organisation_id=session_row.organisation_id;end if;
  if result_code is null and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then result_code:='mfa_required';end if;
  if result_code is null and session_row.revision<>expected_revision then result_code:='stale_session_revision';end if;
  select * into existing from public.onboarding_command_receipts r where r.session_id=session_row.id and r.command_type=command_type and r.idempotency_key=key_value;
  if found then
    if result_code in('permission_denied','mfa_required') then return private.onboarding_command_response(command_envelope,'permission_denied','not_saved',result_code,'{}',session_row.revision,
      jsonb_build_array(jsonb_build_object('code',result_code,'message','This invitation command is not available. Nothing was saved.','fieldPath','[]'::jsonb,'repairRoute',case when result_code='mfa_required' then '/mfa' else '/onboarding/managers' end)),null)||jsonb_build_object('bootstrap',null);end if;
    if existing.request_hash<>hash_value then result_code:='idempotency_key_reused';
    elsif existing.status in('succeeded','failed_final') then return private.onboarding_command_response(command_envelope,case when existing.status='succeeded' then 'replayed' else existing.result_outcome end,
      existing.result_data_state,existing.result_code,coalesce(existing.result_reference,'{}'),existing.result_session_revision,coalesce(existing.result_issues,'[]'),
      coalesce(existing.result_readiness,private.onboarding_foundation_readiness(session_row.id,existing.id)))||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(session_row.id));end if;
  end if;
  if existing.id is null then insert into public.onboarding_command_receipts(session_id,organisation_id,command_type,idempotency_key,request_hash,status)
    values(session_row.id,session_row.organisation_id,command_type,key_value,hash_value,'processing') returning * into receipt;else receipt:=existing;end if;

  if result_code is null and command_type='create_manager_invitation' then
    target_email:=lower(btrim(payload->>'email'));target_role:=payload->>'role';target_scope:=payload->>'scopeType';
    if (select count(*) from jsonb_object_keys(payload))<>4 or not(payload?'email' and payload?'role' and payload?'scopeType' and payload?'siteIds')
      or jsonb_typeof(payload->'email')<>'string' or jsonb_typeof(payload->'role')<>'string' or jsonb_typeof(payload->'scopeType')<>'string' or jsonb_typeof(payload->'siteIds')<>'array'
      or target_email!~*'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(target_email)>254 then result_code:='invalid_invitation_payload';end if;
    if result_code is null and (jsonb_array_length(payload->'siteIds')>50 or (select count(*) from jsonb_array_elements_text(payload->'siteIds'))<>(select count(distinct value) from jsonb_array_elements_text(payload->'siteIds'))) then result_code:='invalid_site_scope';end if;
    if result_code is null and not private.can_grant_manager_role(session_row.organisation_id,member.id,target_role) then result_code:='ungrantable_role';end if;
    if result_code is null and ((target_role in('organisation_admin','hr_admin','payroll_admin') and (target_scope<>'organisation' or jsonb_array_length(payload->'siteIds')<>0))
      or (target_role in('site_manager','scheduler') and (target_scope<>'site' or jsonb_array_length(payload->'siteIds')=0))) then result_code:='invalid_role_scope';end if;
    if result_code is null and exists(select 1 from jsonb_array_elements(payload->'siteIds')s where jsonb_typeof(s.value)<>'string' or (s.value#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then result_code:='invalid_site_scope';end if;
    if result_code is null and exists(select 1 from jsonb_array_elements_text(payload->'siteIds')s left join public.organisation_sites site on site.id=s::uuid and site.organisation_id=session_row.organisation_id and site.active and site.archived_at is null where site.id is null) then result_code:='invalid_site_scope';end if;
    if result_code is null and exists(select 1 from auth.users u join public.organisation_memberships m on m.auth_user_id=u.id where lower(u.email)=target_email and m.organisation_id=session_row.organisation_id and m.status in('active','suspended')) then result_code:='membership_already_exists';end if;
    if result_code is null and exists(select 1 from public.organisation_invitations where organisation_id=session_row.organisation_id and invited_email=target_email and status='pending') then result_code:='active_invitation_exists';end if;
    if result_code is null then raw_token:=encode(extensions.gen_random_bytes(32),'hex');insert into public.organisation_invitations(organisation_id,invited_email,token_hash,status,expires_at,invited_by_membership_id,invitation_kind,template_version)
      values(session_row.organisation_id,target_email,sha256(convert_to(raw_token,'UTF8')),'pending',now()+make_interval(days=>coalesce(lifetime_days,7)),member.id,'manager','manager_invitation_v1') returning * into invitation;
      if target_scope='organisation' then insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type,site_id)
        values(session_row.organisation_id,invitation.id,target_role::public.organisation_role,'organisation',null);
      else for site_value in select value from jsonb_array_elements(payload->'siteIds') loop
        insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type,site_id)
          values(session_row.organisation_id,invitation.id,target_role::public.organisation_role,'site',(site_value#>>'{}')::uuid);
        insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) values(session_row.organisation_id,invitation.id,(site_value#>>'{}')::uuid);end loop;end if;
      delivery_secret_id_value:=vault.create_secret(raw_token,'manager-invitation-'||invitation.id::text,'Encrypted delivery material for one manager invitation');
      insert into public.message_outbox(organisation_id,message_type,recipient_address,invitation_id,template_version,delivery_secret_id,payload,next_attempt_at)
        values(session_row.organisation_id,'manager_invitation',target_email,invitation.id,'manager_invitation_v1',delivery_secret_id_value,jsonb_build_object('invitationId',invitation.id),now());
      reference:=jsonb_build_object('invitationIds',jsonb_build_array(invitation.id));event_name:='manager_invitation_created';end if;
  elsif result_code is null and command_type='resend_manager_invitation' then
    if (select count(*) from jsonb_object_keys(payload))<>1 or not(payload?'invitationId') or jsonb_typeof(payload->'invitationId')<>'string' or (payload->>'invitationId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then result_code:='invalid_invitation_payload';end if;
    if result_code is null then select * into invitation from public.organisation_invitations where id=(payload->>'invitationId')::uuid and organisation_id=session_row.organisation_id and invitation_kind='manager' for update;end if;
    if result_code is not null then null;
    elsif not found or invitation.status='accepted' then result_code:='invitation_not_available';
    elsif exists(select 1 from public.organisation_invitation_roles r where r.invitation_id=invitation.id and not private.can_grant_manager_role(invitation.organisation_id,member.id,r.role::text))
      or exists(select 1 from public.organisation_invitation_roles r left join public.organisation_sites s on s.id=r.site_id and s.organisation_id=r.organisation_id and s.active and s.archived_at is null where r.invitation_id=invitation.id and r.scope_type='site' and s.id is null) then result_code:='authority_changed';
    else raw_token:=encode(extensions.gen_random_bytes(32),'hex');new_invitation_id:=gen_random_uuid();
      update public.organisation_invitations set status='superseded',superseded_at=now() where id=invitation.id;
      insert into public.organisation_invitations(id,organisation_id,invited_email,token_hash,status,expires_at,invited_by_membership_id,invitation_kind,template_version,resend_of_invitation_id)
        values(new_invitation_id,invitation.organisation_id,invitation.invited_email,sha256(convert_to(raw_token,'UTF8')),'pending',now()+make_interval(days=>coalesce(lifetime_days,7)),member.id,'manager','manager_invitation_v1',invitation.id) returning * into new_invitation;
      insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type,site_id) select organisation_id,new_invitation.id,role,scope_type,site_id from public.organisation_invitation_roles where invitation_id=invitation.id;
      insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) select organisation_id,new_invitation.id,site_id from public.organisation_invitation_site_access where invitation_id=invitation.id;
      update public.organisation_invitations set superseded_by_invitation_id=new_invitation.id where id=invitation.id;
      select array_agg(delivery_secret_id) into released_secret_ids from public.message_outbox where invitation_id=invitation.id and delivery_status in('queued','processing','retryable_failure');
      update public.message_outbox set delivery_status='permanent_failure',failed_at=now(),delivery_secret_id=null where invitation_id=invitation.id and delivery_status in('queued','processing','retryable_failure');
      delete from vault.secrets where id=any(coalesce(released_secret_ids,'{}'::uuid[]));
      delivery_secret_id_value:=vault.create_secret(raw_token,'manager-invitation-'||new_invitation.id::text,'Encrypted delivery material for one manager invitation');
      insert into public.message_outbox(organisation_id,message_type,recipient_address,invitation_id,template_version,delivery_secret_id,payload,next_attempt_at) values(session_row.organisation_id,'manager_invitation',invitation.invited_email,new_invitation.id,'manager_invitation_v1',delivery_secret_id_value,jsonb_build_object('invitationId',new_invitation.id),now());
      invitation:=new_invitation;reference:=jsonb_build_object('invitationIds',jsonb_build_array(invitation.id));event_name:='manager_invitation_resent';end if;
  elsif result_code is null and command_type='revoke_manager_invitation' then
    if (select count(*) from jsonb_object_keys(payload))<>1 or not(payload?'invitationId') or jsonb_typeof(payload->'invitationId')<>'string' or (payload->>'invitationId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then result_code:='invalid_invitation_payload';end if;
    if result_code is null then select * into invitation from public.organisation_invitations where id=(payload->>'invitationId')::uuid and organisation_id=session_row.organisation_id and invitation_kind='manager' for update;end if;
    if result_code is not null then null;elsif not found or invitation.status in('accepted','superseded') then result_code:='invitation_not_available';else
      if invitation.status not in('revoked','expired') then update public.organisation_invitations set status='revoked',revoked_at=now(),revoked_by_membership_id=member.id where id=invitation.id;end if;
      select array_agg(delivery_secret_id) into released_secret_ids from public.message_outbox where invitation_id=invitation.id and delivery_status in('queued','processing','retryable_failure');
      update public.message_outbox set delivery_status='permanent_failure',failed_at=coalesce(failed_at,now()),delivery_secret_id=null where invitation_id=invitation.id and delivery_status in('queued','processing','retryable_failure');
      delete from vault.secrets where id=any(coalesce(released_secret_ids,'{}'::uuid[]));
      reference:=jsonb_build_object('invitationIds',jsonb_build_array(invitation.id));event_name:='manager_invitation_revoked';end if;
  elsif result_code is null and command_type='acknowledge_sole_manager' then
    if (select count(*) from jsonb_object_keys(payload))<>1 or payload->>'acknowledgement'<>'sole_manager_for_now' then result_code:='acknowledgement_required';else event_name:='sole_manager_acknowledged';end if;
  elsif result_code is null and command_type='complete_manager_invitation_step' then
    if payload<>'{}'::jsonb then result_code:='invalid_invitation_payload';elsif not exists(select 1 from public.organisation_invitations where organisation_id=session_row.organisation_id and invitation_kind='manager' and status in('pending','accepted')) then result_code:='manager_decision_required';else event_name:='manager_invitation_step_completed';end if;
  elsif result_code is null then result_code:='unsupported_manager_invitation_command';end if;

  if result_code is not null then issues:=jsonb_build_array(jsonb_build_object('code',result_code,'message',case when result_code='stale_session_revision' then 'Onboarding changed after this page was opened. Reload and try again.' when result_code='mfa_required' then 'Complete multi-factor authentication before continuing.' else 'Nothing was saved. Review the invitation and try again.' end,'fieldPath','[]'::jsonb,'repairRoute',case when result_code='mfa_required' then '/mfa' else '/onboarding/managers' end));
    update public.onboarding_command_receipts set status='failed_final',result_code=result_code,result_outcome=case when result_code='stale_session_revision' then 'workflow_changed' when result_code in('permission_denied','mfa_required') then 'permission_denied' else 'validation_failed' end,result_data_state='not_saved',result_session_revision=session_row.revision,result_issues=issues,completed_at=now() where id=receipt.id;
    return private.onboarding_command_response(command_envelope,case when result_code='stale_session_revision' then 'workflow_changed' when result_code in('permission_denied','mfa_required') then 'permission_denied' else 'validation_failed' end,'not_saved',result_code,'{}',session_row.revision,issues,private.onboarding_foundation_readiness(session_row.id,receipt.id))||jsonb_build_object('bootstrap',case when result_code in('permission_denied','mfa_required') then null else private.commercial_onboarding_snapshot(session_row.id) end);end if;

  if event_name in('sole_manager_acknowledged','manager_invitation_step_completed') then update public.onboarding_step_states set status=case when event_name='sole_manager_acknowledged' then 'skipped' else 'complete' end,revision=revision+1,started_at=coalesce(started_at,now()),completed_at=now(),last_saved_at=now(),completed_by_auth_user_id=auth.uid() where session_id=session_row.id and step_key='manager_invitations';
    update public.onboarding_sessions set current_step_key='staff_invitations',revision=revision+1,last_activity_at=now() where id=session_row.id returning * into session_row;
  else update public.onboarding_step_states set status='in_progress',revision=revision+1,started_at=coalesce(started_at,now()),last_saved_at=now() where session_id=session_row.id and step_key='manager_invitations';
    update public.onboarding_sessions set current_step_key='manager_invitations',revision=revision+1,last_activity_at=now() where id=session_row.id returning * into session_row;end if;
  if invitation.id is not null then insert into public.manager_invitation_audit_events(organisation_id,invitation_id,event_type,actor_auth_user_id,actor_membership_id,request_id,safe_metadata)
    values(session_row.organisation_id,invitation.id,case event_name when 'manager_invitation_created' then 'created' when 'manager_invitation_resent' then 'resent' else 'revoked' end,auth.uid(),member.id,key_value,jsonb_build_object('statusCode',event_name));end if;
  insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata)
    values(session_row.id,session_row.organisation_id,event_name,'manager_invitations','owner',auth.uid(),member.id,key_value,session_row.revision,jsonb_build_object('statusCode',event_name));
  update public.onboarding_command_receipts set status='succeeded',result_code=event_name,result_outcome='succeeded',result_data_state='saved',result_session_revision=session_row.revision,result_reference=reference,result_issues='[]',completed_at=now() where id=receipt.id;
  return private.onboarding_command_response(command_envelope,'succeeded','saved',event_name,reference,session_row.revision,'[]',private.onboarding_foundation_readiness(session_row.id,receipt.id))
    ||jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(session_row.id));
end $$;

create or replace function public.execute_onboarding_bootstrap_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin
  if command_envelope->>'commandType' in('create_manager_invitation','resend_manager_invitation','revoke_manager_invitation','acknowledge_sole_manager','complete_manager_invitation_step') then return private.execute_manager_invitation_command(command_envelope);end if;
  return private.execute_onboarding_bootstrap_command_7d(command_envelope);
end$$;

create or replace function public.inspect_manager_invitation(invitation_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare invitation public.organisation_invitations%rowtype; organisation_name text; role_label text;
begin
  if invitation_token is null or length(invitation_token)<32 then return jsonb_build_object('state','unavailable');end if;
  select * into invitation from public.organisation_invitations where token_hash=sha256(convert_to(invitation_token,'UTF8')) and invitation_kind='manager';
  if not found then return jsonb_build_object('state','unavailable');end if;
  select display_name into organisation_name from public.organisations where id=invitation.organisation_id;
  select replace(role::text,'_',' ') into role_label from public.organisation_invitation_roles where invitation_id=invitation.id order by id limit 1;
  return jsonb_build_object('state',case when invitation.status='pending' and invitation.expires_at<=now() then 'expired' else invitation.status::text end,
    'organisationName',organisation_name,'roleLabel',role_label,'expiresAt',invitation.expires_at,'requiresMfa',true);
end$$;

create or replace function public.accept_manager_invitation(invitation_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.organisation_invitations%rowtype;current_email text;email_confirmed_at_value timestamptz;member public.organisation_memberships%rowtype;session_id_value uuid;released_secret_ids uuid[];
  intended record;actor_type_value text:='member';
begin
  if auth.uid() is null then return jsonb_build_object('outcome','sign_in_required');end if;
  if invitation_token is null or length(invitation_token)<32 then return jsonb_build_object('outcome','unavailable');end if;
  select * into invitation from public.organisation_invitations where token_hash=sha256(convert_to(invitation_token,'UTF8')) and invitation_kind='manager' for update;
  if not found then return jsonb_build_object('outcome','unavailable');end if;
  select lower(email),email_confirmed_at into current_email,email_confirmed_at_value from auth.users where id=auth.uid();
  if current_email is null or current_email<>invitation.invited_email then return jsonb_build_object('outcome','unavailable');end if;
  if email_confirmed_at_value is null then return jsonb_build_object('outcome','email_verification_required');end if;
  if invitation.status='accepted' then
    if exists(select 1 from public.organisation_memberships where id=invitation.accepted_by_membership_id and auth_user_id=auth.uid()) then
      return jsonb_build_object('outcome','already_accepted','organisationId',invitation.organisation_id,'membershipId',invitation.accepted_by_membership_id);end if;
    return jsonb_build_object('outcome','unavailable');
  end if;
  if invitation.status='revoked' then return jsonb_build_object('outcome','revoked');end if;
  if invitation.status='superseded' then return jsonb_build_object('outcome','superseded');end if;
  if invitation.status='expired' or invitation.expires_at<=now() then
    select array_agg(delivery_secret_id) into released_secret_ids from public.message_outbox where invitation_id=invitation.id and delivery_status in('queued','processing','retryable_failure') and delivery_secret_id is not null;
    update public.message_outbox set delivery_status='permanent_failure',failed_at=coalesce(failed_at,now()),last_error_code='invitation_expired',delivery_secret_id=null where invitation_id=invitation.id and delivery_status in('queued','processing','retryable_failure');
    update public.organisation_invitations set status='expired' where id=invitation.id;
    delete from vault.secrets where id=any(coalesce(released_secret_ids,'{}'::uuid[]));
    return jsonb_build_object('outcome','expired');end if;
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then return jsonb_build_object('outcome','mfa_required');end if;
  if not exists(select 1 from public.organisation_memberships m where m.id=invitation.invited_by_membership_id and m.organisation_id=invitation.organisation_id and m.status='active') then return jsonb_build_object('outcome','authority_changed');end if;
  if exists(select 1 from public.organisation_invitation_roles r where r.invitation_id=invitation.id and not private.can_grant_manager_role(invitation.organisation_id,invitation.invited_by_membership_id,r.role::text)) then return jsonb_build_object('outcome','authority_changed');end if;
  if exists(select 1 from public.organisation_invitation_roles r left join public.organisation_sites s on s.id=r.site_id and s.organisation_id=r.organisation_id and s.active and s.archived_at is null where r.invitation_id=invitation.id and r.scope_type='site' and s.id is null) then return jsonb_build_object('outcome','scope_changed');end if;
  select * into member from public.organisation_memberships where organisation_id=invitation.organisation_id and auth_user_id=auth.uid() for update;
  if found and member.status in('active','suspended') then return jsonb_build_object('outcome','membership_already_exists');end if;
  if found then update public.organisation_memberships set status='active',joined_at=coalesce(joined_at,now()),suspended_at=null,revoked_at=null where id=member.id returning * into member;
  else insert into public.organisation_memberships(organisation_id,auth_user_id,status,joined_at,created_by_membership_id) values(invitation.organisation_id,auth.uid(),'active',now(),invitation.invited_by_membership_id) returning * into member;end if;
  insert into public.membership_role_assignments(organisation_id,membership_id,role,scope_type,site_id,granted_by_membership_id)
    select organisation_id,member.id,role,scope_type,site_id,invitation.invited_by_membership_id from public.organisation_invitation_roles where invitation_id=invitation.id;
  insert into public.membership_site_access(organisation_id,membership_id,site_id,granted_by_membership_id)
    select organisation_id,member.id,site_id,invitation.invited_by_membership_id from public.organisation_invitation_site_access where invitation_id=invitation.id;
  update public.organisation_invitations set status='accepted',accepted_by_membership_id=member.id,accepted_at=now() where id=invitation.id;
  select array_agg(delivery_secret_id) into released_secret_ids from public.message_outbox where invitation_id=invitation.id and delivery_secret_id is not null;
  update public.message_outbox set delivery_secret_id=null where invitation_id=invitation.id;
  delete from vault.secrets where id=any(coalesce(released_secret_ids,'{}'::uuid[]));
  insert into public.manager_invitation_audit_events(organisation_id,invitation_id,event_type,actor_auth_user_id,actor_membership_id,safe_metadata)
    values(invitation.organisation_id,invitation.id,'accepted',auth.uid(),member.id,jsonb_build_object('statusCode','accepted'));
  select id into session_id_value from public.onboarding_sessions where organisation_id=invitation.organisation_id order by created_at limit 1;
  if session_id_value is not null then insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,workflow_revision,safe_metadata)
    select session_id_value,invitation.organisation_id,'manager_invitation_accepted','manager_invitations',actor_type_value,auth.uid(),member.id,revision,jsonb_build_object('statusCode','accepted') from public.onboarding_sessions where id=session_id_value;end if;
  return jsonb_build_object('outcome','accepted','organisationId',invitation.organisation_id,'membershipId',member.id,'authorisationRevision',coalesce(to_jsonb(member)->>'authorisation_revision','0'));
exception when unique_violation or foreign_key_violation then return jsonb_build_object('outcome','unavailable');
end$$;

create or replace function public.claim_manager_invitation_delivery(invitation_id_value uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare outbox public.message_outbox%rowtype;decrypted_token text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
  select * into outbox from public.message_outbox where invitation_id=invitation_id_value
    and (delivery_status in('queued','retryable_failure') and coalesce(next_attempt_at,now())<=now() or delivery_status='processing' and last_attempt_at<now()-interval '15 minutes')
    order by created_at desc limit 1 for update skip locked;
  if not found then return jsonb_build_object('outcome','not_available');end if;
  select decrypted_secret into decrypted_token from vault.decrypted_secrets where id=outbox.delivery_secret_id;
  if decrypted_token is null then return jsonb_build_object('outcome','not_available');end if;
  update public.message_outbox set delivery_status='processing',last_attempt_at=now() where id=outbox.id;
  return jsonb_build_object('outcome','claimed','invitationId',outbox.invitation_id,'recipientAddress',outbox.recipient_address,
    'templateVersion',outbox.template_version,'invitationToken',decrypted_token,'attemptCount',outbox.retry_count);
end$$;

create or replace function public.preview_manager_invitation_token(invitation_id_value uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare decrypted_token text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
  select secret.decrypted_secret into decrypted_token from public.organisation_invitations invitation
    join public.message_outbox outbox on outbox.invitation_id=invitation.id and outbox.delivery_secret_id is not null
    join vault.decrypted_secrets secret on secret.id=outbox.delivery_secret_id
    where invitation.id=invitation_id_value and invitation.invitation_kind='manager' and invitation.status='pending' and invitation.expires_at>now()
    order by outbox.created_at desc limit 1;
  if decrypted_token is null then return jsonb_build_object('outcome','not_available');end if;
  return jsonb_build_object('outcome','available','invitationToken',decrypted_token);
end$$;

create or replace function public.record_manager_invitation_delivery(invitation_id_value uuid, delivery_outcome text, provider_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare outbox public.message_outbox%rowtype;next_status text;session_id_value uuid;workflow_revision_value bigint;secret_id_value uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
  if delivery_outcome not in('sent','retryable_failure','permanent_failure') or (provider_code is not null and (length(provider_code)>80 or provider_code!~'^[A-Za-z0-9_.:-]+$')) then raise exception 'invalid delivery outcome' using errcode='22023';end if;
  select * into outbox from public.message_outbox where invitation_id=invitation_id_value and delivery_status='processing' order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('outcome','not_available');end if;
  secret_id_value:=outbox.delivery_secret_id;
  next_status:=case when delivery_outcome='retryable_failure' and outbox.retry_count>=4 then 'permanent_failure' else delivery_outcome end;
  update public.message_outbox set delivery_status=next_status,retry_count=retry_count+1,last_attempt_at=now(),sent_at=case when next_status='sent' then now() else sent_at end,
    failed_at=case when next_status='permanent_failure' then now() else failed_at end,next_attempt_at=case when next_status='retryable_failure' then now()+make_interval(mins=>least(60,5*(outbox.retry_count+1))) else null end,
    last_error_code=case when next_status='sent' then null else coalesce(provider_code,'delivery_failed') end,
    delivery_secret_id=case when next_status in('sent','permanent_failure') then null else delivery_secret_id end where id=outbox.id returning * into outbox;
  if next_status in('sent','permanent_failure') and secret_id_value is not null then delete from vault.secrets where id=secret_id_value;end if;
  if next_status<>'sent' then
    insert into public.manager_invitation_audit_events(organisation_id,invitation_id,event_type,actor_auth_user_id,safe_metadata)
      values(outbox.organisation_id,outbox.invitation_id,'delivery_failed',null,jsonb_build_object('statusCode',next_status,'providerCode',coalesce(provider_code,'delivery_failed')));
    select id,revision into session_id_value,workflow_revision_value from public.onboarding_sessions where organisation_id=outbox.organisation_id order by created_at limit 1;
    if session_id_value is not null then insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,workflow_revision,safe_metadata)
      values(session_id_value,outbox.organisation_id,'manager_invitation_delivery_failed','manager_invitations','system',workflow_revision_value,jsonb_build_object('statusCode',next_status));end if;
  end if;
  return jsonb_build_object('outcome',next_status,'attemptCount',outbox.retry_count);
end$$;

insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision)
select id,organisation_id,'manager_invitations',1,'not_started',0 from public.onboarding_sessions on conflict(session_id,step_key) do nothing;

revoke all on function private.can_grant_manager_role(uuid,uuid,text),private.manager_invitation_snapshot(uuid),private.commercial_onboarding_snapshot_7d(uuid),
  private.get_or_create_onboarding_bootstrap_7d(),private.execute_onboarding_bootstrap_command_7d(jsonb),private.execute_manager_invitation_command(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_or_create_onboarding_bootstrap(),public.execute_onboarding_bootstrap_command(jsonb) from public,anon,authenticated,service_role;
do $$begin
  if to_regprocedure('public.accept_organisation_invitation(text)') is not null then
    execute 'revoke all on function public.accept_organisation_invitation(text) from public,anon,authenticated,service_role';
  end if;
end$$;
grant execute on function public.get_or_create_onboarding_bootstrap(),public.execute_onboarding_bootstrap_command(jsonb) to authenticated;
revoke all on function public.inspect_manager_invitation(text),public.accept_manager_invitation(text) from public,anon,authenticated,service_role;
revoke all on function public.claim_manager_invitation_delivery(uuid),public.preview_manager_invitation_token(uuid),public.record_manager_invitation_delivery(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.inspect_manager_invitation(text) to anon,authenticated;
grant execute on function public.accept_manager_invitation(text) to authenticated;
grant execute on function public.claim_manager_invitation_delivery(uuid),public.preview_manager_invitation_token(uuid) to service_role;
grant execute on function public.record_manager_invitation_delivery(uuid,text,text) to service_role;
