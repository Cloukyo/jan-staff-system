do $$
declare
  inconsistent_active_accounts bigint;
  inconsistent_kiosk_settings bigint;
begin
  select count(*)
  into inconsistent_active_accounts
  from public.staff_profiles profile
  join public.staff_accounts account on account.staff_id = profile.id
  where profile.active is not true
    and account.active is true;

  select count(*)
  into inconsistent_kiosk_settings
  from public.staff_profiles profile
  join public.staff_kiosk_settings kiosk on kiosk.staff_id = profile.id
  where profile.active is not true
    and kiosk.kiosk_enabled is true;

  if inconsistent_active_accounts > 0 or inconsistent_kiosk_settings > 0 then
    raise exception 'Staff lifecycle migration is blocked until inconsistent access is remediated. Found % active account link(s) and % kiosk access setting(s) for inactive staff profiles.',
      inconsistent_active_accounts,
      inconsistent_kiosk_settings;
  end if;
end;
$$;

revoke update on table public.staff_profiles from authenticated;

grant update (
  full_name,
  display_name,
  employment_role,
  main_qualification_level,
  is_apprentice,
  is_cover_staff,
  appointment_date,
  email,
  notes,
  updated_at
) on table public.staff_profiles to authenticated;

revoke insert, update on table public.staff_accounts from authenticated;

create or replace function public.ensure_staff_account_profile_is_active()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  linked_profile_active boolean;
begin
  if new.active is true then
    select active
    into linked_profile_active
    from public.staff_profiles
    where id = new.staff_id;

    if linked_profile_active is not true then
      raise exception 'Reactivate the staff profile before enabling login.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists staff_accounts_require_active_profile on public.staff_accounts;

create trigger staff_accounts_require_active_profile
before insert or update of active, staff_id on public.staff_accounts
for each row
execute function public.ensure_staff_account_profile_is_active();
