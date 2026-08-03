alter table public.kiosk_devices
  add column if not exists nursery_context text not null default 'jan-preschool',
  add column if not exists offline_enabled boolean not null default false,
  add column if not exists hardware_verified_at timestamptz,
  add column if not exists offline_schema_version integer not null default 1
    check (offline_schema_version > 0),
  add column if not exists reprovision_required boolean not null default false;

create table public.kiosk_offline_authorisations (
  id uuid primary key default gen_random_uuid(),
  kiosk_device_id uuid not null references public.kiosk_devices(id) on delete restrict,
  nursery_context text not null,
  roster_version text not null check (length(roster_version) between 16 and 128),
  schema_version integer not null check (schema_version > 0),
  app_version text not null check (length(trim(app_version)) between 1 and 40),
  signing_public_jwk jsonb not null,
  authorised_staff_ids text[] not null,
  authorised_staff_versions jsonb not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  device_time_at_issue timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint kiosk_offline_authorisation_lifetime check (
    expires_at > issued_at and expires_at <= issued_at + interval '24 hours'
  ),
  constraint kiosk_offline_authorisation_revocation check (
    (revoked_at is null and revocation_reason is null)
    or (revoked_at is not null and length(trim(revocation_reason)) >= 5)
  ),
  constraint kiosk_offline_signing_key_shape check (
    signing_public_jwk ->> 'kty' = 'EC'
    and signing_public_jwk ->> 'crv' = 'P-256'
    and length(signing_public_jwk ->> 'x') = 43
    and length(signing_public_jwk ->> 'y') = 43
  )
);

create unique index kiosk_offline_authorisations_one_active_idx
on public.kiosk_offline_authorisations (kiosk_device_id)
where revoked_at is null;

create index kiosk_offline_authorisations_expiry_idx
on public.kiosk_offline_authorisations (expires_at)
where revoked_at is null;

create table public.kiosk_sync_health (
  kiosk_device_id uuid primary key references public.kiosk_devices(id) on delete restrict,
  last_contact_at timestamptz,
  last_roster_refresh_at timestamptz,
  offline_authorisation_expires_at timestamptz,
  roster_version text,
  app_version text,
  schema_version integer,
  last_clock_drift_seconds integer,
  last_successful_sync_at timestamptz,
  last_sync_failure_at timestamptz,
  last_sync_failure_category text,
  last_reported_pending_count integer not null default 0
    check (last_reported_pending_count >= 0),
  oldest_pending_action_at timestamptz,
  last_health_report_at timestamptz,
  storage_persisted boolean,
  storage_estimate_bytes bigint,
  updated_at timestamptz not null default now(),
  constraint kiosk_sync_health_pending_details check (
    (last_reported_pending_count = 0 and oldest_pending_action_at is null)
    or (last_reported_pending_count > 0 and oldest_pending_action_at is not null)
  )
);

create index kiosk_sync_health_contact_idx
on public.kiosk_sync_health (last_contact_at, last_reported_pending_count);

create or replace function public.revoke_kiosk_offline_authorisation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.active and not new.active)
    or (not old.reprovision_required and new.reprovision_required) then
    update public.kiosk_offline_authorisations
    set revoked_at = coalesce(revoked_at, clock_timestamp()),
        revocation_reason = coalesce(revocation_reason, case
          when not new.active then 'Kiosk device revoked by manager'
          else 'Kiosk reprovision required by manager'
        end)
    where kiosk_device_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger kiosk_devices_revoke_offline_authorisation
after update of active, reprovision_required on public.kiosk_devices
for each row execute function public.revoke_kiosk_offline_authorisation();

revoke all on function public.revoke_kiosk_offline_authorisation()
from public, anon, authenticated;

create table public.kiosk_offline_rate_limits (
  kiosk_device_id uuid not null references public.kiosk_devices(id) on delete restrict,
  operation text not null check (operation in (
    'provision', 'sync', 'invalid_signature', 'health', 'reprovision'
  )),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  primary key (kiosk_device_id, operation)
);

alter table public.kiosk_offline_authorisations enable row level security;
alter table public.kiosk_sync_health enable row level security;
alter table public.kiosk_offline_rate_limits enable row level security;

