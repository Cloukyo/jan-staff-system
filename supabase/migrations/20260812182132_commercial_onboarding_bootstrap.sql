-- Commercial Workstream 7A: owner security, legal acceptance and organisation bootstrap.
-- Additive commercial-preview migration. No site, billing, kiosk or offline authority is created.

alter table public.organisations
  add column contact_email text check (contact_email is null or contact_email = lower(contact_email)),
  add column contact_phone text,
  add column address_line_1 text,
  add column address_line_2 text,
  add column locality text,
  add column region text,
  add column postcode text,
  add column logo_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(logo_metadata) = 'object');

alter table public.onboarding_step_states drop constraint onboarding_step_states_step_key_check;
alter table public.onboarding_step_states add constraint onboarding_step_states_step_key_check check (step_key in (
  'owner_security', 'legal_acceptance', 'owner_account', 'organisation', 'first_site',
  'subscription', 'settings', 'staff', 'manager_invitations', 'staff_invitations',
  'kiosk', 'initial_rota', 'readiness', 'go_live'
));

alter table public.onboarding_events drop constraint onboarding_events_event_type_check;
alter table public.onboarding_events add constraint onboarding_events_event_type_check check (event_type in (
  'onboarding_started', 'signup_started', 'owner_email_verified', 'owner_mfa_enrolled',
  'owner_mfa_ready', 'legal_acceptance_completed', 'organisation_creation_started',
  'organisation_created', 'first_site_created', 'plan_selected', 'trial_activated',
  'settings_completed', 'staff_import_started', 'staff_import_validated',
  'staff_import_committed', 'manager_invitations_created', 'staff_invitations_created',
  'kiosk_registration_started', 'kiosk_connected', 'readiness_evaluated',
  'go_live_blocked', 'go_live_completed', 'restricted_mode_entered', 'subscription_recovered'
));
alter table public.onboarding_events drop constraint onboarding_events_step_key_check;
alter table public.onboarding_events add constraint onboarding_events_step_key_check check (
  step_key is null or step_key in (
    'owner_security', 'legal_acceptance', 'owner_account', 'organisation', 'first_site',
    'subscription', 'settings', 'staff', 'manager_invitations', 'staff_invitations',
    'kiosk', 'initial_rota', 'readiness', 'go_live'
  )
);

alter table public.onboarding_command_receipts drop constraint onboarding_command_receipts_command_type_check;
alter table public.onboarding_command_receipts add constraint onboarding_command_receipts_command_type_check check (command_type in (
  'save_step_draft', 'accept_legal_documents', 'complete_owner_setup', 'create_organisation',
  'create_first_site', 'select_plan', 'save_settings', 'create_staff',
  'preview_staff_import', 'commit_staff_import', 'create_manager_invitations',
  'create_staff_invitations', 'start_kiosk_registration', 'confirm_kiosk_connection',
  'evaluate_readiness', 'go_live'
));

create table public.legal_document_versions (
  document_type text not null check (document_type in (
    'terms_of_service', 'privacy_acknowledgement', 'data_processing_agreement'
  )),
  document_version text not null check (document_version ~ '^[0-9]{4}-[0-9]{2}(?:\.[0-9]+)?$'),
  locale text not null check (locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  title text not null check (length(btrim(title)) between 2 and 120),
  summary text not null check (length(btrim(summary)) between 2 and 500),
  effective_at timestamptz not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (document_type, document_version, locale)
);
create unique index legal_document_versions_current_type_locale_key
  on public.legal_document_versions (document_type, locale) where is_current;

insert into public.legal_document_versions (
  document_type, document_version, locale, title, summary, effective_at, is_current
) values
  ('terms_of_service', '2026-08', 'en-GB', 'Terms of Service',
   'The commercial terms governing use of the platform.', '2026-08-01 00:00:00+00', true),
  ('privacy_acknowledgement', '2026-08', 'en-GB', 'Privacy acknowledgement',
   'How account and operational data is handled within the service.', '2026-08-01 00:00:00+00', true),
  ('data_processing_agreement', '2026-08', 'en-GB', 'Data Processing Agreement',
   'The processor terms applying when the platform handles customer data.', '2026-08-01 00:00:00+00', true);

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  onboarding_session_id uuid not null references public.onboarding_sessions(id) on delete restrict,
  organisation_id uuid references public.organisations(id) on delete restrict,
  document_type text not null,
  document_version text not null,
  locale text not null,
  accepted_at timestamptz not null default now(),
  request_id uuid not null,
  request_metadata jsonb not null default '{"source":"commercial_onboarding"}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (document_type, document_version, locale)
    references public.legal_document_versions(document_type, document_version, locale) on delete restrict,
  unique (auth_user_id, onboarding_session_id, document_type, document_version, locale),
  check (jsonb_typeof(request_metadata) = 'object'),
  check (request_metadata <@ '{"source":"commercial_onboarding"}'::jsonb),
  check (request_metadata ->> 'source' = 'commercial_onboarding')
);

