create or replace function public.set_staff_profile_active(
  p_staff_id text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  manager_account public.staff_accounts;
  target_profile public.staff_profiles;
  target_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  select * into target_profile
  from public.staff_profiles
  where id = p_staff_id
  for update;

  if target_profile.id is null then
    raise exception 'Staff profile not found';
  end if;

  if not p_active and manager_account.staff_id = p_staff_id then
    raise exception 'You cannot deactivate the account currently in use';
  end if;

  update public.staff_profiles
  set active = p_active,
      updated_at = now()
  where id = p_staff_id;

  if not p_active then
    select * into target_account
    from public.staff_accounts
    where staff_id = p_staff_id
    for update;

    if target_account.id is not null and target_account.active then
      update public.staff_accounts
      set active = false,
          disabled_by = manager_account.id,
          disabled_at = now()
      where id = target_account.id;

      insert into public.staff_account_access_audit (
        staff_account_id,
        staff_id,
        action,
        previous_role,
        new_role,
        performed_by
      ) values (
        target_account.id,
        p_staff_id,
        'disabled',
        target_account.role,
        target_account.role,
        manager_account.id
      );
    end if;

    update public.staff_kiosk_settings
    set kiosk_enabled = false
    where staff_id = p_staff_id;
  end if;
end;
$$;

revoke all on function public.set_staff_profile_active(text, boolean)
from public, anon, authenticated;

grant execute on function public.set_staff_profile_active(text, boolean) to authenticated;