create policy "Managers can read offline kiosk authorisations"
on public.kiosk_offline_authorisations for select to authenticated
using (public.current_staff_role() = 'manager');

create policy "Managers can read kiosk sync health"
on public.kiosk_sync_health for select to authenticated
using (public.current_staff_role() = 'manager');

revoke all on public.kiosk_offline_authorisations from public, anon, authenticated;
revoke all on public.kiosk_sync_health from public, anon, authenticated;
revoke all on public.kiosk_offline_rate_limits from public, anon, authenticated;
grant select on public.kiosk_offline_authorisations to authenticated;
grant select on public.kiosk_sync_health to authenticated;
grant select, insert, update on public.kiosk_offline_authorisations to service_role;
grant select, insert, update on public.kiosk_sync_health to service_role;
grant select, insert, update on public.kiosk_offline_rate_limits to service_role;

alter table public.attendance_action_requests
  add column if not exists roster_version text,
  add column if not exists payload_digest text,
  add column if not exists payload_schema_version integer,
  add column if not exists device_timezone text,
  add column if not exists operational_date_at_device date,
  add column if not exists queue_created_at timestamptz,
  add column if not exists processed_at_server timestamptz,
  add column if not exists accepted_attendance_at timestamptz,
  add column if not exists clock_drift_seconds integer,
  add column if not exists signature_verified boolean;

create unique index attendance_action_requests_authorisation_sequence_idx
on public.attendance_action_requests (offline_authorisation_id, device_sequence)
where offline_authorisation_id is not null and device_sequence is not null;

create index attendance_action_requests_offline_outcome_idx
on public.attendance_action_requests (result_code, received_at_server desc)
where offline_authorisation_id is not null;

alter table public.clock_events
  add column if not exists offline_authorisation_id uuid
    references public.kiosk_offline_authorisations(id) on delete restrict,
  add column if not exists offline_device_sequence bigint,
  add column if not exists occurred_at_device timestamptz,
  add column if not exists received_at_server timestamptz,
  add column if not exists processed_at_server timestamptz,
  add column if not exists device_timezone text,
  add column if not exists clock_drift_seconds integer,
  add column if not exists offline_warning boolean not null default false;

create unique index clock_events_offline_authorisation_sequence_idx
on public.clock_events (offline_authorisation_id, offline_device_sequence)
where offline_authorisation_id is not null;

alter table public.attendance_exceptions
  add column if not exists kiosk_device_id uuid
    references public.kiosk_devices(id) on delete restrict,
  add column if not exists offline_authorisation_id uuid
    references public.kiosk_offline_authorisations(id) on delete restrict,
  add column if not exists requested_action text,
  add column if not exists device_occurrence_at timestamptz,
  add column if not exists server_receipt_at timestamptz,
  add column if not exists device_sequence bigint,
  add column if not exists trusted_state jsonb,
  add column if not exists authoritative_state jsonb,
  add column if not exists conflict_type text,
  add column if not exists operation_id uuid,
  add column if not exists payload_digest text,
  add column if not exists clock_drift_seconds integer;

create index attendance_exceptions_offline_device_idx
on public.attendance_exceptions (kiosk_device_id, status, operational_date desc)
where source = 'offline_sync';

