begin;

do $$
begin
  if to_regclass('public.kiosk_offline_authorisations') is null then
    raise exception 'kiosk_offline_authorisations is missing';
  end if;
  if to_regclass('public.kiosk_sync_health') is null then
    raise exception 'kiosk_sync_health is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kiosk_devices'
      and column_name = 'offline_enabled'
  ) then
    raise exception 'offline_enabled is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clock_events'
      and column_name = 'offline_authorisation_id'
  ) then
    raise exception 'clock event offline audit columns are missing';
  end if;
  if has_table_privilege('anon', 'public.kiosk_offline_authorisations', 'select')
    or has_table_privilege('authenticated', 'public.kiosk_offline_authorisations', 'insert') then
    raise exception 'offline authorisation table is exposed to browser roles';
  end if;
  if has_function_privilege('anon', 'public.perform_offline_kiosk_attendance_action(text,uuid,text,text,text,uuid,bigint,timestamptz,text,date,timestamptz,text,uuid,text,bigint,text,boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.perform_offline_kiosk_attendance_action(text,uuid,text,text,text,uuid,bigint,timestamptz,text,date,timestamptz,text,uuid,text,bigint,text,boolean)', 'execute') then
    raise exception 'offline attendance RPC is exposed to browser roles';
  end if;
end;
$$;

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
  test_staff_id constant text := 'offline-kiosk-fictional-staff';
  manager_staff_id constant text := 'offline-kiosk-fictional-manager';
  manager_user_id constant uuid := '10000000-0000-4000-8000-000000000001';
  manager_account_id constant uuid := '10000000-0000-4000-8000-000000000002';
  device_id constant uuid := '10000000-0000-4000-8000-000000000003';
  device_token constant text := 'offline-kiosk-fictional-device-token-00000000000000000001';
  operation_id constant uuid := '10000000-0000-4000-8000-000000000004';
  provisioned jsonb;
  synced jsonb;
  replayed jsonb;
  authorisation_id uuid;
  roster_version text;
  expected_revision text;
  issued_at timestamptz;
  occurred_at timestamptz;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', manager_user_id,
    'authenticated', 'authenticated', 'offline-manager@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

  insert into public.staff_profiles (
    id, full_name, display_name, employment_role, active
  ) values
    (test_staff_id, 'Fictional Offline Staff', 'Fictional Staff', 'Nursery Practitioner', true),
    (manager_staff_id, 'Fictional Offline Manager', 'Fictional Manager', 'Manager', true);

  insert into public.staff_accounts (
    id, auth_user_id, staff_id, full_name, email, role, active
  ) values (
    manager_account_id, manager_user_id, manager_staff_id,
    'Fictional Offline Manager', 'offline-manager@example.invalid', 'manager', true
  );

  insert into public.staff_kiosk_settings (
    staff_id, kiosk_enabled, pin_hash, pin_updated_at, pin_reset_required,
    failed_attempt_count, locked_until
  ) values (
    test_staff_id, true, extensions.crypt('482731', extensions.gen_salt('bf', 4)),
    now(), false, 0, null
  );

  insert into public.kiosk_devices (
    id, device_name, token_hash, active, expires_at, activated_by,
    offline_enabled, hardware_verified_at
  ) values (
    device_id, 'Fictional offline test tablet',
    extensions.digest(device_token, 'sha256'), true, now() + interval '2 days',
    manager_account_id, true, now()
  );

  provisioned := public.provision_offline_kiosk(
    device_token, 1, '0.1.0', clock_timestamp(),
    jsonb_build_object(
      'kty', 'EC', 'crv', 'P-256',
      'x', repeat('A', 43), 'y', repeat('B', 43)
    )
  );
  perform pg_temp.assert_true(provisioned ->> 'ok' = 'true', 'registered device must provision');
  perform pg_temp.assert_true(
    provisioned::text not like '%482731%' and provisioned::text not like '%pin_hash%',
    'provisioning must not expose plaintext or production PIN hashes'
  );
  perform pg_temp.assert_true(
    jsonb_array_length(provisioned -> 'package' -> 'roster') = 1,
    'provisioning must return only the authorised minimum roster'
  );

  authorisation_id := (provisioned -> 'package' -> 'authorisation' ->> 'id')::uuid;
  roster_version := provisioned -> 'package' -> 'authorisation' ->> 'rosterVersion';
  expected_revision := provisioned -> 'package' -> 'roster' -> 0 -> 'trustedState' ->> 'revision';
  issued_at := (provisioned -> 'package' -> 'authorisation' ->> 'issuedAt')::timestamptz;
  occurred_at := issued_at + interval '1 minute';

  synced := public.perform_offline_kiosk_attendance_action(
    device_token, authorisation_id, test_staff_id, 'clock_in', expected_revision,
    operation_id, 1, occurred_at, 'Europe/London',
    public.attendance_operational_date(occurred_at), occurred_at + interval '1 second',
    roster_version, null, 'anchored', 60000,
    repeat('a', 64), true
  );
  perform pg_temp.assert_true(synced ->> 'outcome' = 'accepted', 'valid offline clock-in must be accepted');
  perform pg_temp.assert_true(
    (select count(*) from public.clock_events event
      where event.staff_id = test_staff_id
        and event.offline_authorisation_id = authorisation_id
        and event.offline_device_sequence = 1) = 1,
    'accepted offline action must create exactly one immutable event'
  );
  perform pg_temp.assert_true(
    (select event_timestamp = occurred_at and received_at_server is not null
      from public.clock_events event
      where event.offline_authorisation_id = authorisation_id
        and event.offline_device_sequence = 1),
    'event must preserve device and server timestamps separately'
  );

  replayed := public.perform_offline_kiosk_attendance_action(
    device_token, authorisation_id, test_staff_id, 'clock_in', expected_revision,
    operation_id, 1, occurred_at, 'Europe/London',
    public.attendance_operational_date(occurred_at), occurred_at + interval '1 second',
    roster_version, null, 'anchored', 60000,
    repeat('a', 64), true
  );
  perform pg_temp.assert_true(replayed = synced, 'idempotent replay must return the stored result');
  perform pg_temp.assert_true(
    (select count(*) from public.clock_events event
      where event.offline_authorisation_id = authorisation_id
        and event.offline_device_sequence = 1) = 1,
    'idempotent replay must not create a duplicate event'
  );
end;
$$;

rollback;
