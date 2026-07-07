alter table public.rota_settings
  add column if not exists work_week_starts_on smallint not null default 1 check (work_week_starts_on between 1 and 7);

update public.rota_settings
set work_week_starts_on = coalesce(work_week_starts_on, week_starts_on, 1)
where id = true;

-- Previous production behaviour counted failed attempts without locking.
-- Reset stale counters once so staff are not locked because of historic attempts.
update public.staff_kiosk_settings
set failed_attempt_count = 0,
    locked_until = null
where failed_attempt_count > 0 or locked_until is not null;

create or replace function public.get_current_work_week_range(reference_date date default null)
returns table (start_date date, end_date date)
language sql
security definer
set search_path = public
stable
as $$
  with settings as (
    select coalesce(work_week_starts_on, 1)::integer as week_start_day
    from public.rota_settings
    where id = true
  ),
  reference as (
    select
      coalesce(reference_date, (now() at time zone 'Europe/London')::date) as date_value,
      coalesce((select week_start_day from settings), 1) as week_start_day
  ),
  range_start as (
    select date_value - (((extract(isodow from date_value)::integer - week_start_day + 7) % 7)) as start_value
    from reference
  )
  select start_value, start_value + 6
  from range_start;
$$;

revoke all on function public.get_current_work_week_range(date) from public, anon, authenticated;
grant execute on function public.get_current_work_week_range(date) to authenticated;