create or replace function public.check_kiosk_offline_rate_limit(
  candidate_token text,
  requested_operation text,
  maximum_attempts integer,
  window_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_id uuid;
  limit_row public.kiosk_offline_rate_limits%rowtype;
begin
  if candidate_token is null or length(candidate_token) < 32
    or requested_operation not in ('provision', 'sync', 'invalid_signature', 'health', 'reprovision')
    or maximum_attempts < 1 or window_seconds < 1 then
    raise exception using errcode = '22023', message = 'Invalid offline kiosk rate-limit request';
  end if;

  select device.id into device_id
  from public.kiosk_devices device
  where device.token_hash = extensions.digest(candidate_token, 'sha256');
  if device_id is null then
    raise exception using errcode = '42501', message = 'Kiosk device access required';
  end if;

  select * into limit_row
  from public.kiosk_offline_rate_limits rate_limit
  where rate_limit.kiosk_device_id = device_id
    and rate_limit.operation = requested_operation
  for update;

  if not found or limit_row.window_started_at <= now() - make_interval(secs => window_seconds) then
    insert into public.kiosk_offline_rate_limits (
      kiosk_device_id, operation, window_started_at, attempt_count
    ) values (device_id, requested_operation, now(), 1)
    on conflict (kiosk_device_id, operation) do update set
      window_started_at = excluded.window_started_at,
      attempt_count = 1;
  elsif limit_row.attempt_count >= maximum_attempts then
    raise exception using errcode = '54000', message = 'Offline kiosk request rate limit exceeded';
  else
    update public.kiosk_offline_rate_limits set attempt_count = attempt_count + 1
    where kiosk_device_id = device_id and operation = requested_operation;
  end if;
  return device_id;
end;
$$;

create or replace function public.provision_offline_kiosk(
  device_token text,
  client_schema_version integer,
  client_app_version text,
  client_device_time timestamptz,
  signing_public_jwk jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.kiosk_devices%rowtype;
  authorisation_id uuid;
  issued_at_value timestamptz := clock_timestamp();
  expires_at_value timestamptz;
  roster_version_value text;
  authorised_staff_ids_value text[];
  authorised_staff_versions_value jsonb;
  roster_value jsonb;
begin
  perform public.check_kiosk_offline_rate_limit(device_token, 'provision', 10, 900);
  select * into device
  from public.kiosk_devices candidate
  where candidate.token_hash = extensions.digest(device_token, 'sha256');

  if not found or not device.active or device.expires_at <= issued_at_value then
    return jsonb_build_object('ok', false, 'code', 'device_revoked');
  end if;
  if not device.offline_enabled then
    return jsonb_build_object('ok', false, 'code', 'feature_disabled');
  end if;
  if device.hardware_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'hardware_unverified');
  end if;
  if device.reprovision_required then
    return jsonb_build_object('ok', false, 'code', 'reprovision_required');
  end if;
  if client_schema_version is distinct from device.offline_schema_version then
    return jsonb_build_object(
      'ok', false, 'code', 'schema_incompatible',
      'acceptedSchemaVersion', device.offline_schema_version
    );
  end if;
  if nullif(trim(client_app_version), '') is null or length(client_app_version) > 40
    or client_device_time is null
    or abs(extract(epoch from (client_device_time - issued_at_value))) > 300
    or signing_public_jwk ->> 'kty' is distinct from 'EC'
    or signing_public_jwk ->> 'crv' is distinct from 'P-256'
    or length(signing_public_jwk ->> 'x') <> 43
    or length(signing_public_jwk ->> 'y') <> 43 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select
    encode(extensions.digest(coalesce(string_agg(
      profile.id || ':' || coalesce(settings.pin_updated_at::text, 'none') || ':' ||
      settings.kiosk_enabled::text || ':' || settings.pin_reset_required::text,
      '|' order by profile.id
    ), ''), 'sha256'), 'hex'),
    coalesce(array_agg(profile.id order by profile.id), '{}'::text[]),
    coalesce(jsonb_object_agg(
      profile.id,
      encode(extensions.digest(
        profile.id || ':' || coalesce(settings.pin_updated_at::text, 'none'), 'sha256'
      ), 'hex')
    ), '{}'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'staffId', profile.id,
      'displayName', profile.display_name,
      'employmentRole', profile.employment_role,
      'pinVersion', encode(extensions.digest(
        profile.id || ':' || coalesce(settings.pin_updated_at::text, 'none'), 'sha256'
      ), 'hex'),
      'trustedState', public.get_attendance_state(profile.id, issued_at_value)
    ) order by profile.display_name, profile.id), '[]'::jsonb)
  into roster_version_value, authorised_staff_ids_value,
    authorised_staff_versions_value, roster_value
  from public.staff_profiles profile
  join public.staff_kiosk_settings settings on settings.staff_id = profile.id
  where profile.active = true
    and settings.kiosk_enabled = true
    and settings.pin_updated_at is not null
    and settings.pin_reset_required = false;

  update public.kiosk_offline_authorisations set
    revoked_at = issued_at_value,
    revocation_reason = 'Rotated by online provisioning'
  where kiosk_device_id = device.id and revoked_at is null;

  expires_at_value := issued_at_value + interval '24 hours';
  insert into public.kiosk_offline_authorisations (
    kiosk_device_id, nursery_context, roster_version, schema_version,
    app_version, signing_public_jwk, authorised_staff_ids,
    authorised_staff_versions, issued_at,
    expires_at, device_time_at_issue
  ) values (
    device.id, device.nursery_context, roster_version_value,
    client_schema_version, trim(client_app_version), signing_public_jwk,
    authorised_staff_ids_value, authorised_staff_versions_value,
    issued_at_value, expires_at_value,
    client_device_time
  ) returning id into authorisation_id;

  insert into public.kiosk_sync_health (
    kiosk_device_id, last_contact_at, last_roster_refresh_at,
    offline_authorisation_expires_at, roster_version, app_version,
    schema_version, updated_at
  ) values (
    device.id, issued_at_value, issued_at_value, expires_at_value,
    roster_version_value, trim(client_app_version), client_schema_version,
    issued_at_value
  ) on conflict (kiosk_device_id) do update set
    last_contact_at = excluded.last_contact_at,
    last_roster_refresh_at = excluded.last_roster_refresh_at,
    offline_authorisation_expires_at = excluded.offline_authorisation_expires_at,
    roster_version = excluded.roster_version,
    app_version = excluded.app_version,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at;

  update public.kiosk_devices set last_used_at = issued_at_value
  where id = device.id;

  return jsonb_build_object(
    'ok', true,
    'package', jsonb_build_object(
      'schemaVersion', client_schema_version,
      'featureEnabled', true,
      'device', jsonb_build_object('id', device.id, 'name', device.device_name),
      'authorisation', jsonb_build_object(
        'id', authorisation_id,
        'issuedAt', issued_at_value,
        'expiresAt', expires_at_value,
        'rosterVersion', roster_version_value
      ),
      'server', jsonb_build_object(
        'time', issued_at_value,
        'timezone', 'Europe/London',
        'operationalDayStart', '00:00'
      ),
      'roster', roster_value
    )
  );
