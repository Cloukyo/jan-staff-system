begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;

do $$
declare
  test_staff_id constant text := 'sql-attendance-state-machine';
  manager_staff_id constant text := 'sql-attendance-manager';
  manager_user_id constant uuid := '00000000-0000-4000-8000-000000000401';
  manager_account_id constant uuid := '00000000-0000-4000-8000-000000000402';
  device_id constant uuid := '00000000-0000-4000-8000-000000000403';
  device_token constant text := 'sql-test-device-token-00000000000000000000000000000001';
  request_id constant uuid := '00000000-0000-4000-8000-000000000404';
  reused_request_id constant uuid := '00000000-0000-4000-8000-000000000405';
  evaluated_at timestamptz := clock_timestamp();
  yesterday_date date := public.attendance_operational_date(evaluated_at) - 1;
  yesterday_clock_in timestamptz :=
    (yesterday_date::timestamp + time '08:30') at time zone 'Europe/London';
  yesterday_clock_out timestamptz :=
    (yesterday_date::timestamp + time '17:00') at time zone 'Europe/London';
  yesterday_in_id constant uuid := '00000000-0000-4000-8000-000000000406';
  today_in_id constant uuid := '00000000-0000-4000-8000-000000000407';
  exception_id uuid;
  before_count bigint;
  after_count bigint;
  state_before jsonb;
  response jsonb;
  replay jsonb;
  changed_identity jsonb;
  stale_response jsonb;
  revision text;
  correction_batch uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', manager_user_id,
    'authenticated', 'authenticated', 'attendance-manager@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

  insert into public.staff_profiles (
    id, full_name, display_name, employment_role, active
  ) values
    (test_staff_id, 'SQL Attendance Staff', 'SQL Staff', 'Nursery Practitioner', true),
    (manager_staff_id, 'SQL Attendance Manager', 'SQL Manager', 'Manager', true);

  insert into public.staff_accounts (
    id, auth_user_id, staff_id, full_name, email, role, active
  ) values (
    manager_account_id, manager_user_id, manager_staff_id,
    'SQL Attendance Manager', 'attendance-manager@example.invalid', 'manager', true
  );

  insert into public.staff_kiosk_settings (
    staff_id, kiosk_enabled, pin_hash, pin_updated_at, pin_reset_required,
    failed_attempt_count, locked_until
  ) values (
    test_staff_id, true, crypt('4826', gen_salt('bf', 4)), now(), false, 0, null
  );

  insert into public.kiosk_devices (
    id, device_name, token_hash, active, expires_at, activated_by
  ) values (
    device_id, 'SQL attendance test device', digest(device_token, 'sha256'),
    true, now() + interval '1 day', manager_account_id
  );

  insert into public.clock_events (
    id, staff_id, event_type, event_timestamp, kiosk_device_id
  ) values (
    yesterday_in_id, test_staff_id, 'clock_in', yesterday_clock_in, device_id::text
  );

  select count(*) into before_count from public.attendance_exceptions;
  state_before := public.get_attendance_state(test_staff_id, evaluated_at);
  select count(*) into after_count from public.attendance_exceptions;

  perform pg_temp.assert_true(before_count = after_count, 'state query must be read-only');
  perform pg_temp.assert_true(
    state_before ->> 'state' = 'missing_clock_out',
    'previous-day clock-in must require a missing clock-out review'
  );
  perform pg_temp.assert_true(
    state_before -> 'allowedActions' = '["start_new_shift"]'::jsonb,
    'stale shift must expose only start_new_shift'
  );

  revision := state_before ->> 'revision';
  response := public.perform_device_kiosk_attendance_action(
    device_token, test_staff_id, '4826', 'start_new_shift', revision, request_id
  );

  perform pg_temp.assert_true(response ->> 'code' = 'recorded', 'new shift must be recorded');
  perform pg_temp.assert_true(
    (select count(*) from public.clock_events
      where id <> yesterday_in_id and clock_events.staff_id = test_staff_id) = 1,
    'start_new_shift must add exactly one event'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.attendance_exceptions
      where attendance_exceptions.staff_id = test_staff_id
        and exception_type = 'missing_clock_out') = 1,
    'start_new_shift must create exactly one stale-shift exception'
  );

  replay := public.perform_device_kiosk_attendance_action(
    device_token, test_staff_id, '4826', 'start_new_shift', revision, request_id
  );
  perform pg_temp.assert_true(replay = response, 'idempotent replay must return the stored response');

  changed_identity := public.perform_device_kiosk_attendance_action(
    device_token, test_staff_id, '4826', 'clock_out', revision, request_id
  );
  perform pg_temp.assert_true(
    changed_identity ->> 'code' = 'idempotency_conflict',
    'UUID reuse with changed identity must fail safely'
  );

  state_before := public.get_attendance_state(test_staff_id, evaluated_at + interval '1 minute');
  stale_response := public.perform_device_kiosk_attendance_action(
    device_token, test_staff_id, '4826', 'clock_out', 'stale-revision', reused_request_id
  );
  perform pg_temp.assert_true(
    stale_response ->> 'code' = 'state_conflict',
    'stale revisions must return a state conflict'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.clock_events
      where clock_events.staff_id = test_staff_id and event_type = 'clock_out') = 0,
    'stale revisions must not insert an event'
  );

  select id into exception_id
  from public.attendance_exceptions
  where attendance_exceptions.staff_id = test_staff_id
    and exception_type = 'missing_clock_out';

  perform set_config('request.jwt.claim.sub', manager_user_id::text, true);
  begin
    perform public.dismiss_attendance_exception(exception_id, '', state_before ->> 'revision');
    raise exception 'assertion failed: dismissal without a reason must fail';
  exception when check_violation then
    null;
  end;

  correction_batch := public.resolve_attendance_exception(
    exception_id,
    jsonb_build_object(
      'primary', jsonb_build_object(
        'id', gen_random_uuid(),
        'staff_id', test_staff_id,
        'recorded_date', yesterday_date,
        'correction_kind', 'add',
        'original_event_id', null,
        'supersedes_correction_id', null,
        'event_type', 'clock_out',
        'event_timestamp', yesterday_clock_out
      ),
      'consequential', '[]'::jsonb
    ),
    'Correct missed clock out after manager review',
    state_before ->> 'revision'
  );
  perform pg_temp.assert_true(correction_batch is not null, 'resolution must return a correction batch');
  perform pg_temp.assert_true(
    (select resolution_correction_batch_id = correction_batch
      from public.attendance_exceptions where id = exception_id),
    'resolution must link the correction batch'
  );

  perform pg_temp.assert_true(
    not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'attendance_action_requests'
        and column_name in ('pin', 'candidate_pin', 'pin_hash', 'device_token', 'token_hash')
    ),
    'action requests must not have PIN or authentication-secret columns'
  );
  perform pg_temp.assert_true(
    (select to_jsonb(request_record)::text
      from public.attendance_action_requests request_record
      where idempotency_key = request_id) not like '%4826%',
    'action request records must not contain the PIN value'
  );
end;
$$;

set local role anon;
do $$
begin
  begin
    insert into public.attendance_exceptions (
      staff_id, operational_date, exception_type, anomaly_fingerprint,
      detection_revision, source
    ) values ('blocked', current_date, 'missing_clock_out', 'blocked', 'blocked', 'test');
    raise exception 'assertion failed: anon exception insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.attendance_action_requests (
      idempotency_key, staff_id, kiosk_device_id, action, expected_revision
    ) values (gen_random_uuid(), 'blocked', gen_random_uuid(), 'clock_in', 'blocked');
    raise exception 'assertion failed: anon request insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  begin
    insert into public.attendance_exceptions (
      staff_id, operational_date, exception_type, anomaly_fingerprint,
      detection_revision, source
    ) values ('blocked', current_date, 'missing_clock_out', 'blocked', 'blocked', 'test');
    raise exception 'assertion failed: authenticated exception insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.attendance_action_requests (
      idempotency_key, staff_id, kiosk_device_id, action, expected_revision
    ) values (gen_random_uuid(), 'blocked', gen_random_uuid(), 'clock_in', 'blocked');
    raise exception 'assertion failed: authenticated request insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
