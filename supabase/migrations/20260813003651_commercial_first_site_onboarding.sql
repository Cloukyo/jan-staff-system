-- Commercial Workstream 7B: first site and site defaults.
-- Additive commercial-preview migration. No kiosk device, billing or offline authority is created.

alter table public.organisation_sites
  add column country_code text not null default 'GB' check (country_code ~ '^[A-Z]{2}$'),
  add column region text;

alter table public.onboarding_events drop constraint onboarding_events_event_type_check;
alter table public.onboarding_events add constraint onboarding_events_event_type_check check (event_type in (
  'onboarding_started', 'signup_started', 'owner_email_verified', 'owner_mfa_enrolled',
  'owner_mfa_ready', 'legal_acceptance_completed', 'organisation_creation_started',
  'organisation_created', 'first_site_started', 'first_site_validation_failed',
  'first_site_defaults_created', 'first_site_created', 'plan_selected', 'trial_activated',
  'settings_completed', 'staff_import_started', 'staff_import_validated',
  'staff_import_committed', 'manager_invitations_created', 'staff_invitations_created',
  'kiosk_registration_started', 'kiosk_connected', 'readiness_evaluated',
  'go_live_blocked', 'go_live_completed', 'restricted_mode_entered', 'subscription_recovered'
));

create or replace function private.commercial_site_slug_base(candidate text)
returns text language sql immutable set search_path = '' as $$
  select trim(both '-' from left(
    regexp_replace(regexp_replace(lower(btrim(candidate)), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'), 54
  ))
$$;

create or replace function private.commercial_allocate_site_slug(target_organisation_id uuid, candidate text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  base_slug text := private.commercial_site_slug_base(candidate);
  proposed text;
  suffix integer := 1;
begin
  if base_slug = '' or base_slug in ('admin', 'api', 'app', 'auth', 'billing', 'help', 'login', 'onboarding', 'settings', 'support', 'www') then
    base_slug := 'site';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_organisation_id::text || ':' || base_slug, 0));
  proposed := base_slug;
  while exists (select 1 from public.organisation_sites site
    where site.organisation_id = target_organisation_id and site.slug = proposed) loop
    suffix := suffix + 1;
    proposed := left(base_slug, 54 - length(suffix::text) - 1) || '-' || suffix::text;
  end loop;
  return proposed;
end;
$$;

-- Extend the authoritative bootstrap snapshot with the durable 7B step.
create or replace function private.commercial_onboarding_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', session.id, 'organisationId', session.organisation_id,
      'workflowKey', session.workflow_key, 'workflowVersion', session.workflow_version,
      'status', session.status, 'currentStepKey', session.current_step_key,
      'revision', session.revision::text, 'lastActivityAt', session.last_activity_at
    ),
    'security', jsonb_build_object(
      'emailVerified', auth_user.email_confirmed_at is not null,
      'assuranceLevel', coalesce(auth.jwt() ->> 'aal', 'aal1'),
      'legalAcceptancesCurrent', not exists (
        select 1 from public.legal_document_versions document
        where document.is_current and document.locale = 'en-GB'
          and not exists (select 1 from public.legal_acceptances acceptance
            where acceptance.auth_user_id = session.owner_auth_user_id
              and acceptance.onboarding_session_id = session.id
              and acceptance.document_type = document.document_type
              and acceptance.document_version = document.document_version
              and acceptance.locale = document.locale)
      )
    ),
    'steps', coalesce((select jsonb_agg(jsonb_build_object(
      'stepKey', step.step_key, 'status', step.status, 'revision', step.revision::text,
      'draftPayload', step.draft_payload, 'validationSummary', step.validation_summary
    ) order by case step.step_key when 'owner_security' then 1 when 'legal_acceptance' then 2
      when 'organisation' then 3 when 'first_site' then 4 else 99 end)
      from public.onboarding_step_states step where step.session_id = session.id
        and step.step_key in ('owner_security', 'legal_acceptance', 'organisation', 'first_site')), '[]'::jsonb),
    'legalDocuments', coalesce((select jsonb_agg(jsonb_build_object(
      'documentType', document.document_type, 'documentVersion', document.document_version,
      'locale', document.locale, 'title', document.title, 'summary', document.summary,
      'effectiveAt', document.effective_at, 'accepted', exists (
        select 1 from public.legal_acceptances acceptance
        where acceptance.auth_user_id = session.owner_auth_user_id
          and acceptance.onboarding_session_id = session.id
          and acceptance.document_type = document.document_type
          and acceptance.document_version = document.document_version
          and acceptance.locale = document.locale)
    ) order by document.document_type) from public.legal_document_versions document
      where document.is_current and document.locale = 'en-GB'), '[]'::jsonb),
    'siteSummary', (select jsonb_build_object(
      'siteId', site.id,
      'displayName', coalesce(settings.local_settings ->> 'displayName', site.name),
      'timezone', coalesce(settings.timezone_override, site.timezone)
    ) from public.organisation_sites site
      left join public.site_settings settings on settings.organisation_id = site.organisation_id and settings.site_id = site.id
      where site.organisation_id = session.organisation_id and site.archived_at is null
      order by site.created_at limit 1)
  )
  from public.onboarding_sessions session
  join auth.users auth_user on auth_user.id = session.owner_auth_user_id
  where session.id = target_session_id and session.owner_auth_user_id = auth.uid()