end;
$$;

revoke all on function public.check_kiosk_offline_rate_limit(text, text, integer, integer)
from public, anon, authenticated;
revoke all on function public.provision_offline_kiosk(text, integer, text, timestamptz, jsonb)
from public, anon, authenticated;
grant execute on function public.check_kiosk_offline_rate_limit(text, text, integer, integer)
to service_role;
grant execute on function public.provision_offline_kiosk(text, integer, text, timestamptz, jsonb)
to service_role;

create or replace function public.get_offline_kiosk_sync_context(
  device_token text,
  target_authorisation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row record;
begin
  if device_token is null or length(device_token) < 32 or target_authorisation_id is null then
    raise exception using errcode = '42501', message = 'Kiosk device access required';
  end if;
  select device.id as device_id, authorisation.signing_public_jwk
  into context_row
  from public.kiosk_devices device
  join public.kiosk_offline_authorisations authorisation
    on authorisation.kiosk_device_id = device.id
  where device.token_hash = extensions.digest(device_token, 'sha256')
    and authorisation.id = target_authorisation_id;
  if not found then
    raise exception using errcode = '42501', message = 'Kiosk authorisation required';
  end if;
  return jsonb_build_object(
    'ok', true,
    'deviceId', context_row.device_id,
    'signingPublicJwk', context_row.signing_public_jwk
  );
end;
$$;

create or replace function public.perform_offline_kiosk_attendance_action(
  device_token text,
  target_authorisation_id uuid,
  target_staff_id text,
  requested_action text,
  expected_revision text,
  idempotency_key uuid,
  device_sequence bigint,
  occurred_at_device timestamptz,
  device_timezone text,
  operational_date_at_device date,
  queue_created_at timestamptz,
  roster_version text,
  prior_pending_action_id uuid,
  clock_confidence text,
  elapsed_since_authorisation_ms bigint,
  payload_digest text,
  signature_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  received_at_value timestamptz := clock_timestamp();
  device public.kiosk_devices%rowtype;
  authorisation public.kiosk_offline_authorisations%rowtype;
  existing_request public.attendance_action_requests%rowtype;
  prior_request public.attendance_action_requests%rowtype;
  current_state jsonb;
  trusted_state_value jsonb;
  response_value jsonb;
  outcome_value text;
  local_receipt_outcome text;
  resulting_event_id uuid;
  resulting_event_at timestamptz;
  clock_drift_value integer;
  current_pin_version text;
  expected_transition_state text;
  create_exception boolean := false;
  exception_type_value text := 'offline_sync_conflict';
  existing_sequence uuid;
  chained_revision_matches boolean := false;
  stored_device_sequence bigint;
begin
  perform public.check_kiosk_offline_rate_limit(device_token, 'sync', 240, 900);
  select * into device
  from public.kiosk_devices candidate
  where candidate.token_hash = extensions.digest(device_token, 'sha256');
  if not found then
    raise exception using errcode = '42501', message = 'Kiosk device access required';
  end if;

  select * into authorisation
  from public.kiosk_offline_authorisations candidate
  where candidate.id = target_authorisation_id
    and candidate.kiosk_device_id = device.id;
  if not found then
    raise exception using errcode = '42501', message = 'Kiosk authorisation required';
  end if;
  if nullif(trim(target_staff_id), '') is null or idempotency_key is null then
    raise exception using errcode = '22023', message = 'Invalid offline attendance identity';
  end if;

  perform public.lock_attendance_staff_writes(target_staff_id);
  select * into existing_request
  from public.attendance_action_requests request
  where request.idempotency_key = perform_offline_kiosk_attendance_action.idempotency_key;
  if found then
    if existing_request.offline_authorisation_id = target_authorisation_id
      and existing_request.kiosk_device_id = device.id
      and existing_request.staff_id = target_staff_id
      and existing_request.action = requested_action
      and existing_request.payload_digest = payload_digest then
      return existing_request.safe_response;
    end if;
    raise exception using errcode = '23505', message = 'Idempotency UUID payload mismatch';
  end if;

  current_state := public.get_attendance_state(target_staff_id, received_at_value);
  trusted_state_value := jsonb_build_object(
    'staffId', target_staff_id,
    'rosterVersion', authorisation.roster_version,
    'state', current_state,
    'trustedAt', received_at_value
  );

  select request.idempotency_key into existing_sequence
  from public.attendance_action_requests request
  where request.offline_authorisation_id = target_authorisation_id
    and request.device_sequence = perform_offline_kiosk_attendance_action.device_sequence;

  if prior_pending_action_id is not null then
    select * into prior_request
    from public.attendance_action_requests request
    where request.idempotency_key = prior_pending_action_id;
    chained_revision_matches := found
      and prior_request.offline_authorisation_id = target_authorisation_id
      and prior_request.kiosk_device_id = device.id
      and prior_request.staff_id = target_staff_id
      and prior_request.device_sequence < device_sequence
      and prior_request.result_code in ('accepted', 'accepted_with_warning', 'already_processed')
      and prior_request.safe_response -> 'trustedState' -> 'state' ->> 'revision'
        = current_state ->> 'revision';
  end if;

  select encode(extensions.digest(
    profile.id || ':' || coalesce(settings.pin_updated_at::text, 'none'), 'sha256'
  ), 'hex') into current_pin_version
  from public.staff_profiles profile
  join public.staff_kiosk_settings settings on settings.staff_id = profile.id
  where profile.id = target_staff_id
    and profile.active = true
    and settings.kiosk_enabled = true
    and settings.pin_updated_at is not null
    and settings.pin_reset_required = false;

  if not coalesce(signature_verified, false) then
    outcome_value := 'invalid_signature';
    local_receipt_outcome := 'rejected';
    create_exception := target_staff_id = any(authorisation.authorised_staff_ids);
  elsif requested_action not in ('clock_in', 'clock_out', 'start_new_shift')
    or device_sequence is null or device_sequence < 1
    or existing_sequence is not null
    or (prior_pending_action_id is not null and not chained_revision_matches) then
    outcome_value := 'invalid_sequence';
    local_receipt_outcome := 'conflicted';
    create_exception := true;
  elsif not device.active or device.revoked_at is not null or authorisation.revoked_at is not null then
    outcome_value := 'device_revoked';
    local_receipt_outcome := 'conflicted';
    create_exception := true;
  elsif authorisation.schema_version <> 1 then
    outcome_value := 'schema_incompatible';
    local_receipt_outcome := 'rejected';
  elsif target_staff_id <> all(authorisation.authorised_staff_ids)
    or current_pin_version is null then
    outcome_value := 'staff_not_authorised';
    local_receipt_outcome := 'conflicted';
    create_exception := true;
  elsif authorisation.authorised_staff_versions ->> target_staff_id
    is distinct from current_pin_version then
    outcome_value := 'roster_outdated';
    local_receipt_outcome := 'conflicted';
    create_exception := true;
  elsif roster_version is distinct from authorisation.roster_version then
    outcome_value := 'roster_outdated';
    local_receipt_outcome := 'rejected';
  elsif occurred_at_device < authorisation.issued_at - interval '5 minutes'
    or occurred_at_device > authorisation.expires_at
    or queue_created_at < occurred_at_device - interval '5 minutes' then
    outcome_value := 'authorisation_expired';
    local_receipt_outcome := 'conflicted';
    create_exception := true;
  elsif device_timezone is distinct from 'Europe/London'
    or public.attendance_operational_date(occurred_at_device)
      is distinct from operational_date_at_device then
    outcome_value := 'clock_drift_conflict';
    local_receipt_outcome := 'conflicted';
    create_exception := true;
    exception_type_value := 'device_clock_drift';
  else
    if clock_confidence = 'anchored' and elapsed_since_authorisation_ms is not null then
      clock_drift_value := abs(extract(epoch from (
        occurred_at_device - (
          authorisation.device_time_at_issue
          + make_interval(secs => elapsed_since_authorisation_ms::double precision / 1000.0)
        )
      )))::integer;
    else
      clock_drift_value := null;
    end if;

    if occurred_at_device > received_at_value + interval '5 minutes'
      or (clock_drift_value is not null and clock_drift_value > 900) then
      outcome_value := 'clock_drift_conflict';
      local_receipt_outcome := 'conflicted';
      create_exception := true;
      exception_type_value := 'device_clock_drift';
    else
      if clock_drift_value is null then
        outcome_value := 'accepted_with_warning';
        local_receipt_outcome := 'synced';
        create_exception := true;
        exception_type_value := 'offline_time_uncertain';
      elsif clock_drift_value > 300 then
        outcome_value := 'accepted_with_warning';
        local_receipt_outcome := 'synced';
        create_exception := true;
        exception_type_value := 'device_clock_drift';
      end if;

      if current_state ->> 'revision' is distinct from expected_revision
        and not chained_revision_matches then
        outcome_value := 'state_conflict';
        local_receipt_outcome := 'conflicted';
        create_exception := true;
        exception_type_value := 'offline_sync_conflict';
      else
        expected_transition_state := case requested_action
          when 'clock_in' then 'clocked_out'
          when 'clock_out' then 'clocked_in'
          when 'start_new_shift' then 'missing_clock_out'
        end;
        if current_state ->> 'state' is distinct from expected_transition_state then
          outcome_value := 'state_conflict';
          local_receipt_outcome := 'conflicted';
          create_exception := true;
          exception_type_value := 'offline_sync_conflict';
        else
          insert into public.clock_events (
            staff_id, event_type, event_timestamp, kiosk_device_id,
            offline_authorisation_id, offline_device_sequence,
            occurred_at_device, received_at_server, processed_at_server,
            device_timezone, clock_drift_seconds, offline_warning
          ) values (
            target_staff_id,
            case when requested_action = 'clock_out' then 'clock_out' else 'clock_in' end,
            occurred_at_device, device.id::text, target_authorisation_id,
            device_sequence, occurred_at_device, received_at_value,
            clock_timestamp(), device_timezone, clock_drift_value,
            coalesce(outcome_value = 'accepted_with_warning', false)
          ) returning id, event_timestamp into resulting_event_id, resulting_event_at;
          if outcome_value is null then outcome_value := 'accepted'; end if;
          local_receipt_outcome := 'synced';
          current_state := public.get_attendance_state(target_staff_id, received_at_value);
          trusted_state_value := jsonb_build_object(
            'staffId', target_staff_id,
            'rosterVersion', authorisation.roster_version,
            'state', current_state,
            'trustedAt', received_at_value
          );
        end if;
      end if;
    end if;
  end if;

  if create_exception then
    insert into public.attendance_exceptions (
      staff_id, operational_date, exception_type, anomaly_fingerprint,
      detection_revision, source, kiosk_device_id, offline_authorisation_id,
      requested_action, device_occurrence_at, server_receipt_at,
      device_sequence, trusted_state, authoritative_state, conflict_type,
      operation_id, payload_digest, clock_drift_seconds
    ) values (
      target_staff_id, operational_date_at_device, exception_type_value,
      encode(extensions.digest(
        outcome_value || ':' || idempotency_key::text, 'sha256'
      ), 'hex'),
      coalesce(current_state ->> 'revision', expected_revision), 'offline_sync',
      device.id, target_authorisation_id, requested_action,
      occurred_at_device, received_at_value, device_sequence,
      jsonb_build_object(
        'revision', expected_revision,
        'priorPendingActionId', prior_pending_action_id
      ), current_state, outcome_value, idempotency_key, payload_digest,
      clock_drift_value
    ) on conflict (staff_id, operational_date, exception_type, anomaly_fingerprint)
      where status in ('open', 'under_review') do nothing;
  end if;

  response_value := jsonb_build_object(
    'outcome', outcome_value,
    'receipt', jsonb_build_object(
      'schemaVersion', 1,
      'idempotencyKey', idempotency_key,
      'outcome', local_receipt_outcome,
      'receivedAtServer', received_at_value,
      'retainedUntil', received_at_value + interval '30 days'
    ),
    'trustedState', trusted_state_value
  );

  stored_device_sequence := case
    when existing_sequence is null then device_sequence
    else null
  end;

  insert into public.attendance_action_requests (
    idempotency_key, staff_id, kiosk_device_id, action, expected_revision,
    completed_at, result_code, resulting_state, resulting_event_id,
    safe_response, offline_authorisation_id, device_sequence,
    occurred_at_device, received_at_server, clock_confidence,
    roster_version, payload_digest, payload_schema_version, device_timezone,
    operational_date_at_device, queue_created_at, processed_at_server,
    accepted_attendance_at, clock_drift_seconds, signature_verified
  ) values (
    idempotency_key, target_staff_id, device.id, requested_action,
    expected_revision, clock_timestamp(), outcome_value,
    current_state ->> 'state', resulting_event_id, response_value,
    target_authorisation_id, stored_device_sequence, occurred_at_device,
    received_at_value, clock_confidence, roster_version, payload_digest, 1,
    device_timezone, operational_date_at_device, queue_created_at,
    clock_timestamp(), resulting_event_at, clock_drift_value,
    signature_verified
  );

  insert into public.kiosk_sync_health (
    kiosk_device_id, last_contact_at, last_clock_drift_seconds,
    last_successful_sync_at, last_sync_failure_at,
    last_sync_failure_category, updated_at
  ) values (
    device.id, received_at_value, clock_drift_value,
    case when local_receipt_outcome = 'synced' then received_at_value end,
    case when local_receipt_outcome <> 'synced' then received_at_value end,
    case when local_receipt_outcome <> 'synced' then outcome_value end,
    received_at_value
  ) on conflict (kiosk_device_id) do update set
    last_contact_at = excluded.last_contact_at,
    last_clock_drift_seconds = excluded.last_clock_drift_seconds,
    last_successful_sync_at = coalesce(
      excluded.last_successful_sync_at,
      public.kiosk_sync_health.last_successful_sync_at
    ),
    last_sync_failure_at = excluded.last_sync_failure_at,
    last_sync_failure_category = excluded.last_sync_failure_category,
    updated_at = excluded.updated_at;

  update public.kiosk_devices set last_used_at = received_at_value
  where id = device.id;
  return response_value;
end;
$$;

revoke all on function public.get_offline_kiosk_sync_context(text, uuid)
from public, anon, authenticated;
revoke all on function public.perform_offline_kiosk_attendance_action(
  text, uuid, text, text, text, uuid, bigint, timestamptz, text, date,
  timestamptz, text, uuid, text, bigint, text, boolean
) from public, anon, authenticated;
grant execute on function public.get_offline_kiosk_sync_context(text, uuid)
to service_role;
grant execute on function public.perform_offline_kiosk_attendance_action(
  text, uuid, text, text, text, uuid, bigint, timestamptz, text, date,
  timestamptz, text, uuid, text, bigint, text, boolean
) to service_role;

create or replace function public.get_kiosk_offline_health_context(
  device_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.kiosk_devices%rowtype;
  authorisation public.kiosk_offline_authorisations%rowtype;
begin
  select * into device from public.kiosk_devices candidate
  where candidate.token_hash = extensions.digest(device_token, 'sha256');
  if not found then
    raise exception using errcode = '42501', message = 'Kiosk device access required';
  end if;
  select * into authorisation
  from public.kiosk_offline_authorisations candidate
  where candidate.kiosk_device_id = device.id
  order by candidate.issued_at desc
  limit 1;
  return jsonb_build_object(
    'deviceId', device.id,
    'active', device.active,
    'revokedAt', device.revoked_at,
    'offlineEnabled', device.offline_enabled,
    'hardwareVerifiedAt', device.hardware_verified_at,
    'reprovisionRequired', device.reprovision_required,
    'acceptedSchemaVersion', device.offline_schema_version,
    'authorisation', case when authorisation.id is null then null else jsonb_build_object(
      'id', authorisation.id,
      'expiresAt', authorisation.expires_at,
      'revokedAt', authorisation.revoked_at,
      'rosterVersion', authorisation.roster_version
    ) end,
    'serverTime', clock_timestamp()
  );
end;
$$;

create or replace function public.report_kiosk_sync_health(
  device_token text,
  target_authorisation_id uuid,
  pending_count integer,
  oldest_pending_action_at timestamptz,
  storage_persisted boolean,
  storage_estimate_bytes bigint,
  client_app_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_id uuid;
begin
  device_id := public.check_kiosk_offline_rate_limit(device_token, 'health', 120, 900);
  if pending_count < 0 or pending_count > 10000
    or (pending_count = 0 and oldest_pending_action_at is not null)
    or (pending_count > 0 and oldest_pending_action_at is null)
    or storage_estimate_bytes < 0
    or length(client_app_version) not between 1 and 40
    or not exists (
      select 1 from public.kiosk_offline_authorisations authorisation
      where authorisation.id = target_authorisation_id
        and authorisation.kiosk_device_id = device_id
    ) then
    raise exception using errcode = '22023', message = 'Invalid kiosk health report';
  end if;
  insert into public.kiosk_sync_health (
    kiosk_device_id, last_contact_at, last_reported_pending_count,
    oldest_pending_action_at, last_health_report_at, storage_persisted,
    storage_estimate_bytes, app_version, updated_at
  ) values (
    device_id, clock_timestamp(), pending_count, oldest_pending_action_at,
    clock_timestamp(), storage_persisted, storage_estimate_bytes,
    client_app_version, clock_timestamp()
  ) on conflict (kiosk_device_id) do update set
    last_contact_at = excluded.last_contact_at,
    last_reported_pending_count = excluded.last_reported_pending_count,
    oldest_pending_action_at = excluded.oldest_pending_action_at,
    last_health_report_at = excluded.last_health_report_at,
    storage_persisted = excluded.storage_persisted,
    storage_estimate_bytes = excluded.storage_estimate_bytes,
    app_version = excluded.app_version,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.get_kiosk_offline_health_context(text)
from public, anon, authenticated;
revoke all on function public.report_kiosk_sync_health(
  text, uuid, integer, timestamptz, boolean, bigint, text
) from public, anon, authenticated;
grant execute on function public.get_kiosk_offline_health_context(text)
to service_role;
grant execute on function public.report_kiosk_sync_health(
  text, uuid, integer, timestamptz, boolean, bigint, text
) to service_role;
