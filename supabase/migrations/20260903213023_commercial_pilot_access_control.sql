-- Controlled commercial pilot access.
-- Email addresses are normalised and HMACed by the application. The key and
-- plaintext address never enter the database.

create table private.commercial_pilot_access_config (
  singleton boolean primary key default true check (singleton),
  pilot_gate_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into private.commercial_pilot_access_config (singleton, pilot_gate_enabled)
values (true, false)
on conflict (singleton) do nothing;

create table private.commercial_pilot_access_grants (
  id uuid primary key default gen_random_uuid(),
  email_hmac text not null unique check (email_hmac ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  reservation_id uuid,
  reservation_expires_at timestamptz,
  reserved_auth_user_id uuid references auth.users(id) on delete restrict,
  reserved_at timestamptz,
  consumed_at timestamptz,
  consumed_organisation_id uuid references public.organisations(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reservation_id is null) = (reservation_expires_at is null)),
  check ((reserved_auth_user_id is null) = (reserved_at is null)),
  check ((consumed_at is null) = (consumed_organisation_id is null))
);

create unique index commercial_pilot_access_one_grant_per_auth_user
  on private.commercial_pilot_access_grants (reserved_auth_user_id)
  where reserved_auth_user_id is not null;

revoke all on private.commercial_pilot_access_config,
  private.commercial_pilot_access_grants
  from public, anon, authenticated, service_role;

create or replace function private.commercial_pilot_gate_is_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select config.pilot_gate_enabled
    from private.commercial_pilot_access_config config
    where config.singleton
  ), false)
$$;

create or replace function public.configure_commercial_pilot_gate(enabled boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.commercial_pilot_access_config (
    singleton,
    pilot_gate_enabled,
    updated_at
  ) values (true, enabled, now())
  on conflict (singleton) do update
  set pilot_gate_enabled = excluded.pilot_gate_enabled,
      updated_at = excluded.updated_at;
  return case when enabled then 'enabled' else 'disabled' end;
end
$$;

create or replace function public.grant_commercial_pilot_access(
  email_hmac_value text,
  expires_at_value timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
begin
  if email_hmac_value !~ '^[a-f0-9]{64}$' or expires_at_value is null then
    return 'invalid_request';
  end if;

  insert into private.commercial_pilot_access_grants (
    email_hmac,
    expires_at
  ) values (
    email_hmac_value,
    expires_at_value
  )
  on conflict (email_hmac) do update
  set expires_at = excluded.expires_at,
      revoked_at = null,
      reservation_id = null,
      reservation_expires_at = null,
      reserved_auth_user_id = null,
      reserved_at = null,
      updated_at = now()
  where private.commercial_pilot_access_grants.consumed_at is null
  returning id into grant_id;

  return case when grant_id is null then 'unavailable' else 'granted' end;
end
$$;

create or replace function public.revoke_commercial_pilot_access(
  email_hmac_value text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
begin
  update private.commercial_pilot_access_grants
  set revoked_at = now(),
      reservation_id = null,
      reservation_expires_at = null,
      updated_at = now()
  where email_hmac = email_hmac_value
    and consumed_at is null
  returning id into grant_id;

  return case when grant_id is null then 'not_found' else 'revoked' end;
end
$$;

create or replace function public.reserve_commercial_pilot_access(
  email_hmac_value text,
  signup_attempt_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
begin
  if not private.commercial_pilot_gate_is_enabled() then
    return 'gate_disabled';
  end if;
  if email_hmac_value !~ '^[a-f0-9]{64}$' or signup_attempt_id is null then
    return 'invalid_request';
  end if;

  update private.commercial_pilot_access_grants
  set reservation_id = signup_attempt_id,
      reservation_expires_at = now() + interval '15 minutes',
      updated_at = now()
  where email_hmac = email_hmac_value
    and revoked_at is null
    and consumed_at is null
    and reserved_auth_user_id is null
    and expires_at > now()
    and (
      reservation_id is null
      or reservation_expires_at <= now()
      or reservation_id = signup_attempt_id
    )
  returning id into grant_id;

  return case when grant_id is null then 'unavailable' else 'reserved' end;
end
$$;

create or replace function public.release_commercial_pilot_access(
  email_hmac_value text,
  signup_attempt_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
begin
  update private.commercial_pilot_access_grants
  set reservation_id = null,
      reservation_expires_at = null,
      updated_at = now()
  where email_hmac = email_hmac_value
    and reservation_id = signup_attempt_id
    and reserved_auth_user_id is null
    and consumed_at is null
  returning id into grant_id;

  return case when grant_id is null then 'not_released' else 'released' end;
end
$$;

create or replace function public.bind_commercial_pilot_access(
  email_hmac_value text,
  signup_attempt_id uuid,
  auth_user_id_value uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
begin
  if not exists (
    select 1 from auth.users users where users.id = auth_user_id_value
  ) then
    return 'auth_user_missing';
  end if;

  update private.commercial_pilot_access_grants
  set reserved_auth_user_id = auth_user_id_value,
      reserved_at = now(),
      updated_at = now()
  where email_hmac = email_hmac_value
    and reservation_id = signup_attempt_id
    and reservation_expires_at > now()
    and revoked_at is null
    and consumed_at is null
    and reserved_auth_user_id is null
    and expires_at > now()
  returning id into grant_id;

  return case when grant_id is null then 'unavailable' else 'bound' end;
end
$$;

create or replace function private.require_commercial_pilot_for_go_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
begin
  if old.operational_state <> 'live'
     and new.operational_state = 'live'
     and private.commercial_pilot_gate_is_enabled() then
    update private.commercial_pilot_access_grants
    set consumed_at = now(),
        consumed_organisation_id = new.id,
        updated_at = now()
    where reserved_auth_user_id = auth.uid()
      and revoked_at is null
      and consumed_at is null
      and expires_at > now()
    returning id into grant_id;

    if grant_id is null then
      raise exception 'organisation Go Live requires active pilot access'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger organisations_require_commercial_pilot
before update of operational_state on public.organisations
for each row execute function private.require_commercial_pilot_for_go_live();

revoke all on function private.commercial_pilot_gate_is_enabled(),
  private.require_commercial_pilot_for_go_live(),
  public.configure_commercial_pilot_gate(boolean),
  public.grant_commercial_pilot_access(text, timestamptz),
  public.revoke_commercial_pilot_access(text),
  public.reserve_commercial_pilot_access(text, uuid),
  public.release_commercial_pilot_access(text, uuid),
  public.bind_commercial_pilot_access(text, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.configure_commercial_pilot_gate(boolean),
  public.grant_commercial_pilot_access(text, timestamptz),
  public.revoke_commercial_pilot_access(text),
  public.reserve_commercial_pilot_access(text, uuid),
  public.release_commercial_pilot_access(text, uuid),
  public.bind_commercial_pilot_access(text, uuid, uuid)
  to service_role;