create index legal_acceptances_owner_session_idx
  on public.legal_acceptances (auth_user_id, onboarding_session_id, accepted_at desc);
create index legal_acceptances_organisation_idx
  on public.legal_acceptances (organisation_id, accepted_at desc) where organisation_id is not null;

create or replace function private.protect_legal_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'legal acceptances are immutable' using errcode = '23514';
  end if;
  if new.organisation_id is distinct from old.organisation_id
     and old.organisation_id is null
     and new.organisation_id is not null
     and exists (
       select 1 from public.onboarding_sessions session
       where session.id = old.onboarding_session_id
         and session.owner_auth_user_id = old.auth_user_id
         and session.organisation_id = new.organisation_id
     )
     and new.id = old.id
     and new.auth_user_id = old.auth_user_id
     and new.onboarding_session_id = old.onboarding_session_id
     and new.document_type = old.document_type
     and new.document_version = old.document_version
     and new.locale = old.locale
     and new.accepted_at = old.accepted_at
     and new.request_id = old.request_id
     and new.request_metadata = old.request_metadata
     and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'legal acceptances are immutable' using errcode = '23514';
end;
$$;

create trigger legal_acceptances_immutable
before update or delete on public.legal_acceptances
for each row execute function private.protect_legal_acceptance();

alter table public.legal_document_versions enable row level security;
alter table public.legal_acceptances enable row level security;
create policy legal_document_versions_current_read on public.legal_document_versions
  for select to authenticated using (is_current);
create policy legal_acceptances_owner_read on public.legal_acceptances
  for select to authenticated using (
    auth_user_id = (select auth.uid())
    and private.can_read_onboarding_session(onboarding_session_id)
  );

revoke all on public.legal_document_versions from public, anon, authenticated, service_role;
revoke all on public.legal_acceptances from public, anon, authenticated, service_role;
grant select on public.legal_document_versions, public.legal_acceptances to authenticated;
grant select, insert, update on public.legal_acceptances to service_role;
grant select on public.legal_document_versions to service_role;

