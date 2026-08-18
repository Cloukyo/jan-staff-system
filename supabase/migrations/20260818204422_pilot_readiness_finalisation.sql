-- Pilot readiness finalisation. Commercial-only additive security boundaries.

create or replace function private.verify_commercial_kiosk_pin_attempt(
  target_staff_id text,
  candidate_pin text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  failures integer;
begin
  select kiosk.* into settings
  from public.staff_kiosk_settings kiosk
  where kiosk.staff_id = target_staff_id
  for update;

  if not found or not settings.kiosk_enabled or settings.pin_hash is null or settings.pin_reset_required then
    return false;
  end if;
  if settings.locked_until is not null and settings.locked_until > clock_timestamp() then
    return false;
  end if;
  if extensions.crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set failed_attempt_count = failures,
        locked_until = case when failures >= 3 then clock_timestamp() + interval '15 minutes' else null end,
        updated_at = clock_timestamp()
    where staff_id = target_staff_id;
    return false;
  end if;

  update public.staff_kiosk_settings
  set failed_attempt_count = 0, locked_until = null, updated_at = clock_timestamp()
  where staff_id = target_staff_id;
  return true;
end
$$;

alter function public.perform_commercial_kiosk_attendance_action_7g(text,text,text,text,text,uuid)
  rename to perform_commercial_kiosk_attendance_action_before_pilot_pin_guard;

create or replace function public.perform_commercial_kiosk_attendance_action_7g(
  device_token text, target_staff_id text, candidate_pin text,
  requested_action text, expected_revision text, idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.kiosk_devices%rowtype;
begin
  select registered.* into device
  from public.kiosk_devices registered
  where registered.token_hash = sha256(convert_to(device_token, 'UTF8'))
    and registered.active and registered.expires_at > clock_timestamp()
    and registered.organisation_id is not null and registered.site_id is not null;
  if not found or not exists (
    select 1 from public.staff_site_assignments assignment
    where assignment.organisation_id = device.organisation_id
      and assignment.site_id = device.site_id
      and assignment.staff_id = target_staff_id
      and assignment.effective_from <= (clock_timestamp() at time zone 'Europe/London')::date
      and (assignment.effective_to is null or assignment.effective_to >= (clock_timestamp() at time zone 'Europe/London')::date)
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_pin');
  end if;
  if not private.verify_commercial_kiosk_pin_attempt(target_staff_id, candidate_pin) then
    return jsonb_build_object('ok', false, 'code', 'invalid_pin');
  end if;
  return public.perform_commercial_kiosk_attendance_action_before_pilot_pin_guard(
    device_token, target_staff_id, candidate_pin, requested_action, expected_revision, idempotency_key
  );
end
$$;

do $patch_verify$
declare
  definition text;
  old_block constant text := $old$select kiosk.* into settings from public.staff_kiosk_settings kiosk where kiosk.staff_id = target_staff_id;
  if not found or not settings.kiosk_enabled or settings.pin_hash is null
    or settings.pin_reset_required or extensions.crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    return jsonb_build_object('ok', false, 'code', 'invalid_pin');
  end if;$old$;
  new_block constant text := $new$if not private.verify_commercial_kiosk_pin_attempt(target_staff_id, candidate_pin) then
    return jsonb_build_object('ok', false, 'code', 'invalid_pin');
  end if;$new$;
begin
  if to_regprocedure('public.verify_commercial_device_kiosk_pin(text,text,text)') is not null then
    select pg_get_functiondef('public.verify_commercial_device_kiosk_pin(text,text,text)'::regprocedure) into definition;
    if position(old_block in definition) = 0 then
      raise exception 'commercial PIN verification guard source changed';
    end if;
    execute replace(definition, old_block, new_block);
  end if;
end
$patch_verify$;

create or replace function public.claim_commercial_kiosk(
  registration_id uuid,
  registration_secret text,
  claimant_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.commercial_kiosk_registrations%rowtype;
  d public.kiosk_devices%rowtype;
  nonce_hash bytea;
  scope_hash bytea;
  provided_hash bytea;
  raw_token text;
  attempts integer;
  total_attempts integer;
begin
  if registration_id is null
    or registration_secret !~ '^[A-HJ-NP-Z2-9]{16}$'
    or claimant_nonce !~ '^[A-Za-z0-9_-]{43,128}$' then
    return jsonb_build_object('outcome','invalid_code');
  end if;

  nonce_hash := sha256(convert_to(claimant_nonce,'UTF8'));
  provided_hash := sha256(convert_to(registration_secret,'UTF8'));
  scope_hash := sha256(convert_to(registration_id::text,'UTF8'));

  select * into r from public.commercial_kiosk_registrations
  where id = claim_commercial_kiosk.registration_id for update;
  if not found then return jsonb_build_object('outcome','invalid_code'); end if;

  select count(*)::int,
         count(*) filter(where attempt.claimant_nonce_hash=nonce_hash)::int
  into total_attempts, attempts
  from public.commercial_kiosk_claim_attempts attempt
  where attempt.attempt_scope_hash=scope_hash
    and not attempt.succeeded
    and attempt.attempted_at>now()-interval '5 minutes';
  if attempts>=6 or total_attempts>=30 then
    return jsonb_build_object('outcome','rate_limited');
  end if;

  if r.secret_hash<>provided_hash then
    insert into public.commercial_kiosk_claim_attempts(registration_id,attempt_scope_hash,claimant_nonce_hash,succeeded)
    values(r.id,scope_hash,nonce_hash,false);
    return jsonb_build_object('outcome','invalid_code');
  end if;
  if r.status='pending' and r.expires_at<=now() then
    update public.commercial_kiosk_registrations set status='expired',revision=revision+1,updated_at=now() where id=r.id;
    return jsonb_build_object('outcome','expired');
  end if;
  if r.status in('expired','revoked','failed') then return jsonb_build_object('outcome',r.status);end if;
  if r.status in('claimed','verified') and r.claimant_nonce_hash<>nonce_hash then return jsonb_build_object('outcome','already_claimed');end if;

  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  if r.status='pending' then
    insert into public.kiosk_devices(device_name,token_hash,active,expires_at,activated_by,organisation_id,site_id,activated_by_membership_id,offline_enabled,hardware_verified_at,registration_id,credential_rotated_at)
      values(r.intended_device_name,sha256(convert_to(raw_token,'UTF8')),true,now()+interval '180 days',null,r.organisation_id,r.site_id,r.requested_by_membership_id,false,null,r.id,now()) returning * into d;
    update public.commercial_kiosk_registrations set status='claimed',claimed_device_id=d.id,claimant_nonce_hash=nonce_hash,claimed_at=now(),revision=revision+1,updated_at=now() where id=r.id;
    insert into public.commercial_kiosk_claim_attempts(registration_id,attempt_scope_hash,claimant_nonce_hash,succeeded) values(r.id,scope_hash,nonce_hash,true);
    insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,workflow_revision,safe_metadata)
      select s.id,r.organisation_id,'kiosk_registration_claimed','kiosk','device',s.revision,jsonb_build_object('statusCode','claimed','resourceId',d.id)
      from public.onboarding_sessions s where s.organisation_id=r.organisation_id order by s.created_at limit 1;
    return jsonb_build_object('outcome','claimed','deviceId',d.id,'deviceToken',raw_token,'organisationId',r.organisation_id,'siteId',r.site_id,'expiresAt',d.expires_at);
  end if;

  update public.kiosk_devices set token_hash=sha256(convert_to(raw_token,'UTF8')),credential_revision=credential_revision+1,credential_rotated_at=now(),expires_at=now()+interval '180 days'
  where id=r.claimed_device_id and active returning * into d;
  if not found then return jsonb_build_object('outcome','revoked');end if;
  return jsonb_build_object('outcome','recovered','deviceId',d.id,'deviceToken',raw_token,'organisationId',d.organisation_id,'siteId',d.site_id,'expiresAt',d.expires_at);
end
$$;

create or replace function private.purge_commercial_kiosk_claim_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare removed integer;
begin
  delete from public.commercial_kiosk_claim_attempts where attempted_at < now() - interval '24 hours';
  get diagnostics removed = row_count;
  return removed;
end
$$;

revoke all on function private.verify_commercial_kiosk_pin_attempt(text,text),
  private.purge_commercial_kiosk_claim_attempts(),
  public.perform_commercial_kiosk_attendance_action_before_pilot_pin_guard(text,text,text,text,text,uuid),
  public.perform_commercial_kiosk_attendance_action_7g(text,text,text,text,text,uuid)
from public,anon,authenticated,service_role;
revoke all on function public.claim_commercial_kiosk(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_commercial_kiosk(uuid,text,text) to anon,authenticated;

create or replace function private.commercial_privileged_capacity_available(
  target_organisation_id uuid,
  consuming_invitation_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  seat_limit bigint;
  active_members bigint;
  pending_invitations bigint;
begin
  perform pg_advisory_xact_lock(hashtext(target_organisation_id::text));
  select entitlement.integer_value into seat_limit
  from public.organisation_entitlements entitlement
  join public.organisation_subscriptions subscription
    on subscription.organisation_id=entitlement.organisation_id
   and subscription.id=entitlement.subscription_id
   and subscription.is_current
  where entitlement.organisation_id=target_organisation_id
    and entitlement.capability_key='members.privileged.limit'
    and entitlement.superseded_at is null
  order by entitlement.effective_at desc limit 1;
  if seat_limit is null then return false; end if;

  select count(distinct membership.id) into active_members
  from public.organisation_memberships membership
  join public.membership_role_assignments assignment
    on assignment.organisation_id=membership.organisation_id
   and assignment.membership_id=membership.id
   and assignment.revoked_at is null
   and assignment.role in ('organisation_owner','organisation_admin','hr_admin','payroll_admin','site_manager','scheduler')
  where membership.organisation_id=target_organisation_id and membership.status='active';

  select count(*) into pending_invitations
  from public.organisation_invitations invitation
  where invitation.organisation_id=target_organisation_id
    and invitation.invitation_kind='manager'
    and invitation.status='pending'
    and invitation.expires_at>now();

  if consuming_invitation_id is null then
    return active_members + pending_invitations < seat_limit;
  end if;
  return active_members + pending_invitations <= seat_limit
    and exists(select 1 from public.organisation_invitations invitation
      where invitation.id=consuming_invitation_id
        and invitation.organisation_id=target_organisation_id
        and invitation.invitation_kind='manager'
        and invitation.status='pending'
        and invitation.expires_at>now());
end
$$;

create or replace function private.enforce_commercial_privileged_invitation_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invitation_kind='manager' and new.status='pending'
    and not private.commercial_privileged_capacity_available(new.organisation_id, null) then
    raise exception 'privileged_capacity_reached' using errcode='23514';
  end if;
  return new;
end
$$;

drop trigger if exists organisation_invitations_enforce_privileged_capacity on public.organisation_invitations;
create trigger organisation_invitations_enforce_privileged_capacity
before insert on public.organisation_invitations
for each row execute function private.enforce_commercial_privileged_invitation_capacity();

do $patch_manager_capacity$
declare
  definition text;
  old_create constant text := $old$if result_code is null and command_type='create_manager_invitation' then
    target_email:=$old$;
  new_create constant text := $new$if result_code is null and command_type='create_manager_invitation' then
    if not private.commercial_privileged_capacity_available(session_row.organisation_id, null) then result_code:='privileged_capacity_reached';end if;
    target_email:=$new$;
  old_accept constant text := $old$if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then return jsonb_build_object('outcome','mfa_required');end if;
  if not exists($old$;
  new_accept constant text := $new$if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then return jsonb_build_object('outcome','mfa_required');end if;
  if not private.commercial_privileged_capacity_available(invitation.organisation_id, invitation.id) then return jsonb_build_object('outcome','privileged_capacity_reached');end if;
  if not exists($new$;
begin
  select pg_get_functiondef('private.execute_manager_invitation_command(jsonb)'::regprocedure) into definition;
  if position(old_create in definition)=0 then raise exception 'manager invitation command capacity patch source changed';end if;
  execute replace(definition,old_create,new_create);

  select pg_get_functiondef('public.accept_manager_invitation(text)'::regprocedure) into definition;
  if position(old_accept in definition)=0 then raise exception 'manager invitation acceptance capacity patch source changed';end if;
  execute replace(definition,old_accept,new_accept);
end
$patch_manager_capacity$;

revoke all on function private.commercial_privileged_capacity_available(uuid,uuid),
  private.enforce_commercial_privileged_invitation_capacity()
from public,anon,authenticated,service_role;

alter table public.message_outbox
  add column if not exists notification_key text,
  add column if not exists provider_accepted_at timestamptz;
alter table public.message_outbox alter column invitation_id drop not null;
alter table public.message_outbox drop constraint if exists message_outbox_message_type_check;
alter table public.message_outbox add constraint message_outbox_message_type_check
  check(message_type in('manager_invitation','staff_invitation','trial_ending','payment_failure'));
alter table public.message_outbox drop constraint if exists message_outbox_template_version_check;
alter table public.message_outbox add constraint message_outbox_template_version_check
  check(template_version in('manager_invitation_v1','staff_invitation_v1','trial_ending_v1','payment_failure_v1'));
update public.message_outbox
set notification_key='invitation/'||invitation_id::text||'/'||id::text
where notification_key is null;
alter table public.message_outbox
  alter column notification_key set default ('message/'||gen_random_uuid()::text),
  alter column notification_key set not null;
create unique index if not exists message_outbox_notification_key on public.message_outbox(notification_key);

create or replace function private.enqueue_commercial_billing_notifications()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare inserted_count integer;
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='organisation_subscriptions' and column_name='grace_started_at') then return 0;end if;
  insert into public.message_outbox(organisation_id,message_type,recipient_address,invitation_id,template_version,payload,next_attempt_at,notification_key)
  select subscription.organisation_id,
    case when subscription.state='trial_active' then 'trial_ending' else 'payment_failure' end,
    lower(coalesce(organisation.contact_email,organisation.billing_email)),null,
    case when subscription.state='trial_active' then 'trial_ending_v1' else 'payment_failure_v1' end,
    jsonb_build_object('subscriptionId',subscription.id),now(),
    case when subscription.state='trial_active'
      then 'billing/'||subscription.id::text||'/trial-ending/'||subscription.trial_ends_at::date::text
      else 'billing/'||subscription.id::text||'/payment-failure/'||coalesce(subscription.grace_started_at::text,subscription.state) end
  from public.organisation_subscriptions subscription
  join public.organisations organisation on organisation.id=subscription.organisation_id
  where subscription.is_current
    and coalesce(organisation.contact_email,organisation.billing_email) is not null
    and ((subscription.state='trial_active' and subscription.trial_ends_at between now() and now()+interval '14 days')
      or subscription.state in('payment_action_required','past_due','billing_suspended'))
  on conflict(notification_key) do nothing;
  get diagnostics inserted_count=row_count;
  return inserted_count;
end
$$;

create or replace function public.claim_next_notification_delivery()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox public.message_outbox%rowtype;
  token text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  perform private.enqueue_commercial_billing_notifications();
  select message.* into outbox
  from public.message_outbox message
  left join public.organisation_invitations invitation
    on invitation.id=message.invitation_id
   and invitation.organisation_id=message.organisation_id
  where (message.invitation_id is null or (invitation.status='pending' and invitation.expires_at>now()))
   and ((message.delivery_status in('queued','retryable_failure') and coalesce(message.next_attempt_at,now())<=now())
     or (message.delivery_status='processing' and message.last_attempt_at<now()-interval '15 minutes')
   )
  order by message.next_attempt_at nulls first,message.created_at,message.id
  limit 1 for update of message skip locked;
  if not found then return jsonb_build_object('outcome','not_available');end if;
  select decrypted_secret into token from vault.decrypted_secrets where id=outbox.delivery_secret_id;
  if token is null and outbox.invitation_id is not null then
    update public.message_outbox set delivery_status='permanent_failure',failed_at=now(),last_error_code='delivery_material_missing',next_attempt_at=null where id=outbox.id;
    return jsonb_build_object('outcome','not_available');
  end if;
  update public.message_outbox set delivery_status='processing',last_attempt_at=now() where id=outbox.id;
  return jsonb_build_object(
    'outcome','claimed','outboxId',outbox.id,'messageType',outbox.message_type,
    'templateVersion',outbox.template_version,'recipientAddress',outbox.recipient_address,
    'invitationToken',token,'attemptCount',outbox.retry_count
  );
end
$$;

create or replace function public.record_notification_delivery(
  outbox_id uuid,
  delivery_outcome text,
  provider_reference text default null,
  failure_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  outbox public.message_outbox%rowtype;
  next_status text;
  secret_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
  if delivery_outcome not in('accepted','retryable_failure','permanent_failure')
    or provider_reference is not null and (length(provider_reference)>200 or provider_reference!~'^[A-Za-z0-9_.:-]+$')
    or failure_code is not null and (length(failure_code)>80 or failure_code!~'^[A-Za-z0-9_.:-]+$') then
    raise exception 'invalid delivery result' using errcode='22023';
  end if;
  select * into outbox from public.message_outbox where id=outbox_id and delivery_status='processing' for update;
  if not found then return jsonb_build_object('outcome','not_available');end if;
  secret_id:=outbox.delivery_secret_id;
  next_status:=case when delivery_outcome='accepted' then 'sent'
    when delivery_outcome='retryable_failure' and outbox.retry_count<4 then 'retryable_failure'
    else 'permanent_failure' end;
  update public.message_outbox set
    delivery_status=next_status,
    retry_count=retry_count+1,
    provider_message_reference=case when delivery_outcome='accepted' then provider_reference else provider_message_reference end,
    provider_accepted_at=case when delivery_outcome='accepted' then now() else provider_accepted_at end,
    sent_at=case when delivery_outcome='accepted' then now() else sent_at end,
    failed_at=case when next_status='permanent_failure' then now() else failed_at end,
    next_attempt_at=case when next_status='retryable_failure' then now()+make_interval(mins=>least(60,5*(retry_count+1))) else null end,
    last_error_code=case when delivery_outcome='accepted' then null else coalesce(failure_code,'delivery_failed') end,
    delivery_secret_id=case when next_status in('sent','permanent_failure') then null else delivery_secret_id end
  where id=outbox.id;
  if next_status in('sent','permanent_failure') and secret_id is not null then delete from vault.secrets where id=secret_id;end if;
  return jsonb_build_object('outcome','recorded','deliveryStatus',next_status);
end
$$;

revoke all on function public.claim_next_notification_delivery(),
  public.record_notification_delivery(uuid,text,text,text)
from public,anon,authenticated,service_role;
revoke all on function private.enqueue_commercial_billing_notifications() from public,anon,authenticated,service_role;
grant execute on function public.claim_next_notification_delivery(),
  public.record_notification_delivery(uuid,text,text,text)
to service_role;

insert into private.role_permissions(role,permission)
values('organisation_owner','organisation.export')
on conflict do nothing;

insert into public.plan_entitlements(plan_key,plan_version,capability_key,value_type,boolean_value,integer_value)
select plan_key,plan_version,'exports.customer','boolean',true,null from public.plans
on conflict do nothing;

insert into public.organisation_entitlements(
  organisation_id,subscription_id,capability_key,value_type,boolean_value,integer_value,
  source_plan_key,source_plan_version,effective_at,superseded_at
)
select subscription.organisation_id,subscription.id,'exports.customer','boolean',true,null,
  subscription.plan_key,subscription.plan_version,now(),null
from public.organisation_subscriptions subscription
where subscription.is_current
on conflict(organisation_id,subscription_id,capability_key) do nothing;

create table public.customer_export_audits(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  actor_membership_id uuid not null,
  schema_version text not null check(schema_version='commercial_customer_export_v1'),
  file_name text not null check(file_name~'^workforce-platform-export-[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$'),
  digest text not null check(digest~'^[0-9a-f]{64}$'),
  category_counts jsonb not null check(jsonb_typeof(category_counts)='object'),
  access_mode text not null default 'owner_download' check(access_mode='owner_download'),
  completed_at timestamptz not null default now(),
  unique(organisation_id,id),
  foreign key(organisation_id,actor_membership_id)
    references public.organisation_memberships(organisation_id,id) on delete restrict
);
alter table public.customer_export_audits enable row level security;
revoke all on public.customer_export_audits from public,anon,authenticated;
grant select on public.customer_export_audits to authenticated;
create policy customer_export_audits_owner_select on public.customer_export_audits
for select to authenticated using(
  private.has_permission(organisation_id,'organisation.export')
  and exists(select 1 from public.membership_role_assignments role
    where role.organisation_id=customer_export_audits.organisation_id
      and role.membership_id=private.current_membership_id(customer_export_audits.organisation_id)
      and role.role='organisation_owner' and role.revoked_at is null)
);

create or replace function private.prevent_customer_export_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'customer export audit receipts are immutable' using errcode='23514';end
$$;
create trigger customer_export_audits_immutable
before update or delete on public.customer_export_audits
for each row execute function private.prevent_customer_export_audit_mutation();

create or replace function private.customer_export_rows(
  target_table regclass,
  target_organisation_id uuid,
  allowed_columns text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare rows jsonb;
begin
  if target_table is null then return '[]'::jsonb;end if;
  execute format($query$
    select coalesce(jsonb_agg(projected order by projected->>'id',projected::text),'[]'::jsonb)
    from (
      select coalesce((select jsonb_object_agg(entry.key,entry.value order by entry.key)
        from jsonb_each(to_jsonb(source_row)) entry where entry.key=any($2)),'{}'::jsonb) projected
      from %s source_row
      where coalesce(to_jsonb(source_row)->>'organisation_id',to_jsonb(source_row)->>'id')=$1::text
    ) exported
  $query$,target_table) into rows using target_organisation_id,allowed_columns;
  return rows;
end
$$;

create or replace function public.prepare_customer_export(target_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare member_id uuid;categories jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'customer export requires AAL2' using errcode='42501';end if;
  select membership.id into member_id from public.organisation_memberships membership
  join public.membership_role_assignments role on role.organisation_id=membership.organisation_id and role.membership_id=membership.id and role.role='organisation_owner' and role.revoked_at is null
  where membership.organisation_id=target_organisation_id and membership.auth_user_id=auth.uid() and membership.status='active' limit 1;
  if member_id is null or not private.has_permission(target_organisation_id,'organisation.export')
    or not exists(select 1 from public.organisation_entitlements entitlement join public.organisation_subscriptions subscription on subscription.organisation_id=entitlement.organisation_id and subscription.id=entitlement.subscription_id and subscription.is_current
      where entitlement.organisation_id=target_organisation_id and entitlement.capability_key='exports.customer' and entitlement.boolean_value and entitlement.superseded_at is null) then
    raise exception 'customer export is not authorised' using errcode='42501';
  end if;

  categories:=jsonb_build_object(
    'organisation',private.customer_export_rows('public.organisations',target_organisation_id,array['id','legal_name','display_name','slug','status','country_code','timezone','billing_email','contact_phone','address_line_1','address_line_2','locality','region','postcode','operational_state','went_live_at','archived_at','created_at','updated_at']),
    'sites',private.customer_export_rows('public.organisation_sites',target_organisation_id,array['id','organisation_id','name','slug','timezone','active','address_line_1','address_line_2','locality','postcode','phone','email','archived_at','created_at','updated_at']),
    'siteClosures',private.customer_export_rows('public.site_closures',target_organisation_id,array['id','organisation_id','site_id','starts_on','ends_on','label','notes','archived_at','created_at','updated_at']),
    'staff',private.customer_export_rows('public.staff_profiles',target_organisation_id,array['id','organisation_id','full_name','display_name','employment_role','main_qualification_level','is_apprentice','is_cover_staff','appointment_date','active','email','archived_at','created_at','updated_at']),
    'staffSiteAssignments',private.customer_export_rows('public.staff_site_assignments',target_organisation_id,array['id','organisation_id','staff_id','site_id','effective_from','effective_to','is_primary','employment_role','created_at','updated_at']),
    'qualifications',private.customer_export_rows('public.staff_qualifications',target_organisation_id,array['id','organisation_id','staff_id','qualification_name','qualification_level','awarding_organisation','award_date','expected_completion_date','permanent','evidence_reference','notes','verified_at','archived_at','created_at','updated_at']),
    'credentials',private.customer_export_rows('public.staff_credentials',target_organisation_id,array['id','organisation_id','staff_id','requirement_id','credential_type','title','issued_on','expires_on','evidence_status','archived_at','created_at','updated_at']),
    'complianceRequirements',private.customer_export_rows('public.compliance_requirements',target_organisation_id,array['id','organisation_id','site_id','module_id','requirement_key','display_name','kind','renewal_months','required','archived_at','created_at','updated_at']),
    'complianceDocuments',private.customer_export_rows('public.staff_compliance_documents',target_organisation_id,array['id','organisation_id','staff_id','requirement_id','document_type','display_name','archived_at','created_at']),
    'workAreas',private.customer_export_rows('public.work_areas',target_organisation_id,array['id','organisation_id','site_id','name','code','active','operational_settings','archived_at','created_at','updated_at']),
    'clockEvents',private.customer_export_rows('public.clock_events',target_organisation_id,array['id','organisation_id','site_id','staff_id','event_type','event_timestamp','recorded_date','kiosk_device_id','event_source','manager_correction','created_at']),
    'attendanceCorrections',private.customer_export_rows('public.clock_event_corrections',target_organisation_id,array['id','organisation_id','site_id','batch_id','correction_role','staff_id','correction_kind','original_event_id','supersedes_correction_id','event_type','event_timestamp','recorded_date','reason','created_at']),
    'attendanceExceptions',private.customer_export_rows('public.attendance_exceptions',target_organisation_id,array['id','organisation_id','site_id','staff_id','operational_date','exception_type','status','primary_event_id','related_event_ids','detection_revision','suggested_resolution_at','source','review_started_at','resolution_correction_batch_id','resolution_reason','resolved_at','dismissal_reason','dismissed_at','created_at','updated_at']),
    'rotaWeeks',private.customer_export_rows('public.rota_weeks',target_organisation_id,array['id','organisation_id','site_id','week_start_date','status','title','notes','published_at','archived_at','created_at','updated_at']),
    'rotaShifts',private.customer_export_rows('public.rota_shifts',target_organisation_id,array['id','organisation_id','site_id','rota_week_id','staff_id','shift_date','start_time','end_time','break_minutes','room_or_area','work_area_id','role_on_shift','notes','status','created_at','updated_at']),
    'rotaTemplates',private.customer_export_rows('public.rota_templates',target_organisation_id,array['id','organisation_id','site_id','name','description','active','created_at','updated_at']),
    'rotaTemplateShifts',private.customer_export_rows('public.rota_template_shifts',target_organisation_id,array['id','organisation_id','site_id','rota_template_id','staff_id','day_of_week','start_time','end_time','break_minutes','work_area_id','role_on_shift','notes','created_at','updated_at']),
    'leaveRequests',private.customer_export_rows('public.leave_requests',target_organisation_id,array['id','organisation_id','site_id','staff_id','leave_type','start_date','end_date','start_part','end_part','reason','status','decision_reason','requested_at','decided_at','created_at','updated_at']),
    'payrollPeriods',private.customer_export_rows('public.payroll_periods',target_organisation_id,array['id','organisation_id','period_start','period_end','status','revision','created_at','updated_at','closed_at']),
    'payrollRuns',private.customer_export_rows('public.payroll_preparation_runs',target_organisation_id,array['id','organisation_id','period_id','revision','status','site_id','source_revision','warning_codes','warning_acknowledged_at','prepared_at','approved_at','created_at','updated_at']),
    'payrollRows',private.customer_export_rows('public.payroll_preparation_rows',target_organisation_id,array['id','organisation_id','run_id','staff_id','site_id','pay_arrangement_id','operational_date','source_key','pay_type','pay_regime_key','ordinary_minutes_limit','raw_minutes','adjustment_minutes','payable_minutes','ordinary_minutes','overtime_minutes','hourly_rate','annual_salary','monthly_salary','overtime_multiplier','estimated_gross_value','currency_code','warnings','created_at']),
    'payrollAdjustments',private.customer_export_rows('public.payroll_adjustments',target_organisation_id,array['id','organisation_id','period_id','run_id','revision','staff_id','site_id','source_key','adjustment_minutes','reason','status','supersedes_adjustment_id','created_at']),
    'payrollApprovals',private.customer_export_rows('public.payroll_approvals',target_organisation_id,array['id','organisation_id','period_id','run_id','revision','status','acknowledged_warning_codes','acknowledgement_note','reason','created_at']),
    'payrollExportAudits',private.customer_export_rows('public.payroll_export_audits',target_organisation_id,array['id','organisation_id','period_id','run_id','approval_id','revision','export_format','site_id','file_name','file_sha256','row_count','filter_metadata','created_at']),
    'payArrangements',private.customer_export_rows('public.staff_pay_arrangements',target_organisation_id,array['id','organisation_id','staff_id','pay_type','hourly_rate','annual_salary','monthly_salary','contracted_weekly_hours','standard_daily_hours','overtime_multiplier','effective_from','effective_to','is_active','manager_notes','created_at','updated_at']),
    'organisationSettings',private.customer_export_rows('public.organisation_settings',target_organisation_id,array['organisation_id','work_week_starts','default_timezone','branding','compliance_policy','pay_policy','operating_defaults','staffing_defaults','created_at','updated_at']),
    'siteSettings',private.customer_export_rows('public.site_settings',target_organisation_id,array['organisation_id','site_id','opening_time','closing_time','closure_dates','rota_policy','kiosk_policy','local_settings','timezone_override','work_week_starts_override','operating_overrides','staffing_overrides','created_at','updated_at']),
    'memberships',private.customer_export_rows('public.organisation_memberships',target_organisation_id,array['id','organisation_id','staff_id','status','joined_at','suspended_at','revoked_at','created_at','updated_at']),
    'roles',private.customer_export_rows('public.membership_role_assignments',target_organisation_id,array['id','organisation_id','membership_id','role','scope_type','site_id','granted_at','revoked_at']),
    'siteAccess',private.customer_export_rows('public.membership_site_access',target_organisation_id,array['id','organisation_id','membership_id','site_id','granted_at','revoked_at']),
    'invitations',private.customer_export_rows('public.organisation_invitations',target_organisation_id,array['id','organisation_id','invited_email','status','expires_at','invited_by_membership_id','accepted_by_membership_id','accepted_at','revoked_at','superseded_at','superseded_by_invitation_id','invitation_kind','template_version','resend_of_invitation_id','created_at','updated_at'])
  );
  return jsonb_build_object('exportVersion','commercial_customer_export_v1','organisationId',target_organisation_id,'presentationTimezone','Europe/London',
    'omissions',jsonb_build_array('Compliance document file bytes are not included in the supervised pilot export.'),'categories',categories);
end
$$;

create or replace function public.record_customer_export_audit(
  target_organisation_id uuid,
  schema_version text,
  file_name text,
  digest text,
  category_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare member_id uuid;audit_id uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'customer export requires AAL2' using errcode='42501';end if;
  select membership.id into member_id from public.organisation_memberships membership
  join public.membership_role_assignments role on role.organisation_id=membership.organisation_id and role.membership_id=membership.id and role.role='organisation_owner' and role.revoked_at is null
  where membership.organisation_id=target_organisation_id and membership.auth_user_id=auth.uid() and membership.status='active' limit 1;
  if member_id is null or not private.has_permission(target_organisation_id,'organisation.export') then raise exception 'customer export is not authorised' using errcode='42501';end if;
  insert into public.customer_export_audits(organisation_id,actor_membership_id,schema_version,file_name,digest,category_counts)
    values(target_organisation_id,member_id,schema_version,file_name,digest,category_counts) returning id into audit_id;
  return jsonb_build_object('outcome','recorded','auditId',audit_id);
end
$$;

revoke all on function private.prevent_customer_export_audit_mutation(),
  private.customer_export_rows(regclass,uuid,text[]),
  public.prepare_customer_export(uuid),
  public.record_customer_export_audit(uuid,text,text,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.prepare_customer_export(uuid),
  public.record_customer_export_audit(uuid,text,text,text,jsonb)
to authenticated;

do $patch_post_live_invitations$
declare
  definition text;
  command_function regprocedure;
  start_marker constant text := $marker$elsif command_name in('create_manager_invitation','create_staff_invitation','resend_invitation','revoke_invitation') then$marker$;
  end_marker constant text := $marker$elsif command_name in('start_kiosk_registration','replace_kiosk_device') then$marker$;
  start_position integer;
  end_position integer;
  replacement text := $branch$elsif command_name in('create_manager_invitation','create_staff_invitation','resend_invitation','revoke_invitation') then
        permission_name:='membership.manage';resource_type:='invitation';resource_uuid:=private.commercial_admin_uuid(payload->>'invitationId');event_name:=case when command_name='revoke_invitation' then 'invitation_revoked' else 'invitation_created' end;
        if not private.has_permission(org.id,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif command_name='revoke_invitation' then
          select array_agg(delivery_secret_id) into released_secret_ids from public.message_outbox where invitation_id=resource_uuid and delivery_secret_id is not null;
          update public.message_outbox set delivery_status='permanent_failure',failed_at=coalesce(failed_at,clock_timestamp()),last_error_code='invitation_revoked',delivery_secret_id=null,next_attempt_at=null where invitation_id=resource_uuid and delivery_status in('queued','processing','retryable_failure');
          delete from vault.secrets where id=any(coalesce(released_secret_ids,'{}'::uuid[]));
          update public.organisation_invitations set status='revoked',revoked_at=clock_timestamp(),revoked_by_membership_id=actor.id,updated_at=clock_timestamp() where organisation_id=org.id and id=resource_uuid and status='pending';resource_id:=resource_uuid::text;success:=found;
        elsif command_name='resend_invitation' then
          select * into invitation from public.organisation_invitations i where i.organisation_id=org.id and i.id=resource_uuid and i.status='pending' for update;
          if not found then result:=jsonb_build_object('outcome','not_found');
          elsif exists(select 1 from public.message_outbox o where o.invitation_id=invitation.id and o.created_at>clock_timestamp()-interval '5 minutes') then result:=jsonb_build_object('outcome','conflict','code','delivery_retry_throttled');
          else
            raw_token:=encode(extensions.gen_random_bytes(32),'hex');
            select array_agg(delivery_secret_id) into released_secret_ids from public.message_outbox where invitation_id=invitation.id and delivery_secret_id is not null;
            update public.message_outbox set delivery_status='permanent_failure',failed_at=coalesce(failed_at,clock_timestamp()),last_error_code='invitation_superseded',delivery_secret_id=null,next_attempt_at=null where invitation_id=invitation.id and delivery_status in('queued','processing','retryable_failure');
            delete from vault.secrets where id=any(coalesce(released_secret_ids,'{}'::uuid[]));
            update public.organisation_invitations set status='superseded',superseded_at=clock_timestamp(),updated_at=clock_timestamp() where id=invitation.id;
            insert into public.organisation_invitations(organisation_id,invited_email,token_hash,status,expires_at,invited_by_membership_id,invitation_kind,template_version,staff_id,resend_of_invitation_id)
              values(org.id,invitation.invited_email,sha256(convert_to(raw_token,'UTF8')),'pending',clock_timestamp()+interval '7 days',actor.id,invitation.invitation_kind,invitation.template_version,invitation.staff_id,invitation.id) returning * into replacement_invitation;
            insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type,site_id) select organisation_id,replacement_invitation.id,role,scope_type,site_id from public.organisation_invitation_roles where organisation_id=org.id and invitation_id=invitation.id;
            insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) select organisation_id,replacement_invitation.id,site_id from public.organisation_invitation_site_access where organisation_id=org.id and invitation_id=invitation.id;
            update public.organisation_invitations set superseded_by_invitation_id=replacement_invitation.id where id=invitation.id;
            delivery_secret_id_value:=vault.create_secret(raw_token,'commercial-invitation-'||replacement_invitation.id::text,'Encrypted delivery material for one commercial invitation');
            insert into public.message_outbox(organisation_id,message_type,recipient_address,invitation_id,template_version,delivery_secret_id,payload,next_attempt_at,notification_key)
              values(org.id,replacement_invitation.invitation_kind||'_invitation',replacement_invitation.invited_email,replacement_invitation.id,replacement_invitation.template_version,delivery_secret_id_value,jsonb_build_object('invitationId',replacement_invitation.id),clock_timestamp(),'invitation/'||replacement_invitation.id::text);
            resource_id:=replacement_invitation.id::text;event_name:='invitation_resent';success:=true;
          end if;
        else
          if command_name='create_manager_invitation' and not private.commercial_privileged_capacity_available(org.id,null) then result:=jsonb_build_object('outcome','upgrade_required','capabilityKey','members.privileged.limit','code','privileged_capacity_reached');end if;
          if result is null and coalesce(payload->>'email','')!~*'^[^@\s]+@[^@\s]+\.[^@\s]+$' then result:=jsonb_build_object('outcome','invalid_request');end if;
          if result is null then
            staff_value:=nullif(payload->>'staffId','');target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');raw_status:=case when command_name='create_staff_invitation' then 'staff' else coalesce(payload->>'role','site_manager') end;
            if command_name='create_staff_invitation' and not exists(select 1 from public.staff_profiles p where p.organisation_id=org.id and p.id=staff_value and p.active) then result:=jsonb_build_object('outcome','not_found');
            elsif command_name='create_manager_invitation' and not private.can_grant_manager_role(org.id,actor.id,raw_status) then result:=jsonb_build_object('outcome','permission_denied');
            else
              raw_token:=encode(extensions.gen_random_bytes(32),'hex');
              insert into public.organisation_invitations(organisation_id,invited_email,token_hash,status,expires_at,invited_by_membership_id,invitation_kind,template_version,staff_id)
                values(org.id,lower(btrim(payload->>'email')),sha256(convert_to(raw_token,'UTF8')),'pending',clock_timestamp()+interval '7 days',actor.id,case when command_name='create_staff_invitation' then 'staff' else 'manager' end,case when command_name='create_staff_invitation' then 'staff_invitation_v1' else 'manager_invitation_v1' end,staff_value) returning * into invitation;
              resource_uuid:=invitation.id;
              if command_name='create_staff_invitation' then insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type) values(org.id,resource_uuid,'staff','organisation');insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) select org.id,resource_uuid,a.site_id from public.staff_site_assignments a where a.organisation_id=org.id and a.staff_id=staff_value and (a.effective_to is null or a.effective_to>=(clock_timestamp() at time zone org.timezone)::date);
              else insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type,site_id) values(org.id,resource_uuid,raw_status::public.organisation_role,(case when target_site_uuid is null then 'organisation' else 'site' end)::public.membership_scope_type,target_site_uuid);if target_site_uuid is not null then insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) values(org.id,resource_uuid,target_site_uuid);end if;end if;
              delivery_secret_id_value:=vault.create_secret(raw_token,'commercial-invitation-'||invitation.id::text,'Encrypted delivery material for one commercial invitation');
              insert into public.message_outbox(organisation_id,message_type,recipient_address,invitation_id,template_version,delivery_secret_id,payload,next_attempt_at,notification_key)
                values(org.id,invitation.invitation_kind||'_invitation',invitation.invited_email,invitation.id,invitation.template_version,delivery_secret_id_value,jsonb_build_object('invitationId',invitation.id),clock_timestamp(),'invitation/'||invitation.id::text);
              resource_id:=resource_uuid::text;success:=true;
            end if;
          end if;
        end if;
      $branch$;
begin
  command_function:=coalesce(
    to_regprocedure('commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)'),
    to_regprocedure('public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)')
  );
  if command_function is null then return;end if;
  select pg_get_functiondef(command_function) into definition;
  if position('scope_value public.organisation_role' in definition)>0 then
    raise exception 'post-live invitation delivery patch found an unexpected scope type';
  end if;
  definition:=replace(definition,
    'scope_value public.membership_scope_type;',
    'scope_value public.membership_scope_type;raw_token text;delivery_secret_id_value uuid;released_secret_ids uuid[];');
  start_position:=position(start_marker in definition);end_position:=position(end_marker in definition);
  if start_position=0 or end_position<=start_position or position('raw_token text' in definition)=0 then raise exception 'post-live invitation delivery patch source changed (start %, end %, declaration %)',start_position,end_position,position('raw_token text' in definition);end if;
  definition:=substring(definition from 1 for start_position-1)||replacement||substring(definition from end_position);
  execute definition;

  select pg_get_functiondef('private.commercial_admin_snapshot(uuid,uuid)'::regprocedure) into definition;
  if position($old$'staffId',i.staff_id)$old$ in definition)=0 then raise exception 'commercial admin invitation snapshot source changed';end if;
  definition:=replace(definition,$old$'staffId',i.staff_id)$old$,
    $new$'staffId',i.staff_id,'deliveryStatus',coalesce((select case o.delivery_status when 'sent' then 'accepted_by_provider' when 'retryable_failure' then 'retrying' when 'permanent_failure' then 'permanently_failed' else o.delivery_status end from public.message_outbox o where o.invitation_id=i.id order by o.created_at desc limit 1),'not_queued'))$new$);
  execute definition;
end
$patch_post_live_invitations$;