$$;

-- Preserve the 7A implementation behind a private boundary and extend the public RPC.
alter function public.get_or_create_onboarding_bootstrap()
  rename to get_or_create_onboarding_bootstrap_7a;
alter function public.get_or_create_onboarding_bootstrap_7a()
  set schema private;

create or replace function public.get_or_create_onboarding_bootstrap()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  initial_snapshot jsonb;
  target_session_id uuid;
begin
  initial_snapshot := private.get_or_create_onboarding_bootstrap_7a();
  target_session_id := (initial_snapshot -> 'session' ->> 'id')::uuid;
  insert into public.onboarding_step_states (session_id, organisation_id, step_key, step_version, status, revision)
  select session.id, session.organisation_id, 'first_site', 1, 'not_started', 0
  from public.onboarding_sessions session where session.id = target_session_id
  on conflict (session_id, step_key) do nothing;
  return private.commercial_onboarding_snapshot(target_session_id);
end;
$$;

alter function public.execute_onboarding_bootstrap_command(jsonb)
  rename to execute_onboarding_bootstrap_command_7a;
alter function public.execute_onboarding_bootstrap_command_7a(jsonb)
  set schema private;

create or replace function public.execute_onboarding_bootstrap_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  target_session public.onboarding_sessions%rowtype;
  owner_membership public.organisation_memberships%rowtype;
  existing_receipt public.onboarding_command_receipts%rowtype;
  command_receipt public.onboarding_command_receipts%rowtype;
  command_type_value text;
  idempotency_key_value uuid;
  expected_revision_value bigint;
  request_hash_value text;
  payload_value jsonb;
  issues_value jsonb := '[]'::jsonb;
  readiness_value jsonb;
  result_code_value text;
  result_reference_value jsonb := '{}'::jsonb;
  site_id_value uuid;
  site_slug_value text;
  opening_time_value time;
  closing_time_value time;
  organisation_week_start smallint;
  organisation_timezone text;
