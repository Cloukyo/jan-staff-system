alter table public.staff_accounts
  add column access_granted_by uuid references public.staff_accounts(id) on delete set null,
  add column access_granted_at timestamptz,
  add column disabled_by uuid references public.staff_accounts(id) on delete set null,
  add column disabled_at timestamptz;

alter table public.staff_kiosk_settings
  add column pin_updated_by uuid references public.staff_accounts(id) on delete set null;

create table public.kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  device_name text not null check (length(trim(device_name)) between 3 and 100),
  token_hash bytea not null unique,
  active boolean not null default true,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  activated_by uuid not null references public.staff_accounts(id) on delete restrict,
  activated_at timestamptz not null default now(),
  revoked_by uuid references public.staff_accounts(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kiosk_device_revocation check (
    (active = true and revoked_by is null and revoked_at is null)
    or
    (active = false and revoked_by is not null and revoked_at is not null)
  )
);

create index kiosk_devices_active_expiry_idx
on public.kiosk_devices (active, expires_at);

create trigger kiosk_devices_updated_at
before update on public.kiosk_devices
for each row execute function public.set_updated_at();

alter table public.kiosk_devices enable row level security;

create policy "Managers can read kiosk devices"
on public.kiosk_devices for select
to authenticated
using (public.current_staff_role() = 'manager');

create policy "Managers can activate kiosk devices"
on public.kiosk_devices for insert
to authenticated
with check (
  public.current_staff_role() = 'manager'
  and activated_by = (public.current_staff_account()).id
);

create policy "Managers can revoke kiosk devices"
on public.kiosk_devices for update
to authenticated
using (public.current_staff_role() = 'manager')
with check (
  public.current_staff_role() = 'manager'
  and (
    active = true
    or (revoked_by = (public.current_staff_account()).id and revoked_at is not null)
  )
);

revoke all on public.kiosk_devices from anon, authenticated;
grant select, insert, update on public.kiosk_devices to authenticated;

create or replace function public.require_kiosk_device(candidate_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  device_id uuid;
begin
  if candidate_token is null or length(candidate_token) < 32 then
    raise exception 'Kiosk device access required';
  end if;

  update public.kiosk_devices
  set last_used_at = now()
  where token_hash = digest(candidate_token, 'sha256')
    and active = true
    and expires_at > now()
  returning id into device_id;

  if device_id is null then
    raise exception 'Kiosk device access required';
  end if;

  return device_id;
end;
$$;

revoke all on function public.require_kiosk_device(text) from public, anon, authenticated;

revoke execute on function public.get_kiosk_roster() from anon, authenticated;
revoke execute on function public.verify_kiosk_pin(text, text) from anon, authenticated;
revoke execute on function public.record_kiosk_clock_event(text, text, text, text) from anon, authenticated;

create or replace function public.get_device_kiosk_roster(device_token text)
returns table (
  staff_id text,
  display_name text,
  full_name text,
  employment_role text,
  current_status text,
  pin_ready boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.require_kiosk_device(device_token);
  return query select * from public.get_kiosk_roster();
end;
$$;

create or replace function public.verify_device_kiosk_pin(
  device_token text,
  target_staff_id text,
  candidate_pin text
)
returns table (ok boolean, code text, current_status text)
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

revoke all on function public.get_device_kiosk_roster(text) from public;
revoke all on function public.verify_device_kiosk_pin(text, text, text) from public;
revoke all on function public.record_device_kiosk_clock_event(text, text, text, text) from public;
grant execute on function public.get_device_kiosk_roster(text) to anon, authenticated;
grant execute on function public.verify_device_kiosk_pin(text, text, text) to anon, authenticated;
grant execute on function public.record_device_kiosk_clock_event(text, text, text, text) to anon, authenticated;

create or replace function public.set_staff_kiosk_pin(target_staff_id text, new_pin text)
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
    manager_account.id, false, 0, null
  )
  on conflict (staff_id) do update set
    pin_hash = excluded.pin_hash,
    pin_updated_at = excluded.pin_updated_at,
    pin_updated_by = excluded.pin_updated_by,
    pin_reset_required = false,
    failed_attempt_count = 0,
    locked_until = null;
end;
$$;