create or replace function private.commercial_onboarding_slug_base(candidate text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from left(
    regexp_replace(regexp_replace(lower(btrim(candidate)), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'),
    54
  ))
$$;

create or replace function private.commercial_onboarding_allocate_slug(candidate text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  base_slug text := private.commercial_onboarding_slug_base(candidate);
  proposed text;
  suffix integer := 1;
begin
  if base_slug = '' or base_slug in ('admin', 'api', 'app', 'auth', 'billing', 'help', 'login', 'onboarding', 'settings', 'support', 'www') then
    base_slug := 'organisation';
  end if;
  -- Serialise allocation for the same base until the caller's transaction has
  -- inserted the organisation. This prevents two owners selecting the same
  -- available slug concurrently.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(base_slug, 0));
  proposed := base_slug;
  while exists (select 1 from public.organisations organisation where organisation.slug = proposed) loop
    suffix := suffix + 1;
    proposed := left(base_slug, 54 - length(suffix::text) - 1) || '-' || suffix::text;
  end loop;
  return proposed;
end;
$$;

create or replace function private.commercial_onboarding_snapshot(target_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', session.id,
      'organisationId', session.organisation_id,
      'workflowKey', session.workflow_key,
      'workflowVersion', session.workflow_version,
      'status', session.status,
      'currentStepKey', session.current_step_key,
      'revision', session.revision::text,
      'lastActivityAt', session.last_activity_at
    ),
    'security', jsonb_build_object(
      'emailVerified', auth_user.email_confirmed_at is not null,
      'assuranceLevel', coalesce(auth.jwt() ->> 'aal', 'aal1'),
      'legalAcceptancesCurrent', not exists (
        select 1 from public.legal_document_versions document
        where document.is_current and document.locale = 'en-GB'
          and not exists (
            select 1 from public.legal_acceptances acceptance
            where acceptance.auth_user_id = session.owner_auth_user_id
              and acceptance.onboarding_session_id = session.id
              and acceptance.document_type = document.document_type
              and acceptance.document_version = document.document_version
              and acceptance.locale = document.locale
          )
      )
    ),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stepKey', step.step_key,
        'status', step.status,
        'revision', step.revision::text,
        'draftPayload', step.draft_payload,
        'validationSummary', step.validation_summary
      ) order by case step.step_key
        when 'owner_security' then 1 when 'legal_acceptance' then 2 when 'organisation' then 3 else 99 end)
      from public.onboarding_step_states step
      where step.session_id = session.id
        and step.step_key in ('owner_security', 'legal_acceptance', 'organisation')
    ), '[]'::jsonb),
    'legalDocuments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'documentType', document.document_type,
        'documentVersion', document.document_version,
        'locale', document.locale,
        'title', document.title,
        'summary', document.summary,
        'effectiveAt', document.effective_at,
        'accepted', exists (
          select 1 from public.legal_acceptances acceptance
          where acceptance.auth_user_id = session.owner_auth_user_id
            and acceptance.onboarding_session_id = session.id
            and acceptance.document_type = document.document_type
            and acceptance.document_version = document.document_version
            and acceptance.locale = document.locale
        )
      ) order by document.document_type)
      from public.legal_document_versions document
      where document.is_current and document.locale = 'en-GB'
    ), '[]'::jsonb)
  )
  from public.onboarding_sessions session
  join auth.users auth_user on auth_user.id = session.owner_auth_user_id
  where session.id = target_session_id
    and session.owner_auth_user_id = auth.uid()
$$;

create or replace function public.get_or_create_onboarding_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_session public.onboarding_sessions%rowtype;
  email_ready boolean;
  mfa_ready boolean;
  security_status text;
  existing_security_status text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(current_user_id::text));

  select session.* into target_session
  from public.onboarding_sessions session
  where session.owner_auth_user_id = current_user_id and session.status <> 'abandoned'
  order by (session.organisation_id is null) desc, session.created_at desc
  limit 1 for update;

  email_ready := exists (
    select 1 from auth.users auth_user
    where auth_user.id = current_user_id and auth_user.email_confirmed_at is not null
  );
  mfa_ready := coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
  security_status := case when email_ready and mfa_ready then 'complete' else 'blocked' end;

  if not found then
    insert into public.onboarding_sessions (
      owner_auth_user_id, workflow_key, workflow_version, status, current_step_key, revision
    ) values (
      current_user_id, 'commercial_customer_v1', 1, 'in_progress', 'owner_account', 0
    ) returning * into target_session;

    insert into public.onboarding_step_states (
      session_id, step_key, step_version, status, revision, started_at, completed_at,
      last_saved_at, completed_by_auth_user_id
    ) values
      (target_session.id, 'owner_security', 1, security_status, 0, now(),
       case when security_status = 'complete' then now() else null end, now(),
       case when security_status = 'complete' then current_user_id else null end),
      (target_session.id, 'legal_acceptance', 1,
       case when security_status = 'complete' then 'in_progress' else 'blocked' end,
       0, null, null, null, null),
      (target_session.id, 'organisation', 1, 'not_started', 0, null, null, null, null);

    insert into public.onboarding_events (
      session_id, event_type, step_key, actor_type, actor_auth_user_id,
      workflow_revision, safe_metadata
    ) values (
      target_session.id, 'onboarding_started', 'owner_account', 'owner', current_user_id,
      target_session.revision, jsonb_build_object('statusCode', 'in_progress')
    );
  else
    select step.status into existing_security_status
    from public.onboarding_step_states step
    where step.session_id = target_session.id and step.step_key = 'owner_security'
    for update;

    if existing_security_status is distinct from security_status then
      update public.onboarding_step_states
      set status = security_status, revision = revision + 1,
          completed_at = case when security_status = 'complete' then now() else null end,
          completed_by_auth_user_id = case when security_status = 'complete' then current_user_id else null end,
          started_at = coalesce(started_at, now()), last_saved_at = now()
      where session_id = target_session.id and step_key = 'owner_security';
      update public.onboarding_step_states
      set status = case when security_status = 'complete' then 'in_progress' else 'blocked' end,
          revision = revision + 1,
          started_at = case when security_status = 'complete' then coalesce(started_at, now()) else started_at end,
          last_saved_at = now()
      where session_id = target_session.id and step_key = 'legal_acceptance' and status <> 'complete';
      update public.onboarding_sessions
      set revision = revision + 1, last_activity_at = now(),
          current_step_key = case when security_status = 'complete' then current_step_key else 'owner_account' end
      where id = target_session.id returning * into target_session;
    end if;
  end if;

  if email_ready then
    insert into public.onboarding_events (
      session_id, organisation_id, event_type, step_key, actor_type,
      actor_auth_user_id, workflow_revision, safe_metadata
    ) select target_session.id, target_session.organisation_id, 'owner_email_verified',
      'owner_security', 'owner', current_user_id, target_session.revision,
      jsonb_build_object('statusCode', 'verified')
    where not exists (
      select 1 from public.onboarding_events event
      where event.session_id = target_session.id and event.event_type = 'owner_email_verified'
    );
  end if;
  if mfa_ready then
    insert into public.onboarding_events (
      session_id, organisation_id, event_type, step_key, actor_type,
      actor_auth_user_id, workflow_revision, safe_metadata
    ) select target_session.id, target_session.organisation_id, 'owner_mfa_ready',
      'owner_security', 'owner', current_user_id, target_session.revision,
      jsonb_build_object('statusCode', 'aal2')
    where not exists (
      select 1 from public.onboarding_events event
      where event.session_id = target_session.id and event.event_type = 'owner_mfa_ready'
    );
  end if;

  return private.commercial_onboarding_snapshot(target_session.id);
