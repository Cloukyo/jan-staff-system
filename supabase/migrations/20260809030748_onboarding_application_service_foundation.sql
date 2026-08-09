-- Commercial Workstream 7: server-authoritative onboarding application service foundation.
-- This migration executes only foundation-safe workflow commands. It does not create
-- customer domain records, enable billing, provision kiosks, or authorise offline attendance.

alter table public.onboarding_command_receipts
  add column result_outcome text check (result_outcome is null or result_outcome in (
    'succeeded', 'validation_failed', 'workflow_changed', 'permission_denied',
    'capability_denied', 'retryable_failure', 'indeterminate'
  )),
  add column result_data_state text check (result_data_state is null or result_data_state in (
    'saved', 'not_saved', 'unknown'
  )),
  add column result_session_revision bigint check (result_session_revision is null or result_session_revision >= 0),
  add column result_issues jsonb,
  add column result_readiness jsonb;

-- Persistence existed before the executable service. Preserve any terminal
-- receipts created during that interval and give them replay-safe result state
-- before the stronger invariant is installed.
drop trigger onboarding_command_receipts_protect_replay
  on public.onboarding_command_receipts;

update public.onboarding_command_receipts receipt
set result_outcome = case receipt.status
      when 'succeeded' then 'succeeded'
      when 'failed_retryable' then 'retryable_failure'
      else 'validation_failed'
    end,
    result_data_state = case receipt.status
      when 'succeeded' then 'saved'
      else 'not_saved'
    end,
    result_session_revision = session.revision,
    result_issues = '[]'::jsonb
from public.onboarding_sessions session
where receipt.session_id = session.id
  and receipt.status <> 'processing';

create trigger onboarding_command_receipts_protect_replay
before update on public.onboarding_command_receipts
for each row execute function private.protect_onboarding_command_receipt();

alter table public.onboarding_command_receipts
  add constraint onboarding_command_receipts_result_state_check check (
    (status = 'processing'
      and result_outcome is null
      and result_data_state is null
      and result_session_revision is null
      and result_issues is null
      and result_readiness is null)
    or
    (status <> 'processing'
      and result_outcome is not null
      and result_data_state is not null
      and result_session_revision is not null
      and jsonb_typeof(result_issues) = 'array'
      and (
        (result_outcome = 'succeeded' and result_data_state = 'saved')
        or (result_outcome = 'indeterminate' and result_data_state = 'unknown')
        or (result_outcome not in ('succeeded', 'indeterminate') and result_data_state = 'not_saved')
      ))
  );

create index onboarding_command_receipts_indeterminate_idx
  on public.onboarding_command_receipts (session_id, completed_at)
  where result_outcome = 'indeterminate';

create or replace function private.onboarding_request_digest(command_envelope jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(command_envelope::text, 'sha256'), 'hex')
$$;

create or replace function private.onboarding_foundation_readiness_item(
  item_key text,
  item_result text,
  reason_code text,
  user_message text,
  repair_route text,
  source_revision text,
  evidence_at timestamptz
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'itemKey', item_key,
    'evaluatorVersion', 1,
    'severity', 'blocker',
    'result', item_result,
    'reasonCode', reason_code,
    'userMessage', user_message,
    'repairRoute', repair_route,
    'evidenceAt', evidence_at,
    'sourceRevision', source_revision
  )
$$;

