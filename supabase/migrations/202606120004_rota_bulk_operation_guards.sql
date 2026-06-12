create or replace function public.copy_previous_rota_week(target_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  source_week public.rota_weeks;
  target_week public.rota_weeks;
  copied_count integer;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then raise exception 'Manager access required'; end if;
  if extract(isodow from target_week_start) <> 1 then raise exception 'Week must start on Monday'; end if;

  select * into source_week from public.rota_weeks
  where week_start_date = target_week_start - 7 and status <> 'archived';
  if not found then raise exception 'Previous rota week does not exist'; end if;

  select * into target_week from public.rota_weeks
  where week_start_date = target_week_start and status <> 'archived';
  if found and target_week.status <> 'draft' then
    raise exception 'Previous week can only be copied into a draft rota';
  end if;
  if not found then
    insert into public.rota_weeks (week_start_date, status, title, created_by, updated_by)
    values (target_week_start, 'draft', 'Copied from previous week', manager_account.id, manager_account.id)
    returning * into target_week;
  end if;

  insert into public.rota_shifts (
    rota_week_id, staff_id, shift_date, start_time, end_time, break_minutes,
    room_or_area, role_on_shift, notes, status, created_by, updated_by
  )
  select
    target_week.id, rs.staff_id, rs.shift_date + 7, rs.start_time, rs.end_time,
    rs.break_minutes, rs.room_or_area, rs.role_on_shift, rs.notes, 'scheduled',
    manager_account.id, manager_account.id
  from public.rota_shifts rs
  where rs.rota_week_id = source_week.id
    and rs.archived_at is null
    and rs.status <> 'cancelled'
    and not exists (
      select 1 from public.rota_shifts existing
      where existing.rota_week_id = target_week.id
        and existing.staff_id = rs.staff_id
        and existing.shift_date = rs.shift_date + 7
        and existing.start_time = rs.start_time
        and existing.end_time = rs.end_time
        and existing.archived_at is null
        and existing.status <> 'cancelled'
    );
  get diagnostics copied_count = row_count;
  return jsonb_build_object('week_id', target_week.id, 'copied_shifts', copied_count);
end;
$$;

revoke all on function public.copy_previous_rota_week(date) from public;
grant execute on function public.copy_previous_rota_week(date) to authenticated;
