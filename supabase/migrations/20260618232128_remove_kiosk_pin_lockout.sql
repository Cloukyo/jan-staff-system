update public.staff_kiosk_settings
set locked_until = null
where locked_until is not null;

create or replace function public.verify_kiosk_pin(target_staff_id text, candidate_pin text)
returns table (ok boolean, code text, current_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
begin
  select ks.*
  into settings
  from public.staff_kiosk_settings ks
  join public.staff_profiles sp on sp.id = ks.staff_id
  where ks.staff_id = target_staff_id and sp.active = true
  for update of ks;

  if not found or not settings.kiosk_enabled then
    return query select false, 'unavailable', null::text;
    return;
  end if;
  if settings.pin_hash is null then
    return query select false, 'reset_required', null::text;
    return;
  end if;
  if crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    update public.staff_kiosk_settings
    set failed_attempt_count = failed_attempt_count + 1,
        locked_until = null
    where staff_id = target_staff_id;
    return query select false, 'invalid_pin', null::text;
    return;
  end if;

  update public.staff_kiosk_settings
  set failed_attempt_count = 0, locked_until = null
  where staff_id = target_staff_id;

  select ce.event_type into latest_type
  from public.clock_events ce
  where ce.staff_id = target_staff_id
  order by ce.event_timestamp desc, ce.created_at desc
  limit 1;

  return query select
    true,
    case when settings.pin_reset_required then 'change_required' else 'ok' end,
    case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end;
end;
$$;

revoke all on function public.verify_kiosk_pin(text, text) from public, anon, authenticated;

create or replace function public.change_device_kiosk_pin(
  device_token text,
  target_staff_id text,
  temporary_pin text,
  new_pin text
)
returns table (ok boolean, code text, current_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
begin
  perform public.require_kiosk_device(device_token);

  select ks.*
  into settings
  from public.staff_kiosk_settings ks
  join public.staff_profiles sp on sp.id = ks.staff_id
  where ks.staff_id = target_staff_id and sp.active = true
  for update of ks;

  if not found or not settings.kiosk_enabled then
    return query select false, 'unavailable', null::text;
    return;
  end if;
  if settings.pin_hash is null or not settings.pin_reset_required then
    return query select false, 'change_not_required', null::text;
    return;
  end if;
  if crypt(temporary_pin, settings.pin_hash) <> settings.pin_hash then
    update public.staff_kiosk_settings
    set failed_attempt_count = failed_attempt_count + 1,
        locked_until = null
    where staff_id = target_staff_id;
    return query select false, 'invalid_pin', null::text;
    return;
  end if;
  if not public.kiosk_pin_is_acceptable(new_pin) then
    return query select false, 'weak_pin', null::text;
    return;
  end if;
  if crypt(new_pin, settings.pin_hash) = settings.pin_hash then
    return query select false, 'same_pin', null::text;
    return;
  end if;

  update public.staff_kiosk_settings
  set pin_hash = crypt(new_pin, gen_salt('bf', 12)),
      pin_updated_at = now(),
      pin_updated_by = null,
      pin_reset_required = false,
      failed_attempt_count = 0,
      locked_until = null
  where staff_id = target_staff_id;

  select ce.event_type into latest_type
  from public.clock_events ce
  where ce.staff_id = target_staff_id
  order by ce.event_timestamp desc, ce.created_at desc
  limit 1;

  return query select true, 'pin_changed',
    case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end;
end;
$$;

revoke all on function public.change_device_kiosk_pin(text, text, text, text) from public;
grant execute on function public.change_device_kiosk_pin(text, text, text, text) to anon, authenticated;

create or replace function public.record_kiosk_clock_event(
  target_staff_id text,
  candidate_pin text,
  requested_event_type text,
  device_identifier text default null
)
returns table (ok boolean, code text, current_status text, recorded_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  latest_at timestamptz;
  created_event_at timestamptz;
begin
  if requested_event_type not in ('clock_in', 'clock_out') then
    return query select false, 'invalid_event', null::text, null::timestamptz;
    return;
  end if;

  select ks.*
  into settings
  from public.staff_kiosk_settings ks
  join public.staff_profiles sp on sp.id = ks.staff_id
  where ks.staff_id = target_staff_id and sp.active = true
  for update of ks;

  if not found or not settings.kiosk_enabled then
    return query select false, 'unavailable', null::text, null::timestamptz;
    return;
  end if;
  if settings.pin_hash is null or settings.pin_reset_required then
    return query select false, 'reset_required', null::text, null::timestamptz;
    return;
  end if;
  if crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    update public.staff_kiosk_settings
    set failed_attempt_count = failed_attempt_count + 1,
        locked_until = null
    where staff_id = target_staff_id;
    return query select false, 'invalid_pin', null::text, null::timestamptz;
    return;
  end if;

  update public.staff_kiosk_settings
  set failed_attempt_count = 0, locked_until = null
  where staff_id = target_staff_id;

  select ce.event_type, ce.event_timestamp
  into latest_type, latest_at
  from public.clock_events ce
  where ce.staff_id = target_staff_id
  order by ce.event_timestamp desc, ce.created_at desc
  limit 1;

  if requested_event_type = 'clock_in' and latest_type = 'clock_in' then
    return query select false, 'already_clocked_in', 'clocked_in', null::timestamptz;
    return;
  end if;
  if requested_event_type = 'clock_out' and coalesce(latest_type, 'clock_out') = 'clock_out' then
    return query select false, 'not_clocked_in', 'clocked_out', null::timestamptz;
    return;
  end if;
  if latest_at is not null and latest_at > now() - interval '5 seconds' then
    return query select false, 'too_soon', case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end, null::timestamptz;
    return;
  end if;

  insert into public.clock_events (staff_id, event_type, kiosk_device_id)
  values (target_staff_id, requested_event_type, nullif(left(trim(device_identifier), 100), ''))
  returning event_timestamp into created_event_at;

  return query select true, 'recorded',
    case when requested_event_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
    created_event_at;
end;
$$;

revoke all on function public.record_kiosk_clock_event(text, text, text, text) from public;
grant execute on function public.record_kiosk_clock_event(text, text, text, text) to anon, authenticated;