create or replace function private.onboarding_foundation_readiness(
  target_session_id uuid,
  excluded_receipt_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_session public.onboarding_sessions%rowtype;
  evaluated_at timestamptz := now();
  organisation_exists boolean := false;
  owner_membership_exists boolean := false;
  first_site_exists boolean := false;
  settings_exist boolean := false;
  commercial_access_valid boolean := false;
  command_unhealthy boolean := false;
  items jsonb;
  overall_status text;
begin
  select session.* into target_session
  from public.onboarding_sessions session
  where session.id = target_session_id;
  if not found then
    raise exception 'onboarding session does not exist' using errcode = '23503';
  end if;

  organisation_exists := target_session.organisation_id is not null;
  if organisation_exists then
    select exists (
      select 1
      from public.organisation_memberships membership
      join public.membership_role_assignments role_assignment
        on role_assignment.organisation_id = membership.organisation_id
       and role_assignment.membership_id = membership.id
       and role_assignment.role = 'organisation_owner'
       and role_assignment.scope_type = 'organisation'
       and role_assignment.revoked_at is null
      where membership.organisation_id = target_session.organisation_id
        and membership.auth_user_id = target_session.owner_auth_user_id
        and membership.status = 'active'
    ) into owner_membership_exists;

    select exists (
      select 1 from public.organisation_sites site
      where site.organisation_id = target_session.organisation_id
        and site.active = true and site.archived_at is null
    ) into first_site_exists;

    select exists (
      select 1
      from public.organisation_settings organisation_setting
      where organisation_setting.organisation_id = target_session.organisation_id
    ) and exists (
      select 1
      from public.site_settings site_setting
      join public.organisation_sites site
        on site.organisation_id = site_setting.organisation_id
       and site.id = site_setting.site_id
      where site_setting.organisation_id = target_session.organisation_id
        and site.active = true and site.archived_at is null
    ) into settings_exist;

    select exists (
      select 1 from public.organisations organisation
      where organisation.id = target_session.organisation_id
        and organisation.status in ('trial', 'active', 'past_due')
        and organisation.archived_at is null
    ) into commercial_access_valid;
  end if;

  select exists (
    select 1
    from public.onboarding_command_receipts receipt
    where receipt.session_id = target_session.id
      and (excluded_receipt_id is null or receipt.id <> excluded_receipt_id)
      and (
        receipt.status in ('processing', 'failed_retryable')
        or receipt.result_outcome = 'indeterminate'
      )
  ) into command_unhealthy;

  items := jsonb_build_array(
    private.onboarding_foundation_readiness_item(
      'owner_identity', 'blocked', 'owner_identity_not_evaluated',
      'Owner identity verification is not complete.', '/onboarding/owner-account',
      'auth:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'legal_acceptance', 'blocked', 'legal_acceptance_not_evaluated',
      'Required legal acceptance is not complete.', '/onboarding/owner-account',
      'legal:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'organisation', case when organisation_exists then 'pass' else 'blocked' end,
      case when organisation_exists then 'organisation_present' else 'organisation_missing' end,
      case when organisation_exists then 'The organisation exists.' else 'Create the organisation.' end,
      case when organisation_exists then null else '/onboarding/organisation' end,
      'session:' || target_session.revision::text, evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'owner_membership', case when owner_membership_exists then 'pass' else 'blocked' end,
      case when owner_membership_exists then 'owner_membership_active' else 'owner_membership_missing' end,
      case when owner_membership_exists then 'The owner membership is active.' else 'Restore an active owner membership.' end,
      case when owner_membership_exists then null else '/onboarding/organisation' end,
      'membership:' || target_session.revision::text, evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'first_site', case when first_site_exists then 'pass' else 'blocked' end,
      case when first_site_exists then 'first_site_active' else 'first_site_missing' end,
      case when first_site_exists then 'An active site exists.' else 'Create an active first site.' end,
      case when first_site_exists then null else '/onboarding/first-site' end,
      'sites:' || target_session.revision::text, evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'operational_settings', case when settings_exist then 'pass' else 'blocked' end,
      case when settings_exist then 'operational_settings_present' else 'operational_settings_missing' end,
      case when settings_exist then 'Organisation and site settings exist.' else 'Complete organisation and site settings.' end,
      case when settings_exist then null else '/onboarding/settings' end,
      'settings:' || target_session.revision::text, evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'commercial_access', case when commercial_access_valid then 'pass' else 'blocked' end,
      case when commercial_access_valid then 'commercial_access_active' else 'commercial_access_unavailable' end,
      case when commercial_access_valid then 'Commercial access is active.' else 'Commercial access requires attention.' end,
      case when commercial_access_valid then null else '/onboarding/subscription' end,
      'organisation:' || target_session.revision::text, evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'attendance_policy', 'blocked', 'attendance_policy_not_evaluated',
      'Attendance policy readiness has not been evaluated.', '/onboarding/settings',
      'attendance_policy:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'pin_policy', 'blocked', 'pin_policy_not_evaluated',
      'PIN policy readiness has not been evaluated.', '/onboarding/settings',
      'pin_policy:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'eligible_staff', 'blocked', 'eligible_staff_not_evaluated',
      'Eligible staff readiness has not been evaluated.', '/onboarding/staff',
      'staff:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'online_kiosk', 'blocked', 'online_kiosk_not_evaluated',
      'Online kiosk readiness has not been evaluated.', '/onboarding/kiosk',
      'kiosk:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'kiosk_roster', 'blocked', 'kiosk_roster_not_evaluated',
      'Kiosk roster readiness has not been evaluated.', '/onboarding/kiosk',
      'kiosk_roster:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'offline_disabled', 'pass', 'offline_disabled',
      'Offline attendance is disabled.', null,
      'commercial_offline_policy:1', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'security_health', 'blocked', 'security_health_not_evaluated',
      'Security health has not been evaluated.', '/onboarding/readiness',
      'security:foundation', evaluated_at
    ),
    private.onboarding_foundation_readiness_item(
      'command_health', case when command_unhealthy then 'blocked' else 'pass' end,
      case when command_unhealthy then 'command_state_indeterminate' else 'command_health_clear' end,
      case when command_unhealthy
        then 'A command result requires reconciliation.'
        else 'No unresolved onboarding command requires reconciliation.' end,
      case when command_unhealthy then '/onboarding/readiness' else null end,
      'receipts:' || target_session.revision::text, evaluated_at
    )
  );

  overall_status := case
    when command_unhealthy then 'needs_attention'
    else 'in_progress'
  end;

  return jsonb_build_object(
    'schemaVersion', 1,
    'workflowKey', 'commercial_customer_v1',
    'workflowVersion', 1,
    'evaluatorVersion', 1,
    'sessionId', target_session.id,
    'organisationId', target_session.organisation_id,
    'overallStatus', overall_status,
    'workflowRevision', target_session.revision::text,
    'items', items,
    'evaluatedAt', evaluated_at
  );
end;
$$;

create or replace function private.onboarding_command_response(
  command_envelope jsonb,
  command_outcome text,
  data_state text,
  result_code text,
  result_reference jsonb,
  session_revision bigint,
  issues jsonb,
  readiness jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'commandResult', jsonb_build_object(
      'schemaVersion', 1,
      'workflowKey', 'commercial_customer_v1',
      'workflowVersion', 1,
      'sessionId', command_envelope ->> 'sessionId',
      'commandType', command_envelope ->> 'commandType',
      'outcome', command_outcome,
      'dataState', data_state,
      'resultCode', result_code,
      'resultReference', coalesce(result_reference, '{}'::jsonb),
      'sessionRevision', session_revision::text,
      'issues', coalesce(issues, '[]'::jsonb)
    ),
    'readiness', readiness
  )
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
     and new.result_outcome is not distinct from old.result_outcome
     and new.result_data_state is not distinct from old.result_data_state
     and new.result_session_revision is not distinct from old.result_session_revision
     and new.result_issues is not distinct from old.result_issues
     and new.result_readiness is not distinct from old.result_readiness
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

create or replace function public.execute_onboarding_foundation_command(command_envelope jsonb)
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
  existing_step public.onboarding_step_states%rowtype;
  actor_membership_id_value uuid;
  command_type_value text;
  request_hash_value text;
  idempotency_key_value uuid;
  expected_session_revision_value bigint;
  expected_step_revision_value bigint;
  step_key_value text;
  command_payload_value jsonb;
  readiness_value jsonb;
  issues_value jsonb := '[]'::jsonb;
  result_value jsonb;
  session_status_value text := 'in_progress';
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if command_envelope is null or jsonb_typeof(command_envelope) <> 'object'
     or (select count(*) from jsonb_object_keys(command_envelope)) <> 8
     or exists (
       select 1 from jsonb_object_keys(command_envelope) key
       where key not in (
         'schemaVersion', 'workflowKey', 'workflowVersion', 'sessionId',
         'commandType', 'idempotencyKey', 'expectedSessionRevision', 'payload'
       )
     )
     or command_envelope ->> 'schemaVersion' <> '1'
     or command_envelope ->> 'workflowKey' <> 'commercial_customer_v1'
     or command_envelope ->> 'workflowVersion' <> '1'
     or jsonb_typeof(command_envelope -> 'payload') <> 'object'
     or private.onboarding_json_has_sensitive_key(command_envelope -> 'payload')
     or not ((command_envelope ->> 'sessionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or not ((command_envelope ->> 'idempotencyKey') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
     or not ((command_envelope ->> 'expectedSessionRevision') ~ '^(0|[1-9][0-9]*)$') then
    raise exception 'invalid onboarding command envelope' using errcode = '22023';
  end if;

  command_type_value := command_envelope ->> 'commandType';
  if command_type_value not in (
    'save_step_draft', 'complete_owner_setup', 'create_organisation',
    'create_first_site', 'select_plan', 'save_settings', 'create_staff',
    'preview_staff_import', 'commit_staff_import', 'create_manager_invitations',
    'create_staff_invitations', 'start_kiosk_registration',
    'confirm_kiosk_connection', 'evaluate_readiness', 'go_live'
  ) then
    raise exception 'unsupported onboarding command type' using errcode = '22023';
  end if;

  idempotency_key_value := (command_envelope ->> 'idempotencyKey')::uuid;
  expected_session_revision_value := (command_envelope ->> 'expectedSessionRevision')::bigint;
  command_payload_value := command_envelope -> 'payload';
  request_hash_value := private.onboarding_request_digest(command_envelope);

  select session.* into target_session
  from public.onboarding_sessions session
  where session.id = (command_envelope ->> 'sessionId')::uuid
  for update;

  if not found
     or (target_session.organisation_id is null and target_session.owner_auth_user_id <> current_user_id)
     or (target_session.organisation_id is not null
       and not private.has_permission(target_session.organisation_id, 'onboarding.manage')) then
    return private.onboarding_command_response(
      command_envelope, 'permission_denied', 'not_saved', 'permission_denied',
      '{}'::jsonb, expected_session_revision_value, jsonb_build_array(jsonb_build_object(
        'code', 'permission_denied',
        'message', 'This onboarding command is not available.',
        'fieldPath', jsonb_build_array(),
        'repairRoute', null
      )), null
    );
  end if;

  if target_session.organisation_id is not null then
    select membership.id into actor_membership_id_value
    from public.organisation_memberships membership
    where membership.organisation_id = target_session.organisation_id
      and membership.auth_user_id = current_user_id
      and membership.status = 'active'
    limit 1;
  end if;

  select receipt.* into existing_receipt
  from public.onboarding_command_receipts receipt
  where receipt.session_id = target_session.id
    and receipt.command_type = command_type_value
    and receipt.idempotency_key = idempotency_key_value;

  if found then
    if existing_receipt.request_hash <> request_hash_value then
      readiness_value := private.onboarding_foundation_readiness(target_session.id, null);
      return private.onboarding_command_response(
        command_envelope, 'validation_failed', 'not_saved', 'idempotency_key_reused',
        '{}'::jsonb, target_session.revision, jsonb_build_array(jsonb_build_object(
          'code', 'idempotency_key_reused',
          'message', 'This request key was already used for different onboarding data.',
          'fieldPath', jsonb_build_array('idempotencyKey'),
          'repairRoute', null
        )), readiness_value
      );
    end if;

    if existing_receipt.status = 'succeeded' then
      return private.onboarding_command_response(
        command_envelope, 'replayed', 'saved', existing_receipt.result_code,
        existing_receipt.result_reference, existing_receipt.result_session_revision,
        existing_receipt.result_issues, coalesce(
          existing_receipt.result_readiness,
          private.onboarding_foundation_readiness(target_session.id, existing_receipt.id)
        )
      );
    elsif existing_receipt.status = 'failed_final' then
      return private.onboarding_command_response(
        command_envelope, coalesce(existing_receipt.result_outcome, 'indeterminate'),
        coalesce(existing_receipt.result_data_state, 'unknown'),
        coalesce(existing_receipt.result_code, 'command_state_indeterminate'),
        existing_receipt.result_reference,
        coalesce(existing_receipt.result_session_revision, target_session.revision),
        coalesce(existing_receipt.result_issues, '[]'::jsonb),
        coalesce(existing_receipt.result_readiness,
          private.onboarding_foundation_readiness(target_session.id, existing_receipt.id))
      );
    else
      readiness_value := private.onboarding_foundation_readiness(target_session.id, null);
      return private.onboarding_command_response(
        command_envelope, 'indeterminate', 'unknown', 'command_in_progress',
        '{}'::jsonb, target_session.revision, jsonb_build_array(jsonb_build_object(
          'code', 'reconciliation_required',
          'message', 'This onboarding command is still being reconciled.',
          'fieldPath', jsonb_build_array(),
          'repairRoute', '/onboarding/readiness'
        )), readiness_value
      );
    end if;
  end if;

  insert into public.onboarding_command_receipts (
    session_id, organisation_id, command_type, idempotency_key, request_hash, status
  ) values (
    target_session.id, target_session.organisation_id, command_type_value,
    idempotency_key_value, request_hash_value, 'processing'
  ) returning * into command_receipt;

  if target_session.revision <> expected_session_revision_value then
    readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
    issues_value := jsonb_build_array(jsonb_build_object(
      'code', 'stale_session_revision',
      'message', 'Onboarding changed after this request was prepared. Reload and try again.',
      'fieldPath', jsonb_build_array('expectedSessionRevision'),
      'repairRoute', null
    ));
    update public.onboarding_command_receipts
    set status = 'failed_final', result_code = 'stale_session_revision',
        result_outcome = 'workflow_changed', result_data_state = 'not_saved',
        result_session_revision = target_session.revision,
        result_issues = issues_value, result_readiness = readiness_value, completed_at = now()
    where id = command_receipt.id;
    return private.onboarding_command_response(
      command_envelope, 'workflow_changed', 'not_saved', 'stale_session_revision',
      '{}'::jsonb, target_session.revision, issues_value, readiness_value
    );
  end if;

  if command_type_value not in ('save_step_draft', 'evaluate_readiness') then
    readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
    issues_value := jsonb_build_array(jsonb_build_object(
      'code', 'command_not_available_in_foundation',
      'message', 'This onboarding command belongs to a later implementation phase.',
      'fieldPath', jsonb_build_array('commandType'),
      'repairRoute', null
    ));
    update public.onboarding_command_receipts
    set status = 'failed_final', result_code = 'command_not_available_in_foundation',
        result_outcome = 'capability_denied', result_data_state = 'not_saved',
        result_session_revision = target_session.revision,
        result_issues = issues_value, result_readiness = readiness_value, completed_at = now()
    where id = command_receipt.id;
    return private.onboarding_command_response(
      command_envelope, 'capability_denied', 'not_saved', 'command_not_available_in_foundation',
      '{}'::jsonb, target_session.revision, issues_value, readiness_value
    );
  end if;

  if command_type_value = 'save_step_draft' then
    if (select count(*) from jsonb_object_keys(command_payload_value)) <> 4
       or exists (
         select 1 from jsonb_object_keys(command_payload_value) key
         where key not in ('stepKey', 'expectedStepRevision', 'draftPayload', 'validationSummary')
       )
       or not ((command_payload_value ->> 'expectedStepRevision') ~ '^(0|[1-9][0-9]*)$')
       or jsonb_typeof(command_payload_value -> 'draftPayload') <> 'object'
       or private.onboarding_json_has_sensitive_key(command_payload_value -> 'draftPayload')
       or not private.onboarding_validation_summary_is_valid(command_payload_value -> 'validationSummary') then
      readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
      issues_value := jsonb_build_array(jsonb_build_object(
        'code', 'invalid_command_payload',
        'message', 'The onboarding draft is invalid.',
        'fieldPath', jsonb_build_array('payload'),
        'repairRoute', null
      ));
      update public.onboarding_command_receipts
      set status = 'failed_final', result_code = 'invalid_command_payload',
          result_outcome = 'validation_failed', result_data_state = 'not_saved',
          result_session_revision = target_session.revision,
          result_issues = issues_value, result_readiness = readiness_value, completed_at = now()
      where id = command_receipt.id;
      return private.onboarding_command_response(
        command_envelope, 'validation_failed', 'not_saved', 'invalid_command_payload',
        '{}'::jsonb, target_session.revision, issues_value, readiness_value
      );
    end if;

    step_key_value := command_payload_value ->> 'stepKey';
    if step_key_value not in (
      'owner_account', 'organisation', 'first_site', 'subscription', 'settings',
      'staff', 'manager_invitations', 'staff_invitations', 'kiosk',
      'initial_rota', 'readiness', 'go_live'
    ) then
      raise exception 'invalid onboarding step key' using errcode = '22023';
    end if;
    expected_step_revision_value := (command_payload_value ->> 'expectedStepRevision')::bigint;

    select step.* into existing_step
    from public.onboarding_step_states step
    where step.session_id = target_session.id and step.step_key = step_key_value
    for update;

    if (found and existing_step.revision <> expected_step_revision_value)
       or (not found and expected_step_revision_value <> 0) then
      readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
      issues_value := jsonb_build_array(jsonb_build_object(
        'code', 'stale_step_revision',
        'message', 'This onboarding step changed elsewhere. Reload and try again.',
        'fieldPath', jsonb_build_array('payload', 'expectedStepRevision'),
        'repairRoute', null
      ));
      update public.onboarding_command_receipts
      set status = 'failed_final', result_code = 'stale_step_revision',
          result_outcome = 'workflow_changed', result_data_state = 'not_saved',
          result_session_revision = target_session.revision,
          result_issues = issues_value, result_readiness = readiness_value, completed_at = now()
      where id = command_receipt.id;
      return private.onboarding_command_response(
        command_envelope, 'workflow_changed', 'not_saved', 'stale_step_revision',
        '{}'::jsonb, target_session.revision, issues_value, readiness_value
      );
    end if;

    if found then
      update public.onboarding_step_states
      set status = 'in_progress', revision = revision + 1,
          draft_payload = command_payload_value -> 'draftPayload',
          validation_summary = command_payload_value -> 'validationSummary',
          started_at = coalesce(started_at, now()), last_saved_at = now(),
          completed_at = null, completed_by_auth_user_id = null
      where id = existing_step.id;
    else
      insert into public.onboarding_step_states (
        session_id, organisation_id, step_key, step_version, status, revision,
        draft_payload, validation_summary, started_at, last_saved_at
      ) values (
        target_session.id, target_session.organisation_id, step_key_value, 1, 'in_progress', 0,
        command_payload_value -> 'draftPayload', command_payload_value -> 'validationSummary', now(), now()
      );
    end if;
  end if;

  select case when exists (
    select 1 from public.onboarding_command_receipts receipt
    where receipt.session_id = target_session.id
      and receipt.id <> command_receipt.id
      and (receipt.status in ('processing', 'failed_retryable') or receipt.result_outcome = 'indeterminate')
  ) then 'needs_attention' else 'in_progress' end into session_status_value;

  update public.onboarding_sessions
  set status = session_status_value,
      current_step_key = case when command_type_value = 'evaluate_readiness' then 'readiness' else step_key_value end,
      revision = revision + 1,
      last_activity_at = now()
  where id = target_session.id
  returning * into target_session;

  readiness_value := private.onboarding_foundation_readiness(target_session.id, command_receipt.id);
  update public.onboarding_command_receipts
  set status = 'succeeded',
      result_code = case when command_type_value = 'evaluate_readiness' then 'readiness_evaluated' else 'step_draft_saved' end,
      result_outcome = 'succeeded', result_data_state = 'saved',
      result_session_revision = target_session.revision,
      result_issues = '[]'::jsonb, result_readiness = readiness_value,
      completed_at = now()
  where id = command_receipt.id;

  insert into public.onboarding_events (
    session_id, organisation_id, event_type, step_key, actor_type,
    actor_auth_user_id, actor_membership_id, request_id,
    workflow_revision, safe_metadata
  ) values (
    target_session.id, target_session.organisation_id, 'readiness_evaluated',
    case when command_type_value = 'save_step_draft' then step_key_value else 'readiness' end,
    case when target_session.owner_auth_user_id = current_user_id then 'owner' else 'member' end,
    current_user_id, actor_membership_id_value, idempotency_key_value,
    target_session.revision,
    jsonb_build_object(
      'statusCode', readiness_value ->> 'overallStatus',
      'resultCodes', jsonb_build_array(
        case when readiness_value ->> 'overallStatus' = 'ready' then 'readiness_ready' else 'readiness_blocked' end
      )
    )
  );

  result_value := private.onboarding_command_response(
    command_envelope, 'succeeded', 'saved',
    case when command_type_value = 'evaluate_readiness' then 'readiness_evaluated' else 'step_draft_saved' end,
    '{}'::jsonb, target_session.revision, '[]'::jsonb, readiness_value
  );
  return result_value;
end;
$$;

revoke all on function private.onboarding_request_digest(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.onboarding_foundation_readiness_item(text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.onboarding_foundation_readiness(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.onboarding_command_response(jsonb, text, text, text, jsonb, bigint, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.execute_onboarding_foundation_command(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.execute_onboarding_foundation_command(jsonb) to authenticated;
