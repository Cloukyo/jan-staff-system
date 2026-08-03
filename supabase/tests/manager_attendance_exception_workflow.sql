begin;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not condition then raise exception 'assertion failed: %', message; end if;
end;
$$;

do $$
declare
  test_staff_id constant text := 'sql-manager-exception-staff';
  dismiss_staff_id constant text := 'sql-manager-dismiss-staff';
  manager_staff_id constant text := 'sql-manager-exception-manager';
  ordinary_staff_id constant text := 'sql-manager-exception-ordinary';
  manager_user_id constant uuid := '30000000-0000-4000-8000-000000000401';
  ordinary_user_id constant uuid := '30000000-0000-4000-8000-000000000402';
  manager_account_id constant uuid := '30000000-0000-4000-8000-000000000403';
  ordinary_account_id constant uuid := '30000000-0000-4000-8000-000000000404';
  original_in_id constant uuid := '30000000-0000-4000-8000-000000000405';
  resolve_operation_id constant uuid := '30000000-0000-4000-8000-000000000406';
  second_operation_id constant uuid := '30000000-0000-4000-8000-000000000407';
  dismiss_event_id constant uuid := '30000000-0000-4000-8000-000000000408';
  dismiss_operation_id constant uuid := '30000000-0000-4000-8000-000000000409';
  exception_id uuid;
  dismiss_exception_id uuid;
  revision text;
  plan jsonb;
  response jsonb;
  replay jsonb;
  detail jsonb;
  original_timestamp timestamptz;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', manager_user_id,
      'authenticated', 'authenticated', 'exception-manager@example.invalid', '',
      now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', ordinary_user_id,
      'authenticated', 'authenticated', 'exception-staff@example.invalid', '',
      now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.staff_profiles (id, full_name, display_name, employment_role, active)
  values
    (test_staff_id, 'SQL Exception Staff', 'Exception Staff', 'Practitioner', true),
    (dismiss_staff_id, 'SQL Dismiss Staff', 'Dismiss Staff', 'Practitioner', true),
    (manager_staff_id, 'SQL Exception Manager', 'Exception Manager', 'Manager', true),
    (ordinary_staff_id, 'SQL Ordinary Staff', 'Ordinary Staff', 'Practitioner', true);

  insert into public.staff_accounts (
    id, auth_user_id, staff_id, full_name, email, role, active
  ) values
    (manager_account_id, manager_user_id, manager_staff_id,
      'SQL Exception Manager', 'exception-manager@example.invalid', 'manager', true),
    (ordinary_account_id, ordinary_user_id, ordinary_staff_id,
      'SQL Ordinary Staff', 'exception-staff@example.invalid', 'staff', true);

  insert into public.clock_events (
    id, staff_id, event_type, event_timestamp, kiosk_device_id
  ) values (
    original_in_id, test_staff_id, 'clock_in', '2026-08-02 08:30:00+01', 'test-kiosk'
  );
  select event_timestamp into original_timestamp
  from public.clock_events where id = original_in_id;

  perform public.reconcile_attendance_exceptions(
    test_staff_id, '2026-08-02', '2026-08-02'
  );
  select id into exception_id
  from public.attendance_exceptions
  where staff_id = test_staff_id and exception_type = 'missing_clock_out';
  perform pg_temp.assert_true(exception_id is not null, 'missing clock-out must reconcile once');
  perform pg_temp.assert_true(
    (select count(*) from public.attendance_exceptions
      where staff_id = test_staff_id and exception_type = 'missing_clock_out') = 1,
    'reconciliation must not duplicate an issue'
  );

  revision := public.get_attendance_event_revision(test_staff_id, '2026-08-02');
  plan := jsonb_build_object(
    'primary', jsonb_build_object(
      'id', resolve_operation_id,
      'staff_id', test_staff_id,
      'recorded_date', '2026-08-02',
      'correction_kind', 'add',
      'original_event_id', null,
      'supersedes_correction_id', null,
      'event_type', 'clock_out',
      'event_timestamp', '2026-08-02 16:30:00+01'
    ),
    'consequential', '[]'::jsonb
  );

  perform set_config('request.jwt.claim.sub', manager_user_id::text, true);
  begin
    perform public.resolve_attendance_exception(
      exception_id, plan, 'Stale manager correction must not be saved',
      'stale-revision', resolve_operation_id
    );
    raise exception 'assertion failed: stale resolution unexpectedly succeeded';
  exception when serialization_failure then null;
  end;
  response := public.resolve_attendance_exception(
    exception_id, plan, 'Confirmed missed clock-out with manager evidence',
    revision, resolve_operation_id
  );
  replay := public.resolve_attendance_exception(
    exception_id, plan, 'Confirmed missed clock-out with manager evidence',
    revision, resolve_operation_id
  );

  perform pg_temp.assert_true(response = replay, 'same operation retry must return stored result');
  perform pg_temp.assert_true(response ->> 'status' = 'resolved', 'exception must resolve');
  perform pg_temp.assert_true(
    (select event_timestamp = original_timestamp from public.clock_events where id = original_in_id),
    'original clock event must remain unchanged'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.clock_event_corrections
      where batch_id = (response ->> 'correctionBatchId')::uuid) = 1,
    'resolution must create exactly one correction-chain entry'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.attendance_exception_operations
      where operation_id = resolve_operation_id) = 1,
    'resolution operation must be audited once'
  );

  begin
    perform public.resolve_attendance_exception(
      exception_id, plan, 'A conflicting second manager decision',
      revision, second_operation_id
    );
    raise exception 'assertion failed: a second resolution unexpectedly succeeded';
  exception when sqlstate 'P0001' then null;
  end;

  select value into detail
  from public.get_manager_attendance_exceptions(
    '2026-08-02', '2026-08-02', 'resolved', null, test_staff_id
  ) as result(value)
  limit 1;
  perform pg_temp.assert_true(detail ->> 'id' = exception_id::text, 'resolved filter must return issue');
  perform pg_temp.assert_true(
    jsonb_array_length(detail -> 'original_events') = 1,
    'manager detail must retain original evidence'
  );
  perform pg_temp.assert_true(
    jsonb_array_length(detail -> 'effective_events') = 2,
    'manager detail must show corrected effective evidence'
  );

  insert into public.clock_events (
    id, staff_id, event_type, event_timestamp, kiosk_device_id
  ) values (
    dismiss_event_id, dismiss_staff_id, 'clock_out',
    '2026-08-02 16:30:00+01', 'test-kiosk'
  );
  perform public.reconcile_attendance_exceptions(
    dismiss_staff_id, '2026-08-02', '2026-08-02'
  );
  select id into dismiss_exception_id
  from public.attendance_exceptions
  where staff_id = dismiss_staff_id and exception_type = 'unmatched_clock_out';
  revision := public.get_attendance_event_revision(dismiss_staff_id, '2026-08-02');
  response := public.dismiss_attendance_exception(
    dismiss_exception_id, 'Verified false positive with nursery records',
    revision, dismiss_operation_id
  );
  replay := public.dismiss_attendance_exception(
    dismiss_exception_id, 'Verified false positive with nursery records',
    revision, dismiss_operation_id
  );
  perform pg_temp.assert_true(response = replay, 'dismissal retry must return stored result');
  perform pg_temp.assert_true(
    (select status = 'dismissed' from public.attendance_exceptions where id = dismiss_exception_id),
    'dismissal must preserve and mark the exception'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.clock_event_corrections where staff_id = dismiss_staff_id) = 0,
    'dismissal must not fabricate a correction'
  );
  select value into detail
  from public.get_manager_attendance_exceptions(
    '2026-08-02', '2026-08-02', 'dismissed', null, dismiss_staff_id
  ) as result(value) limit 1;
  perform pg_temp.assert_true(detail ->> 'id' = dismiss_exception_id::text, 'dismissed filter must return issue');

  perform set_config('request.jwt.claim.sub', ordinary_user_id::text, true);
  begin
    perform public.dismiss_attendance_exception(
      exception_id, 'Ordinary staff must not dismiss issues', revision, second_operation_id
    );
    raise exception 'assertion failed: non-manager dismissal unexpectedly succeeded';
  exception when sqlstate 'P0001' then null;
  end;
end;
$$;

set local role anon;
do $$
begin
  begin
    insert into public.attendance_exception_operations (
      operation_id, exception_id, operation_kind, expected_revision,
      reason, request_fingerprint, created_by
    ) values (
      gen_random_uuid(), gen_random_uuid(), 'dismiss', 'revision',
      'Direct anonymous write', 'fingerprint', gen_random_uuid()
    );
    raise exception 'assertion failed: anon operation insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