create or replace function public.get_staff_weekly_hours(target_staff_id text, reference_date date default null)
returns table (
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  range_start date;
  range_end date;
begin
  select start_date, end_date
  into range_start, range_end
  from public.get_current_work_week_range(reference_date);

  return query
  with ordered as (
    select
      ce.event_type,
      ce.event_timestamp,
      lead(ce.event_type) over (order by ce.event_timestamp, ce.created_at) as next_event_type,
      lead(ce.event_timestamp) over (order by ce.event_timestamp, ce.created_at) as next_event_timestamp
    from public.clock_events ce
    where ce.staff_id = target_staff_id
      and ce.recorded_date between range_start and range_end
  )
  select
    range_start,
    range_end,
    coalesce(sum(
      case
        when event_type = 'clock_in'
          and next_event_type = 'clock_out'
          and next_event_timestamp >= event_timestamp
        then round(extract(epoch from (next_event_timestamp - event_timestamp)) / 60)::integer
        else 0
      end
    ), 0)::integer,
    coalesce(bool_or(event_type = 'clock_in' and next_event_type is null), false)
  from ordered;
end;
$$;

revoke all on function public.get_staff_weekly_hours(text, date) from public, anon, authenticated;

create or replace function public.get_manager_hours_preview(range_start date, range_end date)
returns table (
  staff_id text,
  display_name text,
  full_name text,
  completed_minutes integer,
  open_shift_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  manager_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if range_start is null or range_end is null or range_start > range_end then
    raise exception 'Choose a valid date range';
  end if;

  return query
  with active_staff as (
    select id, coalesce(nullif(trim(display_name), ''), full_name) as display_name, full_name
    from public.staff_profiles
    where active = true
  ),
  ordered as (
    select
      ce.staff_id,
      ce.event_type,
      ce.event_timestamp,
      lead(ce.event_type) over (partition by ce.staff_id order by ce.event_timestamp, ce.created_at) as next_event_type,
      lead(ce.event_timestamp) over (partition by ce.staff_id order by ce.event_timestamp, ce.created_at) as next_event_timestamp
    from public.clock_events ce
    join active_staff staff on staff.id = ce.staff_id
    where ce.recorded_date between range_start and range_end
  ),
  totals as (
    select
      ordered.staff_id,
      coalesce(sum(
        case
          when ordered.event_type = 'clock_in'
            and ordered.next_event_type = 'clock_out'
            and ordered.next_event_timestamp >= ordered.event_timestamp
          then round(extract(epoch from (ordered.next_event_timestamp - ordered.event_timestamp)) / 60)::integer
          else 0
        end
      ), 0)::integer as completed_minutes,
      count(*) filter (where ordered.event_type = 'clock_in' and ordered.next_event_type is null)::integer as open_shift_count
    from ordered
    group by ordered.staff_id
  )
  select
    staff.id,
    staff.display_name,
    staff.full_name,
    coalesce(totals.completed_minutes, 0),
    coalesce(totals.open_shift_count, 0)
  from active_staff staff
  left join totals on totals.staff_id = staff.id
  order by staff.full_name;
end;
$$;

revoke all on function public.get_manager_hours_preview(date, date) from public, anon, authenticated;
grant execute on function public.get_manager_hours_preview(date, date) to authenticated;

drop function if exists public.verify_device_kiosk_pin(text, text, text);
drop function if exists public.change_device_kiosk_pin(text, text, text, text);
drop function if exists public.record_device_kiosk_clock_event(text, text, text, text);
drop function if exists public.verify_kiosk_pin(text, text);
drop function if exists public.record_kiosk_clock_event(text, text, text, text);

create or replace function public.verify_kiosk_pin(target_staff_id text, candidate_pin text)
returns table (
  ok boolean,
  code text,
  current_status text,
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  failures integer;
  hours_row record;
begin
  select ks.*
  into settings
  from public.staff_kiosk_settings ks
  join public.staff_profiles sp on sp.id = ks.staff_id
  where ks.staff_id = target_staff_id and sp.active = true
  for update of ks;

  if not found or not settings.kiosk_enabled then
    return query select false, 'unavailable', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.locked_until is not null and settings.locked_until > now() then
    return query select false, 'locked', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.pin_hash is null then
    return query select false, 'reset_required', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set failed_attempt_count = failures,
        locked_until = case when failures >= 4 then now() + interval '15 minutes' else null end
    where staff_id = target_staff_id;
    return query select
      false,
      case
        when failures >= 4 then 'locked'
        when failures = 3 then 'invalid_pin_attempt_3'
        when failures = 2 then 'invalid_pin_attempt_2'
        else 'invalid_pin_attempt_1'
      end,
      null::text,
      null::date,
      null::date,
      null::integer,
      false;
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

  select * into hours_row
  from public.get_staff_weekly_hours(target_staff_id);

  return query select
    true,
    case when settings.pin_reset_required then 'change_required' else 'ok' end,
    case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
    hours_row.work_week_start_date,
    hours_row.work_week_end_date,
    hours_row.completed_minutes,
    hours_row.open_shift_in_progress;
end;
$$;

revoke all on function public.verify_kiosk_pin(text, text) from public, anon, authenticated;

create or replace function public.change_device_kiosk_pin(
  device_token text,
  target_staff_id text,
  temporary_pin text,
  new_pin text
)
returns table (
  ok boolean,
  code text,
  current_status text,
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  failures integer;
  hours_row record;
begin
  perform public.require_kiosk_device(device_token);

  select ks.*
  into settings
  from public.staff_kiosk_settings ks
  join public.staff_profiles sp on sp.id = ks.staff_id
  where ks.staff_id = target_staff_id and sp.active = true
  for update of ks;

  if not found or not settings.kiosk_enabled then
    return query select false, 'unavailable', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.locked_until is not null and settings.locked_until > now() then
    return query select false, 'locked', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.pin_hash is null or not settings.pin_reset_required then
    return query select false, 'change_not_required', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if crypt(temporary_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set failed_attempt_count = failures,
        locked_until = case when failures >= 4 then now() + interval '15 minutes' else null end
    where staff_id = target_staff_id;
    return query select
      false,
      case
        when failures >= 4 then 'locked'
        when failures = 3 then 'invalid_pin_attempt_3'
        when failures = 2 then 'invalid_pin_attempt_2'
        else 'invalid_pin_attempt_1'
      end,
      null::text,
      null::date,
      null::date,
      null::integer,
      false;
    return;
  end if;
  if not public.kiosk_pin_is_acceptable(new_pin) then
    return query select false, 'weak_pin', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if crypt(new_pin, settings.pin_hash) = settings.pin_hash then
    return query select false, 'same_pin', null::text, null::date, null::date, null::integer, false;
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

  select * into hours_row
  from public.get_staff_weekly_hours(target_staff_id);

  return query select true, 'pin_changed',
    case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
    hours_row.work_week_start_date,
    hours_row.work_week_end_date,
    hours_row.completed_minutes,
    hours_row.open_shift_in_progress;
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
  failures integer;
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
  if settings.locked_until is not null and settings.locked_until > now() then
    return query select false, 'locked', null::text, null::timestamptz;
    return;
  end if;
  if settings.pin_hash is null or settings.pin_reset_required then
    return query select false, 'reset_required', null::text, null::timestamptz;
    return;
  end if;
  if crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set failed_attempt_count = failures,
        locked_until = case when failures >= 4 then now() + interval '15 minutes' else null end
    where staff_id = target_staff_id;
    return query select
      false,
      case
        when failures >= 4 then 'locked'
        when failures = 3 then 'invalid_pin_attempt_3'
        when failures = 2 then 'invalid_pin_attempt_2'
        else 'invalid_pin_attempt_1'
      end,
      null::text,
      null::timestamptz;
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

create or replace function public.verify_device_kiosk_pin(
  device_token text,
  target_staff_id text,
  candidate_pin text
)
returns table (
  ok boolean,
  code text,
  current_status text,
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.require_kiosk_device(device_token);
  return query select * from public.verify_kiosk_pin(target_staff_id, candidate_pin);
end;
$$;

create or replace function public.record_device_kiosk_clock_event(
  device_token text,
  target_staff_id text,
  candidate_pin text,
  requested_event_type text
)
returns table (ok boolean, code text, current_status text, recorded_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  device_id uuid;
begin
  device_id := public.require_kiosk_device(device_token);
  return query
  select *
  from public.record_kiosk_clock_event(
    target_staff_id,
    candidate_pin,
    requested_event_type,
    device_id::text
  );
end;
$$;

revoke all on function public.verify_device_kiosk_pin(text, text, text) from public;
revoke all on function public.record_device_kiosk_clock_event(text, text, text, text) from public;
grant execute on function public.verify_device_kiosk_pin(text, text, text) to anon, authenticated;
grant execute on function public.record_device_kiosk_clock_event(text, text, text, text) to anon, authenticated;
