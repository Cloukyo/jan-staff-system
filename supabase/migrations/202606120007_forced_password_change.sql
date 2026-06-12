alter table public.staff_accounts
  add column must_change_password boolean not null default false;

create or replace function public.complete_required_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_accounts
  set must_change_password = false
  where auth_user_id = auth.uid()
    and active = true;

  if not found then
    raise exception 'Active staff account not found';
  end if;
end;
$$;

revoke all on function public.complete_required_password_change() from public, anon, authenticated;
grant execute on function public.complete_required_password_change() to authenticated;
