-- Commercial Workstream 7: durable onboarding workflow persistence only.
-- This migration does not execute onboarding, evaluate readiness, enable billing,
-- provision kiosks, or authorise offline attendance.

insert into private.role_permissions (role, permission) values
  ('organisation_owner', 'onboarding.read'),
  ('organisation_owner', 'onboarding.manage'),
  ('organisation_admin', 'onboarding.read'),
  ('organisation_admin', 'onboarding.manage')
on conflict do nothing;

create or replace function private.onboarding_json_has_sensitive_key(target jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item record;
begin
  if target is null then
    return false;
  end if;

  if jsonb_typeof(target) = 'object' then
    for item in select key, value from jsonb_each(target)
    loop
      if item.key ~* '(password|mfa.?secret|(^|raw).*token|activation.?secret|^pin$|staff.?pin|payment.?details|card.?number|card.?cvc|raw.?(csv|import).*row)'
         or private.onboarding_json_has_sensitive_key(item.value) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(target) = 'array' then
    for item in select value from jsonb_array_elements(target)
    loop
      if private.onboarding_json_has_sensitive_key(item.value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function private.onboarding_validation_summary_is_valid(target jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(target) = 'array'
    and jsonb_array_length(target) <= 100
    and not exists (
      select 1
      from jsonb_array_elements(target) issue
      where jsonb_typeof(issue) is distinct from 'object'
        or exists (
          select 1 from jsonb_object_keys(issue) key
          where key not in ('code', 'message', 'fieldPath')
        )
        or jsonb_typeof(issue -> 'code') is distinct from 'string'
        or not ((issue ->> 'code') ~ '^[a-z][a-z0-9_]{0,63}$')
        or jsonb_typeof(issue -> 'message') is distinct from 'string'
        or length(btrim(issue ->> 'message')) not between 1 and 240
        or jsonb_typeof(issue -> 'fieldPath') is distinct from 'array'
        or jsonb_array_length(issue -> 'fieldPath') > 12
        or exists (
          select 1 from jsonb_array_elements(issue -> 'fieldPath') field
          where jsonb_typeof(field) <> 'string'
             or length(btrim(field #>> '{}')) not between 1 and 80
        )
    )
$$;

create or replace function private.onboarding_safe_event_metadata_is_valid(target jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  metadata_key text;
  array_key text;
begin
  if target is null or jsonb_typeof(target) <> 'object' then
    return false;
  end if;

  for metadata_key in select jsonb_object_keys(target)
  loop
    if metadata_key not in (
      'statusCode', 'planKey', 'featureKey', 'capabilityKey', 'durationBucket',
      'failureCategory', 'deliveryStatus', 'activationStatus', 'warningCodes',
      'resultCodes', 'resourceCounts', 'attemptCount', 'retryCount',
      'resourceId', 'resourceIds', 'wasReplayed', 'isRetryable'
    ) then
      return false;
    end if;
  end loop;

  foreach metadata_key in array array[
    'statusCode', 'planKey', 'featureKey', 'capabilityKey', 'durationBucket',
    'failureCategory', 'deliveryStatus', 'activationStatus'
  ] loop
    if target ? metadata_key and (
      jsonb_typeof(target -> metadata_key) <> 'string'
      or not ((target ->> metadata_key) ~ '^[a-z][a-z0-9_]{0,95}$')
    ) then
      return false;
    end if;
  end loop;

  foreach array_key in array array['warningCodes', 'resultCodes'] loop
    if target ? array_key then
      if jsonb_typeof(target -> array_key) <> 'array'
         or jsonb_array_length(target -> array_key) > 100
         or exists (
           select 1 from jsonb_array_elements(target -> array_key) element
           where jsonb_typeof(element) <> 'string'
              or not ((element #>> '{}') ~ '^[a-z][a-z0-9_]{0,95}$')
         ) then
        return false;
      end if;
    end if;
  end loop;

  if target ? 'resourceCounts' then
    if jsonb_typeof(target -> 'resourceCounts') <> 'object'
       or exists (
         select 1 from jsonb_each(target -> 'resourceCounts') entry
         where not (entry.key ~ '^[a-z][a-z0-9_]{0,95}$')
            or jsonb_typeof(entry.value) <> 'number'
            or not ((entry.value #>> '{}') ~ '^(0|[1-9][0-9]*)$')
       ) then
      return false;
    end if;
  end if;

  foreach metadata_key in array array['attemptCount', 'retryCount'] loop
    if target ? metadata_key and (
      jsonb_typeof(target -> metadata_key) <> 'number'
      or not ((target ->> metadata_key) ~ '^(0|[1-9][0-9]*)$')
    ) then
      return false;
    end if;
  end loop;

  if target ? 'resourceId' and (
    jsonb_typeof(target -> 'resourceId') <> 'string'
    or not ((target ->> 'resourceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ) then
    return false;
  end if;

  if target ? 'resourceIds' then
    if jsonb_typeof(target -> 'resourceIds') <> 'array'
       or jsonb_array_length(target -> 'resourceIds') > 1000
       or exists (
         select 1 from jsonb_array_elements(target -> 'resourceIds') element
         where jsonb_typeof(element) <> 'string'
            or not ((element #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
       ) then
      return false;
    end if;
  end if;

  foreach metadata_key in array array['wasReplayed', 'isRetryable'] loop
    if target ? metadata_key and jsonb_typeof(target -> metadata_key) <> 'boolean' then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function private.onboarding_safe_result_reference_is_valid(target jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  reference_key text;
  uuid_key text;
  uuid_array_key text;
begin
  if target is null or jsonb_typeof(target) <> 'object' then
    return false;
  end if;

  for reference_key in select jsonb_object_keys(target)
  loop
    if reference_key not in (
      'organisationId', 'siteId', 'staffId', 'staffIds', 'importBatchId',
      'invitationIds', 'kioskRegistrationId', 'kioskDeviceId',
      'readinessSnapshotId', 'legalAcceptanceId', 'subscriptionId'
    ) then
      return false;
    end if;
  end loop;

  foreach uuid_key in array array[
    'organisationId', 'siteId', 'importBatchId', 'kioskRegistrationId',
    'kioskDeviceId', 'readinessSnapshotId', 'legalAcceptanceId', 'subscriptionId'
  ] loop
    if target ? uuid_key and (
      jsonb_typeof(target -> uuid_key) <> 'string'
      or not ((target ->> uuid_key) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    ) then
      return false;
    end if;
  end loop;

  if target ? 'staffId' and (
    jsonb_typeof(target -> 'staffId') <> 'string'
    or not ((target ->> 'staffId') ~ '^[a-z][a-z0-9_]{0,95}$')
  ) then
    return false;
  end if;

  if target ? 'staffIds' then
    if jsonb_typeof(target -> 'staffIds') <> 'array'
       or jsonb_array_length(target -> 'staffIds') > 1000
       or exists (
         select 1 from jsonb_array_elements(target -> 'staffIds') element
         where jsonb_typeof(element) <> 'string'
            or not ((element #>> '{}') ~ '^[a-z][a-z0-9_]{0,95}$')
       ) then
      return false;
    end if;
  end if;

  foreach uuid_array_key in array array['invitationIds'] loop
    if target ? uuid_array_key then
      if jsonb_typeof(target -> uuid_array_key) <> 'array'
         or jsonb_array_length(target -> uuid_array_key) > 1000
         or exists (
           select 1 from jsonb_array_elements(target -> uuid_array_key) element
           where jsonb_typeof(element) <> 'string'
              or not ((element #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
         ) then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

create table public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  owner_auth_user_id uuid not null references auth.users(id) on delete restrict,
  organisation_id uuid references public.organisations(id) on delete restrict,
  workflow_key text not null check (workflow_key = 'commercial_customer_v1'),
  workflow_version integer not null check (workflow_version = 1),
  status text not null check (status in ('not_started', 'in_progress', 'needs_attention', 'ready', 'live', 'abandoned')),
  current_step_key text not null check (current_step_key in (
    'owner_account', 'organisation', 'first_site', 'subscription', 'settings',
    'staff', 'manager_invitations', 'staff_invitations', 'kiosk',
    'initial_rota', 'readiness', 'go_live'
  )),
  revision bigint not null default 0 check (revision >= 0),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ready_at timestamptz,
  go_live_at timestamptz,
  completed_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  foreign key (organisation_id, completed_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (organisation_id is not null or completed_by_membership_id is null),
  check ((status = 'ready' and ready_at is not null) or status <> 'ready'),
  check ((status = 'live') = (go_live_at is not null)),
  check (ready_at is null or ready_at >= started_at),
  check (go_live_at is null or go_live_at >= started_at),
  check (last_activity_at >= started_at)
);

create unique index onboarding_sessions_active_bootstrap_owner_key
  on public.onboarding_sessions (owner_auth_user_id)
  where organisation_id is null and status <> 'abandoned';
create unique index onboarding_sessions_active_owner_organisation_key
  on public.onboarding_sessions (owner_auth_user_id, organisation_id)
  where organisation_id is not null and status <> 'abandoned';
create index onboarding_sessions_organisation_status_idx
  on public.onboarding_sessions (organisation_id, status, last_activity_at desc)
  where organisation_id is not null;

create table public.onboarding_step_states (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  session_id uuid not null references public.onboarding_sessions(id) on delete restrict,
  organisation_id uuid references public.organisations(id) on delete restrict,
  workflow_key text not null default 'commercial_customer_v1' check (workflow_key = 'commercial_customer_v1'),
  workflow_version integer not null default 1 check (workflow_version = 1),
  step_key text not null check (step_key in (
    'owner_account', 'organisation', 'first_site', 'subscription', 'settings',
    'staff', 'manager_invitations', 'staff_invitations', 'kiosk',
    'initial_rota', 'readiness', 'go_live'
  )),
  step_version integer not null check (step_version = 1),
  status text not null check (status in ('not_started', 'in_progress', 'blocked', 'complete', 'skipped', 'needs_review')),
  revision bigint not null default 0 check (revision >= 0),
  draft_payload jsonb not null default '{}'::jsonb,
  validation_summary jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  last_saved_at timestamptz,
  completed_by_auth_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, step_key),
  foreign key (session_id, organisation_id)
    references public.onboarding_sessions(id, organisation_id) on delete restrict,
  check (jsonb_typeof(draft_payload) = 'object'),
  check (not private.onboarding_json_has_sensitive_key(draft_payload)),
  check (private.onboarding_validation_summary_is_valid(validation_summary)),
  check ((status in ('complete', 'skipped')) = (completed_at is not null)),
  check (started_at is null or completed_at is null or completed_at >= started_at),
  check (started_at is null or last_saved_at is null or last_saved_at >= started_at)
);

create index onboarding_step_states_session_status_idx
  on public.onboarding_step_states (session_id, status, step_key);
create index onboarding_step_states_organisation_idx
  on public.onboarding_step_states (organisation_id, session_id)
  where organisation_id is not null;

create table public.onboarding_events (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  event_version integer not null default 1 check (event_version = 1),
  session_id uuid not null references public.onboarding_sessions(id) on delete restrict,
  organisation_id uuid references public.organisations(id) on delete restrict,
  workflow_key text not null default 'commercial_customer_v1' check (workflow_key = 'commercial_customer_v1'),
  workflow_version integer not null default 1 check (workflow_version = 1),
  event_type text not null check (event_type in (
    'signup_started', 'owner_email_verified', 'owner_mfa_enrolled',
    'legal_acceptance_completed', 'organisation_created', 'first_site_created',
    'plan_selected', 'trial_activated', 'settings_completed', 'staff_import_started',
    'staff_import_validated', 'staff_import_committed', 'manager_invitations_created',
    'staff_invitations_created', 'kiosk_registration_started', 'kiosk_connected',
    'readiness_evaluated', 'go_live_blocked', 'go_live_completed',
    'restricted_mode_entered', 'subscription_recovered'
  )),
  step_key text check (step_key is null or step_key in (
    'owner_account', 'organisation', 'first_site', 'subscription', 'settings',
    'staff', 'manager_invitations', 'staff_invitations', 'kiosk',
    'initial_rota', 'readiness', 'go_live'
  )),
  actor_type text not null check (actor_type in ('owner', 'member', 'system', 'billing_provider', 'support')),
  actor_auth_user_id uuid references auth.users(id) on delete restrict,
  actor_membership_id uuid,
  request_id uuid,
  workflow_revision bigint not null check (workflow_revision >= 0),
  safe_metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (session_id, organisation_id)
    references public.onboarding_sessions(id, organisation_id) on delete restrict,
  foreign key (organisation_id, actor_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (private.onboarding_safe_event_metadata_is_valid(safe_metadata)),
  check (actor_type not in ('owner', 'member') or actor_auth_user_id is not null),
  check (actor_type <> 'member' or actor_membership_id is not null),
  check (actor_membership_id is null or organisation_id is not null)
);

create unique index onboarding_events_request_type_key
  on public.onboarding_events (session_id, request_id, event_type)
  where request_id is not null;
create index onboarding_events_session_occurred_idx
  on public.onboarding_events (session_id, occurred_at, id);
create index onboarding_events_organisation_occurred_idx
  on public.onboarding_events (organisation_id, occurred_at desc)
  where organisation_id is not null;

create table public.onboarding_command_receipts (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  session_id uuid not null references public.onboarding_sessions(id) on delete restrict,
  organisation_id uuid references public.organisations(id) on delete restrict,
  workflow_key text not null default 'commercial_customer_v1' check (workflow_key = 'commercial_customer_v1'),
  workflow_version integer not null default 1 check (workflow_version = 1),
  command_type text not null check (command_type in (
    'save_step_draft', 'complete_owner_setup', 'create_organisation',
    'create_first_site', 'select_plan', 'save_settings', 'create_staff',
    'preview_staff_import', 'commit_staff_import', 'create_manager_invitations',
    'create_staff_invitations', 'start_kiosk_registration',
    'confirm_kiosk_connection', 'evaluate_readiness', 'go_live'
  )),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('processing', 'succeeded', 'failed_retryable', 'failed_final')),
  result_code text check (result_code is null or result_code ~ '^[a-z][a-z0-9_]{0,95}$'),
  result_reference jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, command_type, idempotency_key),
  foreign key (session_id, organisation_id)
    references public.onboarding_sessions(id, organisation_id) on delete restrict,
  check (private.onboarding_safe_result_reference_is_valid(result_reference)),
  check (
    (status = 'processing' and completed_at is null and result_code is null and result_reference = '{}'::jsonb)
    or (status <> 'processing' and completed_at is not null and result_code is not null)
  ),
  check (completed_at is null or completed_at >= started_at)
);

create index onboarding_command_receipts_session_status_idx
  on public.onboarding_command_receipts (session_id, status, started_at);
create index onboarding_command_receipts_unresolved_idx
  on public.onboarding_command_receipts (session_id, started_at)
  where status in ('processing', 'failed_retryable');
create index onboarding_command_receipts_organisation_idx
  on public.onboarding_command_receipts (organisation_id, session_id)
  where organisation_id is not null;

create or replace function private.enforce_onboarding_child_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_organisation_id uuid;
begin
  select session.organisation_id into session_organisation_id
  from public.onboarding_sessions session
  where session.id = new.session_id;

  if not found then
    raise exception 'onboarding session does not exist' using errcode = '23503';
  end if;
  if session_organisation_id is distinct from new.organisation_id then
    raise exception 'onboarding organisation does not match session' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.protect_onboarding_session_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.owner_auth_user_id is distinct from old.owner_auth_user_id
     or new.schema_version is distinct from old.schema_version
     or new.workflow_key is distinct from old.workflow_key
     or new.workflow_version is distinct from old.workflow_version
     or (old.organisation_id is not null and new.organisation_id is distinct from old.organisation_id) then
    raise exception 'onboarding session identity and ownership are immutable' using errcode = '23514';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'onboarding session revision must increment exactly once' using errcode = '23514';
  end if;
  if old.go_live_at is not null and new.go_live_at is distinct from old.go_live_at then
    raise exception 'onboarding Go Live evidence is immutable' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.protect_onboarding_step_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.session_id is distinct from old.session_id
     or (old.organisation_id is not null and new.organisation_id is distinct from old.organisation_id)
     or new.schema_version is distinct from old.schema_version
     or new.workflow_key is distinct from old.workflow_key
     or new.workflow_version is distinct from old.workflow_version
     or new.step_key is distinct from old.step_key
     or new.step_version is distinct from old.step_version then
    raise exception 'onboarding step identity and ownership are immutable' using errcode = '23514';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'onboarding step revision must increment exactly once' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.link_onboarding_children_to_organisation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.organisation_id is null and new.organisation_id is not null then
    update public.onboarding_step_states
    set organisation_id = new.organisation_id,
        revision = revision + 1
    where session_id = new.id and organisation_id is null;

    update public.onboarding_command_receipts
    set organisation_id = new.organisation_id
    where session_id = new.id and organisation_id is null;
  end if;
  return new;
end;
$$;

create or replace function private.prevent_onboarding_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'onboarding events are append-only and immutable' using errcode = '23514';
end;
$$;

create or replace function private.protect_onboarding_command_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.organisation_id is null
     and new.organisation_id is not null
     and new.id is not distinct from old.id
     and new.session_id is not distinct from old.session_id
     and new.schema_version is not distinct from old.schema_version
     and new.workflow_key is not distinct from old.workflow_key
     and new.workflow_version is not distinct from old.workflow_version
     and new.command_type is not distinct from old.command_type
     and new.idempotency_key is not distinct from old.idempotency_key
     and new.request_hash is not distinct from old.request_hash
     and new.status is not distinct from old.status
     and new.result_code is not distinct from old.result_code
     and new.result_reference is not distinct from old.result_reference
     and new.started_at is not distinct from old.started_at
     and new.completed_at is not distinct from old.completed_at
     and new.created_at is not distinct from old.created_at
     and new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.session_id is distinct from old.session_id
     or (old.organisation_id is not null and new.organisation_id is distinct from old.organisation_id)
     or new.schema_version is distinct from old.schema_version
     or new.workflow_key is distinct from old.workflow_key
     or new.workflow_version is distinct from old.workflow_version
     or new.command_type is distinct from old.command_type
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_hash is distinct from old.request_hash
     or new.started_at is distinct from old.started_at then
    raise exception 'onboarding command receipt identity is immutable' using errcode = '23514';
  end if;
  if old.status in ('succeeded', 'failed_final') then
    raise exception 'terminal onboarding command replay result is immutable' using errcode = '23514';
  end if;
  if old.status = 'failed_retryable' and new.status <> 'processing' then
    raise exception 'retryable onboarding command must return to processing' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger onboarding_sessions_protect_revision
before update on public.onboarding_sessions
for each row execute function private.protect_onboarding_session_revision();
create trigger onboarding_sessions_link_children
after update of organisation_id on public.onboarding_sessions
for each row execute function private.link_onboarding_children_to_organisation();

create trigger onboarding_step_states_enforce_tenant
before insert or update on public.onboarding_step_states
for each row execute function private.enforce_onboarding_child_tenant();
create trigger onboarding_step_states_protect_revision
before update on public.onboarding_step_states
for each row execute function private.protect_onboarding_step_revision();

create trigger onboarding_events_enforce_tenant
before insert on public.onboarding_events
for each row execute function private.enforce_onboarding_child_tenant();
create trigger onboarding_events_prevent_update
before update on public.onboarding_events
for each row execute function private.prevent_onboarding_event_mutation();
create trigger onboarding_events_prevent_delete
before delete on public.onboarding_events
for each row execute function private.prevent_onboarding_event_mutation();

create trigger onboarding_command_receipts_enforce_tenant
before insert or update on public.onboarding_command_receipts
for each row execute function private.enforce_onboarding_child_tenant();
create trigger onboarding_command_receipts_protect_replay
before update on public.onboarding_command_receipts
for each row execute function private.protect_onboarding_command_receipt();

create or replace function private.can_read_onboarding_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.onboarding_sessions session
    where session.id = target_session_id
      and auth.uid() is not null
      and (
        (session.organisation_id is null and session.owner_auth_user_id = auth.uid())
        or (
          session.organisation_id is not null
          and private.has_permission(session.organisation_id, 'onboarding.read')
        )
      )
  )
$$;

alter table public.onboarding_sessions enable row level security;
alter table public.onboarding_step_states enable row level security;
alter table public.onboarding_events enable row level security;
alter table public.onboarding_command_receipts enable row level security;

create policy onboarding_sessions_read on public.onboarding_sessions
for select to authenticated
using (
  auth.uid() is not null
  and (
    (organisation_id is null and owner_auth_user_id = auth.uid())
    or (organisation_id is not null and private.has_permission(organisation_id, 'onboarding.read'))
  )
);
create policy onboarding_step_states_read on public.onboarding_step_states
for select to authenticated
using (private.can_read_onboarding_session(session_id));
create policy onboarding_events_read on public.onboarding_events
for select to authenticated
using (private.can_read_onboarding_session(session_id));
create policy onboarding_command_receipts_read on public.onboarding_command_receipts
for select to authenticated
using (private.can_read_onboarding_session(session_id));

revoke all on public.onboarding_sessions from public, anon, authenticated, service_role;
revoke all on public.onboarding_step_states from public, anon, authenticated, service_role;
revoke all on public.onboarding_events from public, anon, authenticated, service_role;
revoke all on public.onboarding_command_receipts from public, anon, authenticated, service_role;

grant select on public.onboarding_sessions to authenticated;
grant select on public.onboarding_step_states to authenticated;
grant select on public.onboarding_events to authenticated;
grant select on public.onboarding_command_receipts to authenticated;

grant select, insert, update on public.onboarding_sessions to service_role;
grant select, insert, update on public.onboarding_step_states to service_role;
grant select, insert on public.onboarding_events to service_role;
grant select, insert, update on public.onboarding_command_receipts to service_role;

revoke all on function private.onboarding_json_has_sensitive_key(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.onboarding_validation_summary_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.onboarding_safe_event_metadata_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.onboarding_safe_result_reference_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.enforce_onboarding_child_tenant() from public, anon, authenticated, service_role;
revoke all on function private.protect_onboarding_session_revision() from public, anon, authenticated, service_role;
revoke all on function private.protect_onboarding_step_revision() from public, anon, authenticated, service_role;
revoke all on function private.link_onboarding_children_to_organisation() from public, anon, authenticated, service_role;
revoke all on function private.prevent_onboarding_event_mutation() from public, anon, authenticated, service_role;
revoke all on function private.protect_onboarding_command_receipt() from public, anon, authenticated, service_role;
revoke all on function private.can_read_onboarding_session(uuid) from public, anon, authenticated, service_role;
grant execute on function private.can_read_onboarding_session(uuid) to authenticated;