begin
  if command_envelope ->> 'commandType' not in ('save_step_draft', 'create_first_site') then
    return private.execute_onboarding_bootstrap_command_7a(command_envelope);
  end if;
  if current_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
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
  idempotency_key_value := (command_envelope ->> 'idempotencyKey')::uuid;
  expected_revision_value := (command_envelope ->> 'expectedSessionRevision')::bigint;
  request_hash_value := private.onboarding_request_digest(command_envelope);
  payload_value := command_envelope -> 'payload';

  select session.* into target_session from public.onboarding_sessions session
  where session.id = (command_envelope ->> 'sessionId')::uuid for update;
  if not found or target_session.owner_auth_user_id <> current_user_id or target_session.organisation_id is null then
    return private.onboarding_command_response(command_envelope, 'permission_denied', 'not_saved',
      'permission_denied', '{}'::jsonb, expected_revision_value,
      jsonb_build_array(jsonb_build_object('code', 'permission_denied',
        'message', 'This onboarding command is not available.', 'fieldPath', jsonb_build_array(), 'repairRoute', null)), null)
      || jsonb_build_object('bootstrap', null);
  end if;
  select membership.* into owner_membership from public.organisation_memberships membership
  where membership.organisation_id = target_session.organisation_id
    and membership.auth_user_id = current_user_id and membership.status = 'active'
    and exists (select 1 from public.membership_role_assignments role
      where role.organisation_id = membership.organisation_id and role.membership_id = membership.id
        and role.role = 'organisation_owner' and role.scope_type = 'organisation' and role.revoked_at is null)
  for update;
  if not found then
    return private.onboarding_command_response(command_envelope, 'permission_denied', 'not_saved',
      'owner_access_required', '{}'::jsonb, target_session.revision,
      jsonb_build_array(jsonb_build_object('code', 'owner_access_required',
        'message', 'Active organisation owner access is required.', 'fieldPath', jsonb_build_array(), 'repairRoute', '/onboarding')),
      private.onboarding_foundation_readiness(target_session.id, null))
      || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
  end if;

  select receipt.* into existing_receipt from public.onboarding_command_receipts receipt
  where receipt.session_id = target_session.id and receipt.command_type = command_type_value
    and receipt.idempotency_key = idempotency_key_value;
  if found then
    if existing_receipt.request_hash <> request_hash_value then
      return private.onboarding_command_response(command_envelope, 'validation_failed', 'not_saved',
        'idempotency_key_reused', '{}'::jsonb, target_session.revision,
        jsonb_build_array(jsonb_build_object('code', 'idempotency_key_reused',
          'message', 'This request key was already used for different onboarding data.',
          'fieldPath', jsonb_build_array('idempotencyKey'), 'repairRoute', null)),
        private.onboarding_foundation_readiness(target_session.id, null))
        || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
    end if;
    if existing_receipt.status in ('succeeded', 'failed_final') then
      return private.onboarding_command_response(command_envelope,
        case when existing_receipt.status = 'succeeded' then 'replayed' else existing_receipt.result_outcome end,
        existing_receipt.result_data_state, existing_receipt.result_code,
        coalesce(existing_receipt.result_reference, '{}'::jsonb), existing_receipt.result_session_revision,
        coalesce(existing_receipt.result_issues, '[]'::jsonb), coalesce(existing_receipt.result_readiness,
          private.onboarding_foundation_readiness(target_session.id, existing_receipt.id)))
        || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
    end if;
    return private.onboarding_command_response(command_envelope, 'indeterminate', 'unknown',
      'command_in_progress', '{}'::jsonb, target_session.revision,
      jsonb_build_array(jsonb_build_object('code', 'reconciliation_required',
        'message', 'This request is still being reconciled.', 'fieldPath', jsonb_build_array(), 'repairRoute', '/onboarding')),
      private.onboarding_foundation_readiness(target_session.id, null))
      || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
  end if;

  insert into public.onboarding_command_receipts (
    session_id, organisation_id, command_type, idempotency_key, request_hash, status
  ) values (target_session.id, target_session.organisation_id, command_type_value,
    idempotency_key_value, request_hash_value, 'processing') returning * into command_receipt;

  if target_session.revision <> expected_revision_value then
    result_code_value := 'stale_session_revision';
    issues_value := jsonb_build_array(jsonb_build_object('code', result_code_value,
      'message', 'Onboarding changed after this form was opened. Reload and try again.',
      'fieldPath', jsonb_build_array('expectedSessionRevision'), 'repairRoute', '/onboarding'));
  elsif coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    result_code_value := 'mfa_required';
    issues_value := jsonb_build_array(jsonb_build_object('code', result_code_value,
      'message', 'Complete multi-factor authentication before continuing.',
      'fieldPath', jsonb_build_array(), 'repairRoute', '/mfa'));
  elsif not exists (select 1 from public.onboarding_step_states step where step.session_id = target_session.id
      and step.step_key = 'organisation' and step.status = 'complete') then
    result_code_value := 'organisation_required';
    issues_value := jsonb_build_array(jsonb_build_object('code', result_code_value,
      'message', 'Complete organisation setup before adding a site.',
      'fieldPath', jsonb_build_array(), 'repairRoute', '/onboarding/organisation'));
  elsif exists (select 1 from public.organisation_sites site
      where site.organisation_id = target_session.organisation_id and site.archived_at is null)
     or exists (select 1 from public.onboarding_step_states step where step.session_id = target_session.id
      and step.step_key = 'first_site' and step.status = 'complete') then
    result_code_value := 'first_site_already_created';
    issues_value := jsonb_build_array(jsonb_build_object('code', result_code_value,
      'message', 'The first site has already been created.', 'fieldPath', jsonb_build_array(), 'repairRoute', '/onboarding/next'));
  end if;
  if result_code_value is not null then
    readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
    update public.onboarding_command_receipts set status = 'failed_final', result_code = result_code_value,
      result_outcome = case when result_code_value = 'stale_session_revision' then 'workflow_changed' else 'capability_denied' end,
      result_data_state = 'not_saved', result_session_revision = target_session.revision,
      result_issues = issues_value, result_readiness = readiness_value, completed_at = now() where id = command_receipt.id;
    return private.onboarding_command_response(command_envelope,
      case when result_code_value = 'stale_session_revision' then 'workflow_changed' else 'capability_denied' end,
      'not_saved', result_code_value, '{}'::jsonb, target_session.revision, issues_value, readiness_value)
      || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
  end if;

  if command_type_value = 'save_step_draft' then
    if (select count(*) from jsonb_object_keys(payload_value)) <> 2
       or payload_value ->> 'stepKey' <> 'first_site'
       or jsonb_typeof(payload_value -> 'draft') <> 'object'
       or exists (select 1 from jsonb_object_keys(payload_value -> 'draft') key where key not in (
         'siteName','displayName','contactPhone','siteEmail','country','timezone','postalAddress',
         'openingHours','workWeekStarts','operationalDayBoundary'))
       or (payload_value -> 'draft' ? 'postalAddress' and (
         jsonb_typeof(payload_value -> 'draft' -> 'postalAddress') <> 'object'
         or exists (select 1 from jsonb_object_keys(payload_value -> 'draft' -> 'postalAddress') key
           where key not in ('line1','line2','locality','region','postcode'))))
       or (payload_value -> 'draft' ? 'openingHours' and (
         jsonb_typeof(payload_value -> 'draft' -> 'openingHours') <> 'array'
         or jsonb_array_length(payload_value -> 'draft' -> 'openingHours') > 7
         or exists (select 1 from jsonb_array_elements(payload_value -> 'draft' -> 'openingHours') day
           where jsonb_typeof(day) <> 'object'
             or exists (select 1 from jsonb_object_keys(day) key where key not in ('dayOfWeek','intervals'))
             or jsonb_typeof(day -> 'intervals') <> 'array'
             or jsonb_array_length(day -> 'intervals') > 4
             or exists (select 1 from jsonb_array_elements(day -> 'intervals') interval
               where jsonb_typeof(interval) <> 'object'
                 or exists (select 1 from jsonb_object_keys(interval) key where key not in ('opensAt','closesAt'))))))
       or length((payload_value -> 'draft')::text) > 20000
       or (payload_value -> 'draft')::text ~* '(password|token|secret|staff.?pin|payment|card.?number)' then
      result_code_value := 'invalid_first_site_draft';
      issues_value := jsonb_build_array(jsonb_build_object('code', result_code_value,
        'message', 'Only safe first-site fields can be saved.', 'fieldPath', jsonb_build_array('payload','draft'),
        'repairRoute', '/onboarding/site'));
    else
      update public.onboarding_step_states set status = 'in_progress', revision = revision + 1,
        draft_payload = payload_value -> 'draft', validation_summary = '[]'::jsonb,
        started_at = coalesce(public.onboarding_step_states.started_at, now()), last_saved_at = now(),
        completed_by_auth_user_id = current_user_id
      where session_id = target_session.id and step_key = 'first_site';
      update public.onboarding_sessions set current_step_key = 'first_site', revision = revision + 1,
        last_activity_at = now() where id = target_session.id returning * into target_session;
      insert into public.onboarding_events (session_id, organisation_id, event_type, step_key,
        actor_type, actor_auth_user_id, actor_membership_id, request_id, workflow_revision, safe_metadata)
      select target_session.id, target_session.organisation_id, 'first_site_started', 'first_site',
        'owner', current_user_id, owner_membership.id, idempotency_key_value, target_session.revision,
        jsonb_build_object('statusCode','in_progress')
      where not exists (select 1 from public.onboarding_events event
        where event.session_id = target_session.id and event.event_type = 'first_site_started');
      result_code_value := 'first_site_draft_saved';
    end if;
  else
    if jsonb_typeof(payload_value) <> 'object'
       or not (payload_value ?& array['siteName','contactPhone','country','timezone','postalAddress',
         'openingHours','workWeekStarts','operationalDayBoundary']::text[])
       or exists (select 1 from jsonb_object_keys(payload_value) key where key not in (
         'siteName','displayName','contactPhone','siteEmail','country','timezone','postalAddress',
         'openingHours','workWeekStarts','operationalDayBoundary'))
       or jsonb_typeof(payload_value -> 'postalAddress') <> 'object'
       or not ((payload_value -> 'postalAddress') ?& array['line1','locality','postcode']::text[])
       or exists (select 1 from jsonb_object_keys(payload_value -> 'postalAddress') key
         where key not in ('line1','line2','locality','region','postcode'))
       or jsonb_typeof(payload_value -> 'siteName') <> 'string'
       or jsonb_typeof(payload_value -> 'contactPhone') <> 'string'
       or jsonb_typeof(payload_value -> 'country') <> 'string'
       or jsonb_typeof(payload_value -> 'timezone') <> 'string'
       or (payload_value ? 'displayName' and jsonb_typeof(payload_value -> 'displayName') <> 'string')
       or (payload_value ? 'siteEmail' and (
         jsonb_typeof(payload_value -> 'siteEmail') <> 'string'
         or not (lower(payload_value ->> 'siteEmail') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')))
       or jsonb_typeof(payload_value -> 'postalAddress' -> 'line1') <> 'string'
       or jsonb_typeof(payload_value -> 'postalAddress' -> 'locality') <> 'string'
       or jsonb_typeof(payload_value -> 'postalAddress' -> 'postcode') <> 'string'
       or length(btrim(payload_value ->> 'siteName')) not between 2 and 160
       or length(btrim(payload_value ->> 'contactPhone')) not between 5 and 40
       or payload_value ->> 'country' <> 'GB' or payload_value ->> 'timezone' <> 'Europe/London'
       or length(btrim(payload_value -> 'postalAddress' ->> 'line1')) not between 2 and 160
       or length(btrim(payload_value -> 'postalAddress' ->> 'locality')) not between 2 and 120
       or length(btrim(payload_value -> 'postalAddress' ->> 'postcode')) not between 2 and 24
       or jsonb_typeof(payload_value -> 'openingHours') <> 'array'
       or jsonb_array_length(payload_value -> 'openingHours') <> 7
       or (select count(distinct day ->> 'dayOfWeek') from jsonb_array_elements(payload_value -> 'openingHours') day) <> 7
       or exists (select 1 from jsonb_array_elements(payload_value -> 'openingHours') day
         where jsonb_typeof(day) <> 'object' or not (day ?& array['dayOfWeek','intervals']::text[])
           or (select count(*) from jsonb_object_keys(day)) <> 2
           or not ((day ->> 'dayOfWeek') ~ '^[1-7]$') or jsonb_typeof(day -> 'intervals') <> 'array'
           or jsonb_array_length(day -> 'intervals') > 4
           or exists (select 1 from jsonb_array_elements(day -> 'intervals') interval
             where jsonb_typeof(interval) <> 'object' or not (interval ?& array['opensAt','closesAt']::text[])
               or (select count(*) from jsonb_object_keys(interval)) <> 2
               or not ((interval ->> 'opensAt') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
               or not ((interval ->> 'closesAt') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
               or interval ->> 'opensAt' >= interval ->> 'closesAt')
           or exists (select 1
             from jsonb_array_elements(day -> 'intervals') with ordinality first_interval(value, position),
               jsonb_array_elements(day -> 'intervals') with ordinality second_interval(value, position)
             where first_interval.position < second_interval.position
               and first_interval.value ->> 'closesAt' > second_interval.value ->> 'opensAt'
               and second_interval.value ->> 'closesAt' > first_interval.value ->> 'opensAt'))
       or jsonb_typeof(payload_value -> 'workWeekStarts') <> 'number'
       or not ((payload_value ->> 'workWeekStarts') ~ '^[1-7]$')
       or jsonb_typeof(payload_value -> 'operationalDayBoundary') <> 'string'
       or not ((payload_value ->> 'operationalDayBoundary') ~ '^(0[0-5]:[0-5][0-9]|06:00)$') then
      result_code_value := 'invalid_first_site_details';
      issues_value := jsonb_build_array(jsonb_build_object('code', result_code_value,
        'message', 'Check the site details and try again.', 'fieldPath', jsonb_build_array('payload'),
        'repairRoute', '/onboarding/site'));
    else
      select settings.work_week_starts, settings.default_timezone
        into organisation_week_start, organisation_timezone
      from public.organisation_settings settings where settings.organisation_id = target_session.organisation_id;
      select min((interval ->> 'opensAt')::time), max((interval ->> 'closesAt')::time)
        into opening_time_value, closing_time_value
      from jsonb_array_elements(payload_value -> 'openingHours') day,
        jsonb_array_elements(day -> 'intervals') interval;
      if opening_time_value is null then
        result_code_value := 'invalid_first_site_details';
        issues_value := jsonb_build_array(jsonb_build_object('code', result_code_value,
          'message', 'Add opening hours for at least one day.', 'fieldPath', jsonb_build_array('payload','openingHours'),
          'repairRoute', '/onboarding/site'));
      else
        site_slug_value := private.commercial_allocate_site_slug(target_session.organisation_id, payload_value ->> 'siteName');
        insert into public.organisation_sites (organisation_id, name, slug, timezone, active,
          country_code, address_line_1, address_line_2, locality, region, postcode, phone, email)
        values (target_session.organisation_id, btrim(payload_value ->> 'siteName'), site_slug_value,
          payload_value ->> 'timezone', true, payload_value ->> 'country',
          btrim(payload_value -> 'postalAddress' ->> 'line1'),
          nullif(btrim(payload_value -> 'postalAddress' ->> 'line2'), ''),
          btrim(payload_value -> 'postalAddress' ->> 'locality'),
          nullif(btrim(payload_value -> 'postalAddress' ->> 'region'), ''),
          upper(btrim(payload_value -> 'postalAddress' ->> 'postcode')),
          btrim(payload_value ->> 'contactPhone'), nullif(lower(btrim(payload_value ->> 'siteEmail')), ''))
        returning id into site_id_value;
        insert into public.site_settings (organisation_id, site_id, opening_time, closing_time,
          closure_dates, rota_policy, kiosk_policy, local_settings, timezone_override,
          work_week_starts_override, operating_overrides, staffing_overrides)
        values (target_session.organisation_id, site_id_value, opening_time_value, closing_time_value,
          '{}', '{}'::jsonb, '{"mode":"online_only","offlineEnabled":false}'::jsonb,
          jsonb_build_object('displayName', coalesce(nullif(btrim(payload_value ->> 'displayName'), ''), btrim(payload_value ->> 'siteName')),
            'workAreaLabel', 'Work area'),
          case when payload_value ->> 'timezone' = organisation_timezone then null else payload_value ->> 'timezone' end,
          case when (payload_value ->> 'workWeekStarts')::smallint = organisation_week_start then null
            else (payload_value ->> 'workWeekStarts')::smallint end,
          jsonb_build_object('openingHours', payload_value -> 'openingHours',
            'operationalDayBoundary', payload_value ->> 'operationalDayBoundary'), '{}'::jsonb);
        insert into public.membership_site_access (organisation_id, membership_id, site_id, granted_by_membership_id)
        values (target_session.organisation_id, owner_membership.id, site_id_value, owner_membership.id);
        update public.onboarding_step_states set status = 'complete', revision = revision + 1,
          draft_payload = '{}'::jsonb, validation_summary = '[]'::jsonb,
          started_at = coalesce(started_at, now()), completed_at = now(), last_saved_at = now(),
          completed_by_auth_user_id = current_user_id
        where session_id = target_session.id and step_key = 'first_site';
        update public.onboarding_sessions set current_step_key = 'subscription', revision = revision + 1,
          last_activity_at = now() where id = target_session.id returning * into target_session;
        insert into public.onboarding_events (session_id, organisation_id, event_type, step_key,
          actor_type, actor_auth_user_id, actor_membership_id, request_id, workflow_revision, safe_metadata)
        values
          (target_session.id, target_session.organisation_id, 'first_site_defaults_created', 'first_site',
           'owner', current_user_id, owner_membership.id, idempotency_key_value, target_session.revision,
           jsonb_build_object('statusCode','created','resourceId',site_id_value,'resourceCounts',jsonb_build_object('site_settings',1))),
          (target_session.id, target_session.organisation_id, 'first_site_created', 'first_site',
           'owner', current_user_id, owner_membership.id, idempotency_key_value, target_session.revision,
           jsonb_build_object('statusCode','created','resourceId',site_id_value,'resourceCounts',jsonb_build_object('sites',1)));
        result_code_value := 'first_site_created';
        result_reference_value := jsonb_build_object('organisationId', target_session.organisation_id, 'siteId', site_id_value);
      end if;
    end if;
  end if;

  if result_code_value in ('invalid_first_site_draft','invalid_first_site_details') then
    update public.onboarding_step_states set status = 'needs_review', revision = revision + 1,
      validation_summary = jsonb_build_array((issues_value -> 0) - 'repairRoute'),
      started_at = coalesce(started_at, now()), last_saved_at = now()
    where session_id = target_session.id and step_key = 'first_site';
    update public.onboarding_sessions set revision = revision + 1, last_activity_at = now()
    where id = target_session.id returning * into target_session;
    insert into public.onboarding_events (session_id, organisation_id, event_type, step_key,
      actor_type, actor_auth_user_id, actor_membership_id, request_id, workflow_revision, safe_metadata)
    values (target_session.id, target_session.organisation_id, 'first_site_validation_failed', 'first_site',
      'owner', current_user_id, owner_membership.id, idempotency_key_value, target_session.revision,
      jsonb_build_object('statusCode','validation_failed'));
    readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
    update public.onboarding_command_receipts set status = 'failed_final', result_code = result_code_value,
      result_outcome = 'validation_failed', result_data_state = 'not_saved',
      result_session_revision = target_session.revision, result_issues = issues_value,
      result_readiness = readiness_value, completed_at = now() where id = command_receipt.id;
    return private.onboarding_command_response(command_envelope, 'validation_failed', 'not_saved', result_code_value,
      '{}'::jsonb, target_session.revision, issues_value, readiness_value)
      || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
  end if;

  readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
  update public.onboarding_command_receipts set status = 'succeeded', result_code = result_code_value,
    result_outcome = 'succeeded', result_data_state = 'saved', result_session_revision = target_session.revision,
    result_issues = '[]'::jsonb, result_readiness = readiness_value,
    result_reference = result_reference_value, completed_at = now() where id = command_receipt.id;
  return private.onboarding_command_response(command_envelope, 'succeeded', 'saved', result_code_value,
    result_reference_value, target_session.revision, '[]'::jsonb, readiness_value)
    || jsonb_build_object('bootstrap', private.commercial_onboarding_snapshot(target_session.id));
end;
$$;

-- Backfill the 7B step for every existing commercial onboarding session.
insert into public.onboarding_step_states (session_id, organisation_id, step_key, step_version, status, revision,
  started_at, completed_at, last_saved_at, completed_by_auth_user_id)
select session.id, session.organisation_id, 'first_site', 1,
  case when exists (select 1 from public.organisation_sites site
    where site.organisation_id = session.organisation_id and site.archived_at is null)
    then 'complete' else 'not_started' end,
  0,
  case when exists (select 1 from public.organisation_sites site where site.organisation_id = session.organisation_id and site.archived_at is null) then now() else null end,
  case when exists (select 1 from public.organisation_sites site where site.organisation_id = session.organisation_id and site.archived_at is null) then now() else null end,
  case when exists (select 1 from public.organisation_sites site where site.organisation_id = session.organisation_id and site.archived_at is null) then now() else null end,
  case when exists (select 1 from public.organisation_sites site where site.organisation_id = session.organisation_id and site.archived_at is null) then session.owner_auth_user_id else null end
from public.onboarding_sessions session
on conflict (session_id, step_key) do nothing;

revoke all on function private.commercial_site_slug_base(text) from public, anon, authenticated, service_role;
revoke all on function private.commercial_allocate_site_slug(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.get_or_create_onboarding_bootstrap_7a() from public, anon, authenticated, service_role;
revoke all on function private.execute_onboarding_bootstrap_command_7a(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.get_or_create_onboarding_bootstrap() from public, anon, authenticated, service_role;
revoke all on function public.execute_onboarding_bootstrap_command(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.get_or_create_onboarding_bootstrap() to authenticated;
grant execute on function public.execute_onboarding_bootstrap_command(jsonb) to authenticated;

-- Site creation is a server-authoritative workflow. Existing tenant-scoped
-- reads and updates remain available, but browsers cannot construct partial
-- site/default rows outside the guarded transaction.
revoke insert on public.organisation_sites, public.site_settings from authenticated;
