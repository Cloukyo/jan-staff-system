create table public.staff_kiosk_settings (
  staff_id text primary key references public.staff_profiles(id) on delete restrict,
  kiosk_enabled boolean not null default true,
  pin_hash text,
  pin_updated_at timestamptz,
  pin_reset_required boolean not null default true,
  failed_attempt_count integer not null default 0 check (failed_attempt_count >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.staff_kiosk_settings (staff_id)
select id from public.staff_profiles
on conflict (staff_id) do nothing;

create trigger staff_kiosk_settings_updated_at
before update on public.staff_kiosk_settings
for each row execute function public.set_updated_at();

create table public.clock_events (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  event_timestamp timestamptz not null default now(),
  recorded_date date generated always as ((event_timestamp at time zone 'Europe/London')::date) stored,
  kiosk_device_id text,
  event_source text not null default 'kiosk' check (event_source in ('kiosk', 'manager')),
  manager_correction boolean not null default false,
  corrected_by uuid references public.staff_accounts(id) on delete restrict,
  correction_reason text,
  created_at timestamptz not null default now(),
  constraint manager_correction_details check (
    (manager_correction = false and corrected_by is null and correction_reason is null)
    or
    (manager_correction = true and corrected_by is not null and length(trim(correction_reason)) >= 5)
  )
);

create index clock_events_staff_timestamp_idx
on public.clock_events (staff_id, event_timestamp desc, created_at desc);

create index clock_events_recorded_date_idx
on public.clock_events (recorded_date, staff_id);

alter table public.staff_kiosk_settings enable row level security;
alter table public.clock_events enable row level security;

create policy "Managers can manage kiosk settings"
on public.staff_kiosk_settings for all
to authenticated
using (public.current_staff_role() = 'manager')
with check (public.current_staff_role() = 'manager');

create policy "Managers can read clock events"
on public.clock_events for select
to authenticated
using (public.current_staff_role() = 'manager');

create policy "Staff can read own clock events"
on public.clock_events for select
to authenticated
using (staff_id = public.current_staff_profile_id());

create policy "Managers can add clock corrections"
on public.clock_events for insert
to authenticated
with check (
  public.current_staff_role() = 'manager'
  and event_source = 'manager'
  and manager_correction = true
  and corrected_by = (public.current_staff_account()).id
  and correction_reason is not null
);

revoke all on public.staff_kiosk_settings from anon;
revoke all on public.clock_events from anon;
grant select, insert, update on public.staff_kiosk_settings to authenticated;
grant select, insert on public.clock_events to authenticated;

create or replace function public.kiosk_pin_is_acceptable(candidate text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    candidate ~ '^[0-9]{4,6}$'
    and candidate not in ('0000', '1111', '1234', '4321', '0123', '9999')
    and candidate !~ '^([0-9])\1+$'
    and not (length(candidate) = 4 and candidate::integer between 1900 and 2099);
$$;

revoke all on function public.kiosk_pin_is_acceptable(text) from public;
grant execute on function public.kiosk_pin_is_acceptable(text) to authenticated;

create or replace function public.set_staff_kiosk_pin(target_staff_id text, new_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_staff_role() <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if not public.kiosk_pin_is_acceptable(new_pin) then
    raise exception 'Choose a stronger PIN';
  end if;

  insert into public.staff_kiosk_settings (
    staff_id, kiosk_enabled, pin_hash, pin_updated_at, pin_reset_required,
    failed_attempt_count, locked_until
  )
  values (
    target_staff_id, true, crypt(new_pin, gen_salt('bf', 12)), now(), false, 0, null
  )
  on conflict (staff_id) do update set
    pin_hash = excluded.pin_hash,
    pin_updated_at = excluded.pin_updated_at,
    pin_reset_required = false,
    failed_attempt_count = 0,
    locked_until = null;
end;
$$;

revoke all on function public.set_staff_kiosk_pin(text, text) from public;
grant execute on function public.set_staff_kiosk_pin(text, text) to authenticated;

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
    (ks.pin_hash is not null and ks.pin_reset_required = false)
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
grant execute on function public.get_kiosk_roster() to anon, authenticated;

create or replace function public.verify_kiosk_pin(target_staff_id text, candidate_pin text)
returns table (ok boolean, code text, current_status text)
language plpgsql
security definer
set search_path = public
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
  if settings.pin_hash is null or settings.pin_reset_required then
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

  return query select true, 'ok', case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end;
end;
$$;

revoke all on function public.verify_kiosk_pin(text, text) from public;
grant execute on function public.verify_kiosk_pin(text, text) to anon, authenticated;

create or replace function public.record_kiosk_clock_event(
  target_staff_id text,
  candidate_pin text,
  requested_event_type text,
  device_identifier text default null
)
returns table (ok boolean, code text, current_status text, recorded_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  latest_at timestamptz;
  failures integer;
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
        locked_until = case when failures >= 5 then now() + interval '15 minutes' else null end
    where staff_id = target_staff_id;
    return query select false, case when failures >= 5 then 'locked' else 'invalid_pin' end, null::text, null::timestamptz;
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
