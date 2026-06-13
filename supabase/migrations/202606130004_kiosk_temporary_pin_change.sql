create or replace function public.get_kiosk_roster()
returns table (
  staff_id text,
  display_name text,
  full_name text,
  employment_role text,
  current_status text,
  pin_ready boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sp.id,
    coalesce(nullif(trim(sp.display_name), ''), sp.full_name),
    sp.full_name,
    sp.employment_role,
    case when latest.event_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
    ks.pin_hash is not null
  from public.staff_profiles sp
  join public.staff_kiosk_settings ks on ks.staff_id = sp.id
  left join lateral (
    select ce.event_type
    from public.clock_events ce
    where ce.staff_id = sp.id
    order by ce.event_timestamp desc, ce.created_at desc
    limit 1
  ) latest on true
  where sp.active = true and ks.kiosk_enabled = true
  order by coalesce(nullif(trim(sp.display_name), ''), sp.full_name);
$$;

revoke all on function public.get_kiosk_roster() from public;

create or replace function public.verify_kiosk_pin(target_staff_id text, candidate_pin text)
returns table (ok boolean, code text, current_status text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  failures integer;
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
  if settings.locked_until is not null and settings.locked_until > now() then
    return query select false, 'locked', null::text;
    return;
  end if;
  if settings.pin_hash is null then
    return query select false, 'reset_required', null::text;
    return;
  end if;
  if crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set failed_attempt_count = failures,
        locked_until = case when failures >= 5 then now() + interval '15 minutes' else null end
    where staff_id = target_staff_id;
    return query select false, case when failures >= 5 then 'locked' else 'invalid_pin' end, null::text;
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
  failures integer;
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
  if settings.locked_until is not null and settings.locked_until > now() then
    return query select false, 'locked', null::text;
    return;
  end if;
  if settings.pin_hash is null or not settings.pin_reset_required then
    return query select false, 'change_not_required', null::text;
    return;
  end if;
  if crypt(temporary_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set failed_attempt_count = failures,
        locked_until = case when failures >= 5 then now() + interval '15 minutes' else null end
    where staff_id = target_staff_id;
    return query select false, case when failures >= 5 then 'locked' else 'invalid_pin' end, null::text;
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

create or replace function public.set_staff_kiosk_pin(
  target_staff_id text,
  new_pin text,
  require_change boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  manager_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if not public.kiosk_pin_is_acceptable(new_pin) then
    raise exception 'Choose a stronger PIN';
  end if;

  insert into public.staff_kiosk_settings (
    staff_id, kiosk_enabled, pin_hash, pin_updated_at, pin_updated_by,
    pin_reset_required, failed_attempt_count, locked_until
  )
  values (
    target_staff_id, true, crypt(new_pin, gen_salt('bf', 12)), now(),
    manager_account.id, coalesce(require_change, true), 0, null
  )
  on conflict (staff_id) do update set
    pin_hash = excluded.pin_hash,
    pin_updated_at = excluded.pin_updated_at,
    pin_updated_by = excluded.pin_updated_by,
    pin_reset_required = excluded.pin_reset_required,
    failed_attempt_count = 0,
    locked_until = null;
end;
$$;

revoke all on function public.set_staff_kiosk_pin(text, text, boolean) from public;
grant execute on function public.set_staff_kiosk_pin(text, text, boolean) to authenticated;
