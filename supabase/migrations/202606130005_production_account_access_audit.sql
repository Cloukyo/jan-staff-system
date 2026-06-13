create type public.account_access_action as enum (
  'prepared',
  'invited',
  'linked',
  'role_changed',
  'enabled',
  'disabled'
);

create table public.staff_account_access_audit (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references public.staff_accounts(id) on delete restrict,
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  action public.account_access_action not null,
  previous_role public.app_role,
  new_role public.app_role,
  performed_by uuid not null references public.staff_accounts(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index staff_account_access_audit_account_idx
on public.staff_account_access_audit (staff_account_id, created_at desc);

alter table public.staff_account_access_audit enable row level security;

create policy "Managers can read account access audit"
on public.staff_account_access_audit for select
to authenticated
using (public.current_staff_role() = 'manager');

create policy "Managers can create account access audit"
on public.staff_account_access_audit for insert
to authenticated
with check (
  public.current_staff_role() = 'manager'
  and performed_by = (public.current_staff_account()).id
);

grant select, insert on public.staff_account_access_audit to authenticated;

create or replace function public.link_staff_auth_user(
  p_account_id uuid,
  p_auth_user_id uuid,
  p_action public.account_access_action
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  manager_account public.staff_accounts;
  target_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if p_action not in ('invited', 'linked') then
    raise exception 'Invalid account link action';
  end if;

  select * into target_account
  from public.staff_accounts
  where id = p_account_id
  for update;

  if target_account.id is null then
    raise exception 'Account not found';
  end if;
  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'Auth user not found';
  end if;
  if exists (
    select 1 from public.staff_accounts
    where auth_user_id = p_auth_user_id and id <> p_account_id
  ) then
    raise exception 'Auth user already linked';
  end if;

  update public.staff_accounts
  set auth_user_id = p_auth_user_id,
      active = true,
      disabled_by = null,
      disabled_at = null
  where id = p_account_id;

  update public.staff_profiles
  set auth_user_id = p_auth_user_id,
      email = target_account.email
  where id = target_account.staff_id;

  insert into public.staff_account_access_audit (
    staff_account_id,
    staff_id,
    action,
    new_role,
    performed_by
  ) values (
    target_account.id,
    target_account.staff_id,
    p_action,
    target_account.role,
    manager_account.id
  );
end;
$$;

create or replace function public.set_staff_account_role(
  p_account_id uuid,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  manager_account public.staff_accounts;
  target_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  select * into target_account
  from public.staff_accounts
  where id = p_account_id
  for update;

  if target_account.id is null then
    raise exception 'Account not found';
  end if;
  if target_account.id = manager_account.id and p_role <> 'manager' then
    raise exception 'Cannot remove own manager access';
  end if;
  if target_account.role = p_role then
    return;
  end if;

  update public.staff_accounts set role = p_role where id = p_account_id;
  insert into public.staff_account_access_audit (
    staff_account_id,
    staff_id,
    action,
    previous_role,
    new_role,
    performed_by
  ) values (
    target_account.id,
    target_account.staff_id,
    'role_changed',
    target_account.role,
    p_role,
    manager_account.id
  );
end;
$$;

create or replace function public.set_staff_account_active(
  p_account_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  manager_account public.staff_accounts;
  target_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  select * into target_account
  from public.staff_accounts
  where id = p_account_id
  for update;

  if target_account.id is null then
    raise exception 'Account not found';
  end if;
  if target_account.id = manager_account.id and not p_active then
    raise exception 'Cannot disable current account';
  end if;

  update public.staff_accounts
  set active = p_active,
      disabled_by = case when p_active then null else manager_account.id end,
      disabled_at = case when p_active then null else now() end
  where id = p_account_id;

  insert into public.staff_account_access_audit (
    staff_account_id,
    staff_id,
    action,
    previous_role,
    new_role,
    performed_by
  ) values (
    target_account.id,
    target_account.staff_id,
    case when p_active then 'enabled' else 'disabled' end,
    target_account.role,
    target_account.role,
    manager_account.id
  );
end;
$$;

revoke all on function public.link_staff_auth_user(uuid, uuid, public.account_access_action) from public;
revoke all on function public.set_staff_account_role(uuid, public.app_role) from public;
revoke all on function public.set_staff_account_active(uuid, boolean) from public;
grant execute on function public.link_staff_auth_user(uuid, uuid, public.account_access_action) to authenticated;
grant execute on function public.set_staff_account_role(uuid, public.app_role) to authenticated;
grant execute on function public.set_staff_account_active(uuid, boolean) to authenticated;