end;
$$;

create or replace function public.execute_onboarding_bootstrap_command(command_envelope jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_session public.onboarding_sessions%rowtype;
  existing_receipt public.onboarding_command_receipts%rowtype;
  command_receipt public.onboarding_command_receipts%rowtype;
  command_type_value text;
  idempotency_key_value uuid;
  expected_revision_value bigint;
  request_hash_value text;
  payload_value jsonb;
  issues_value jsonb := '[]'::jsonb;
  readiness_value jsonb;
  response_value jsonb;
  organisation_id_value uuid;
  membership_id_value uuid;
  slug_value text;
  email_ready boolean;
  mfa_ready boolean;
  legal_ready boolean;
  result_code_value text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if command_envelope is null or jsonb_typeof(command_envelope) <> 'object'
     or (select count(*) from jsonb_object_keys(command_envelope)) <> 8
     or exists (select 1 from jsonb_object_keys(command_envelope) key where key not in (
       'schemaVersion', 'workflowKey', 'workflowVersion', 'sessionId', 'commandType',
       'idempotencyKey', 'expectedSessionRevision', 'payload'))
     or command_envelope ->> 'schemaVersion' <> '1'
     or command_envelope ->> 'workflowKey' <> 'commercial_customer_v1'
     or command_envelope ->> 'workflowVersion' <> '1'
     or jsonb_typeof(command_envelope -> 'payload') <> 'object'
     or not ((command_envelope ->> 'sessionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or not ((command_envelope ->> 'idempotencyKey') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or not ((command_envelope ->> 'expectedSessionRevision') ~ '^(0|[1-9][0-9]*)$') then
    raise exception 'invalid onboarding command envelope' using errcode = '22023';
  end if;

  command_type_value := command_envelope ->> 'commandType';
  if command_type_value not in ('accept_legal_documents', 'create_organisation') then
    raise exception 'unsupported bootstrap command type' using errcode = '22023';
  end if;
  idempotency_key_value := (command_envelope ->> 'idempotencyKey')::uuid;
  expected_revision_value := (command_envelope ->> 'expectedSessionRevision')::bigint;
  request_hash_value := private.onboarding_request_digest(command_envelope);
  payload_value := command_envelope -> 'payload';

  select session.* into target_session from public.onboarding_sessions session
  where session.id = (command_envelope ->> 'sessionId')::uuid for update;
  if not found or target_session.owner_auth_user_id <> current_user_id then
    return private.onboarding_command_response(
      command_envelope, 'permission_denied', 'not_saved', 'permission_denied', '{}'::jsonb,
      expected_revision_value, jsonb_build_array(jsonb_build_object(
        'code', 'permission_denied', 'message', 'This onboarding command is not available.',
        'fieldPath', jsonb_build_array(), 'repairRoute', null)), null
    ) || jsonb_build_object('bootstrap', null);
  end if;

  select receipt.* into existing_receipt from public.onboarding_command_receipts receipt
  where receipt.session_id = target_session.id and receipt.command_type = command_type_value
    and receipt.idempotency_key = idempotency_key_value;
  if found then
    if existing_receipt.request_hash <> request_hash_value then
      return private.onboarding_command_response(
        command_envelope, 'validation_failed', 'not_saved', 'idempotency_key_reused', '{}'::jsonb,
        target_session.revision, jsonb_build_array(jsonb_build_object(
          'code', 'idempotency_key_reused',
          'message', 'This request key was already used for different onboarding data.',
          'fieldPath', jsonb_build_array('idempotencyKey'), 'repairRoute', null)),
        private.onboarding_foundation_readiness(target_session.id, null)
      ) || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
    end if;
    if existing_receipt.status in ('succeeded', 'failed_final') then
      return private.onboarding_command_response(
        command_envelope,
        case when existing_receipt.status = 'succeeded' then 'replayed' else existing_receipt.result_outcome end,
        existing_receipt.result_data_state, existing_receipt.result_code,
        coalesce(existing_receipt.result_reference, '{}'::jsonb),
        existing_receipt.result_session_revision,
        coalesce(existing_receipt.result_issues, '[]'::jsonb), coalesce(existing_receipt.result_readiness,
          private.onboarding_foundation_readiness(target_session.id, existing_receipt.id))
      ) || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
    end if;
    return private.onboarding_command_response(
      command_envelope, 'indeterminate', 'unknown', 'command_in_progress', '{}'::jsonb,
      target_session.revision, jsonb_build_array(jsonb_build_object(
        'code', 'reconciliation_required', 'message', 'This request is still being reconciled.',
        'fieldPath', jsonb_build_array(), 'repairRoute', '/onboarding')),
      private.onboarding_foundation_readiness(target_session.id, null)
    ) || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
  end if;

  insert into public.onboarding_command_receipts (
    session_id, organisation_id, command_type, idempotency_key, request_hash, status
  ) values (target_session.id, target_session.organisation_id, command_type_value,
    idempotency_key_value, request_hash_value, 'processing') returning * into command_receipt;

  if target_session.revision <> expected_revision_value then
    issues_value := jsonb_build_array(jsonb_build_object(
      'code', 'stale_session_revision',
      'message', 'Onboarding changed after this form was opened. Reload and try again.',
      'fieldPath', jsonb_build_array('expectedSessionRevision'), 'repairRoute', '/onboarding'));
    readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
    update public.onboarding_command_receipts set status = 'failed_final',
      result_code = 'stale_session_revision', result_outcome = 'workflow_changed',
      result_data_state = 'not_saved', result_session_revision = target_session.revision,
      result_issues = issues_value, result_readiness = readiness_value, completed_at = now()
    where id = command_receipt.id;
    return private.onboarding_command_response(command_envelope, 'workflow_changed', 'not_saved',
      'stale_session_revision', '{}'::jsonb, target_session.revision, issues_value, readiness_value)
      || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
  end if;

  email_ready := exists (select 1 from auth.users auth_user
    where auth_user.id = current_user_id and auth_user.email_confirmed_at is not null);
  mfa_ready := coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
  legal_ready := not exists (
    select 1 from public.legal_document_versions document
    where document.is_current and document.locale = 'en-GB'
      and not exists (select 1 from public.legal_acceptances acceptance
        where acceptance.auth_user_id = current_user_id
          and acceptance.onboarding_session_id = target_session.id
          and acceptance.document_type = document.document_type
          and acceptance.document_version = document.document_version
          and acceptance.locale = document.locale)
  );

  if command_type_value = 'accept_legal_documents' then
    if not email_ready then result_code_value := 'email_verification_required';
    elsif not mfa_ready then result_code_value := 'mfa_required';
    elsif (select count(*) from jsonb_object_keys(payload_value)) <> 2
       or exists (select 1 from jsonb_object_keys(payload_value) key
         where key not in ('acceptances', 'safeRequestMetadata'))
       or payload_value -> 'safeRequestMetadata' <> '{"source":"commercial_onboarding"}'::jsonb
       or jsonb_typeof(payload_value -> 'acceptances') <> 'array'
       or jsonb_array_length(payload_value -> 'acceptances') <> 3
       or exists (
         select 1 from jsonb_array_elements(payload_value -> 'acceptances') item
         where jsonb_typeof(item) <> 'object'
           or (select count(*) from jsonb_object_keys(item)) <> 3
           or exists (select 1 from jsonb_object_keys(item) key
             where key not in ('documentType', 'documentVersion', 'locale'))
           or not exists (select 1 from public.legal_document_versions document
             where document.is_current
               and document.document_type = item ->> 'documentType'
               and document.document_version = item ->> 'documentVersion'
               and document.locale = item ->> 'locale')
       )
       or (select count(distinct item ->> 'documentType')
           from jsonb_array_elements(payload_value -> 'acceptances') item) <> 3 then
      result_code_value := coalesce(result_code_value, 'legal_acceptance_required');
    end if;
    if result_code_value is not null then
      issues_value := jsonb_build_array(jsonb_build_object(
        'code', result_code_value, 'message', case result_code_value
          when 'email_verification_required' then 'Verify your email address before continuing.'
          when 'mfa_required' then 'Complete multi-factor authentication before continuing.'
          else 'Accept the current required legal documents before continuing.' end,
        'fieldPath', jsonb_build_array(), 'repairRoute', case when result_code_value = 'mfa_required' then '/mfa' else '/onboarding' end));
      readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
      update public.onboarding_command_receipts set status = 'failed_final', result_code = result_code_value,
        result_outcome = 'capability_denied', result_data_state = 'not_saved',
        result_session_revision = target_session.revision, result_issues = issues_value,
        result_readiness = readiness_value, completed_at = now() where id = command_receipt.id;
      return private.onboarding_command_response(command_envelope, 'capability_denied', 'not_saved',
        result_code_value, '{}'::jsonb, target_session.revision, issues_value, readiness_value)
        || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
    end if;

    insert into public.legal_acceptances (
      auth_user_id, onboarding_session_id, organisation_id, document_type,
      document_version, locale, request_id, request_metadata
    ) select current_user_id, target_session.id, target_session.organisation_id,
      item ->> 'documentType', item ->> 'documentVersion', item ->> 'locale',
      idempotency_key_value, payload_value -> 'safeRequestMetadata'
    from jsonb_array_elements(payload_value -> 'acceptances') item
    on conflict (auth_user_id, onboarding_session_id, document_type, document_version, locale) do nothing;

    update public.onboarding_step_states set status = 'complete', revision = revision + 1,
      started_at = coalesce(started_at, now()), completed_at = now(), last_saved_at = now(),
      completed_by_auth_user_id = current_user_id
    where session_id = target_session.id and step_key = 'legal_acceptance';
    update public.onboarding_sessions set current_step_key = 'organisation', revision = revision + 1,
      last_activity_at = now() where id = target_session.id returning * into target_session;
    insert into public.onboarding_events (
      session_id, organisation_id, event_type, step_key, actor_type, actor_auth_user_id,
      request_id, workflow_revision, safe_metadata
    ) values (target_session.id, target_session.organisation_id, 'legal_acceptance_completed',
      'legal_acceptance', 'owner', current_user_id, idempotency_key_value,
      target_session.revision, jsonb_build_object('statusCode', 'accepted',
        'resourceCounts', jsonb_build_object('documents', 3)));
    result_code_value := 'legal_acceptance_completed';
  else
    if not email_ready then result_code_value := 'email_verification_required';
    elsif not mfa_ready then result_code_value := 'mfa_required';
    elsif not legal_ready then result_code_value := 'legal_acceptance_required';
    elsif target_session.organisation_id is not null then result_code_value := 'organisation_already_created';
    end if;
    if result_code_value is not null then
      issues_value := jsonb_build_array(jsonb_build_object(
        'code', result_code_value, 'message', case result_code_value
          when 'email_verification_required' then 'Verify your email address before creating an organisation.'
          when 'mfa_required' then 'Complete multi-factor authentication before creating an organisation.'
          when 'legal_acceptance_required' then 'Accept the current required legal documents before creating an organisation.'
          else 'This onboarding session already has an organisation.' end,
        'fieldPath', jsonb_build_array(), 'repairRoute', case
          when result_code_value = 'mfa_required' then '/mfa'
          when result_code_value = 'legal_acceptance_required' then '/onboarding/legal'
          else '/onboarding' end));
      readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
      update public.onboarding_command_receipts set status = 'failed_final', result_code = result_code_value,
        result_outcome = 'capability_denied', result_data_state = 'not_saved',
        result_session_revision = target_session.revision, result_issues = issues_value,
        result_readiness = readiness_value, completed_at = now() where id = command_receipt.id;
      return private.onboarding_command_response(command_envelope, 'capability_denied', 'not_saved',
        result_code_value, '{}'::jsonb, target_session.revision, issues_value, readiness_value)
        || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
    end if;

    if jsonb_typeof(payload_value) <> 'object'
       or not (payload_value ?& array[
         'displayName', 'legalName', 'contactEmail', 'country', 'timezone', 'postalAddress'
       ]::text[])
       or (select count(*) from jsonb_object_keys(payload_value)) not between 6 and 7
       or exists (select 1 from jsonb_object_keys(payload_value) key where key not in (
         'displayName', 'legalName', 'contactEmail', 'country', 'timezone', 'postalAddress', 'phone'))
       or jsonb_typeof(payload_value -> 'postalAddress') <> 'object'
       or not ((payload_value -> 'postalAddress') ?& array['line1', 'locality', 'postcode']::text[])
       or (select count(*) from jsonb_object_keys(payload_value -> 'postalAddress')) not between 3 and 5
       or exists (select 1 from jsonb_object_keys(payload_value -> 'postalAddress') key
         where key not in ('line1', 'line2', 'locality', 'region', 'postcode'))
       or length(btrim(payload_value ->> 'displayName')) not between 2 and 160
       or length(btrim(payload_value ->> 'legalName')) not between 2 and 200
       or not (lower(payload_value ->> 'contactEmail') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
       or not ((payload_value ->> 'country') ~ '^[A-Z]{2}$')
       or length(btrim(payload_value ->> 'timezone')) not between 1 and 80
       or length(btrim(payload_value -> 'postalAddress' ->> 'line1')) not between 2 and 160
       or length(btrim(payload_value -> 'postalAddress' ->> 'locality')) not between 2 and 120
       or length(btrim(payload_value -> 'postalAddress' ->> 'postcode')) not between 2 and 24 then
      issues_value := jsonb_build_array(jsonb_build_object(
        'code', 'invalid_organisation_details', 'message', 'Check the organisation details and try again.',
        'fieldPath', jsonb_build_array('payload'), 'repairRoute', '/onboarding/organisation'));
      readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
      update public.onboarding_command_receipts set status = 'failed_final',
        result_code = 'invalid_organisation_details', result_outcome = 'validation_failed',
        result_data_state = 'not_saved', result_session_revision = target_session.revision,
        result_issues = issues_value, result_readiness = readiness_value, completed_at = now()
      where id = command_receipt.id;
      return private.onboarding_command_response(command_envelope, 'validation_failed', 'not_saved',
        'invalid_organisation_details', '{}'::jsonb, target_session.revision, issues_value, readiness_value)
        || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
    end if;

    slug_value := private.commercial_onboarding_allocate_slug(payload_value ->> 'displayName');
    insert into public.organisations (
      legal_name, display_name, slug, status, country_code, timezone, billing_email,
      contact_email, contact_phone, address_line_1, address_line_2, locality, region, postcode
    ) values (
      btrim(payload_value ->> 'legalName'), btrim(payload_value ->> 'displayName'), slug_value,
      'trial', payload_value ->> 'country', btrim(payload_value ->> 'timezone'),
      lower(payload_value ->> 'contactEmail'), lower(payload_value ->> 'contactEmail'),
      nullif(btrim(payload_value ->> 'phone'), ''),
      btrim(payload_value -> 'postalAddress' ->> 'line1'),
      nullif(btrim(payload_value -> 'postalAddress' ->> 'line2'), ''),
      btrim(payload_value -> 'postalAddress' ->> 'locality'),
      nullif(btrim(payload_value -> 'postalAddress' ->> 'region'), ''),
      upper(btrim(payload_value -> 'postalAddress' ->> 'postcode'))
    ) returning id into organisation_id_value;

    insert into public.organisation_memberships (
      organisation_id, auth_user_id, status, joined_at
    ) values (organisation_id_value, current_user_id, 'active', now())
    returning id into membership_id_value;
    insert into public.membership_role_assignments (
      organisation_id, membership_id, role, scope_type, granted_by_membership_id
    ) values (organisation_id_value, membership_id_value, 'organisation_owner',
      'organisation', membership_id_value);
    insert into public.organisation_settings (organisation_id, default_timezone)
    values (organisation_id_value, btrim(payload_value ->> 'timezone'));

    update public.onboarding_sessions set organisation_id = organisation_id_value,
      current_step_key = 'first_site', revision = revision + 1, last_activity_at = now()
    where id = target_session.id returning * into target_session;
    update public.legal_acceptances set organisation_id = organisation_id_value
    where onboarding_session_id = target_session.id and organisation_id is null;
    update public.onboarding_step_states set status = 'complete', revision = revision + 1,
      draft_payload = '{}'::jsonb, validation_summary = '[]'::jsonb,
      started_at = coalesce(started_at, now()), completed_at = now(), last_saved_at = now(),
      completed_by_auth_user_id = current_user_id
    where session_id = target_session.id and step_key = 'organisation';

    insert into public.onboarding_events (
      session_id, organisation_id, event_type, step_key, actor_type, actor_auth_user_id,
      actor_membership_id, request_id, workflow_revision, safe_metadata
    ) values
      (target_session.id, organisation_id_value, 'organisation_creation_started', 'organisation',
       'owner', current_user_id, membership_id_value, idempotency_key_value,
       target_session.revision, jsonb_build_object('statusCode', 'started')),
      (target_session.id, organisation_id_value, 'organisation_created', 'organisation',
       'owner', current_user_id, membership_id_value, idempotency_key_value,
       target_session.revision, jsonb_build_object('statusCode', 'created',
         'resourceCounts', jsonb_build_object('organisations', 1, 'sites', 0)));
    result_code_value := 'organisation_created';
  end if;

  readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
  update public.onboarding_command_receipts set status = 'succeeded', result_code = result_code_value,
    result_outcome = 'succeeded', result_data_state = 'saved',
    result_session_revision = target_session.revision, result_issues = '[]'::jsonb,
    result_readiness = readiness_value, result_reference = case
      when organisation_id_value is null then '{}'::jsonb
      else jsonb_build_object('organisationId', organisation_id_value) end,
    completed_at = now()
  where id = command_receipt.id;

  response_value := private.onboarding_command_response(
    command_envelope, 'succeeded', 'saved', result_code_value,
    case when organisation_id_value is null then '{}'::jsonb
      else jsonb_build_object('organisationId', organisation_id_value) end,
    target_session.revision, '[]'::jsonb, readiness_value
  );
  return response_value || jsonb_build_object(
    'bootstrap', private.commercial_onboarding_snapshot(target_session.id));
end;
$$;

revoke all on function private.protect_legal_acceptance() from public, anon, authenticated, service_role;
revoke all on function private.commercial_onboarding_slug_base(text) from public, anon, authenticated, service_role;
revoke all on function private.commercial_onboarding_allocate_slug(text) from public, anon, authenticated, service_role;
revoke all on function private.commercial_onboarding_snapshot(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_or_create_onboarding_bootstrap() from public, anon, authenticated, service_role;
revoke all on function public.execute_onboarding_bootstrap_command(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_or_create_onboarding_bootstrap() to authenticated;
grant execute on function public.execute_onboarding_bootstrap_command(jsonb) to authenticated;
