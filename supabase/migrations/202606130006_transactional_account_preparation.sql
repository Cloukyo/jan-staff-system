create or replace function public.prepare_staff_account(
  p_staff_id text,
  p_email text,
  p_role public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  manager_account public.staff_accounts;
  target_profile public.staff_profiles;
  new_account_id uuid;
  normalised_email text := lower(trim(p_email));
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  select * into target_profile
  from public.staff_profiles
  where id = p_staff_id and active = true
  for update;

  if target_profile.id is null then
    raise exception 'Active staff profile not found';
  end if;
  if normalised_email = '' then
    raise exception 'Email is required';
  end if;
  if exists (select 1 from public.staff_accounts where staff_id = p_staff_id) then
    raise exception 'Staff profile already has an account';
  end if;
  if exists (select 1 from public.staff_accounts where email = normalised_email) then
    raise exception 'Email already linked';
  end if;

  insert into public.staff_accounts (
    staff_id,
    full_name,
    email,
    role,
    active,
    access_granted_by,
    access_granted_at
  ) values (
    target_profile.id,
    target_profile.full_name,
    normalised_email,
    p_role,
    true,
    manager_account.id,
    now()
  )
  returning id into new_account_id;

  update public.staff_profiles
  set email = normalised_email
  where id = target_profile.id;

  insert into public.staff_account_access_audit (
    staff_account_id,
    staff_id,
    action,
    new_role,
    performed_by
  ) values (
    new_account_id,
    target_profile.id,
    'prepared',
    p_role,
    manager_account.id
  );

  return new_account_id;
end;
$$;

revoke all on function public.prepare_staff_account(text, text, public.app_role) from public;
grant execute on function public.prepare_staff_account(text, text, public.app_role) to authenticated;
