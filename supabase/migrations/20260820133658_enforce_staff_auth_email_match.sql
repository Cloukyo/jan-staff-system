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
  auth_email text;
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

  select email into auth_email
  from auth.users
  where id = p_auth_user_id;

  if not found then
    raise exception 'Auth user not found';
  end if;
  if auth_email is null or lower(trim(auth_email)) <> lower(trim(target_account.email)) then
    raise exception 'Auth user email does not match account record';
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

revoke all on function public.link_staff_auth_user(uuid, uuid, public.account_access_action) from public, anon, authenticated;
grant execute on function public.link_staff_auth_user(uuid, uuid, public.account_access_action) to authenticated;
