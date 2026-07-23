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
