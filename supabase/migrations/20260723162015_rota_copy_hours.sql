create or replace function public.copy_staff_previous_day_pattern(
  target_week_id uuid,
  target_staff_id text,
  target_shift_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  target_week public.rota_weeks;
  source_date date := target_shift_date - 1;
  source_count integer;
  archived_count integer;
  created_count integer;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then raise exception 'Manager access required'; end if;

  select * into target_week
  from public.rota_weeks
  where id = target_week_id;
  if not found then raise exception 'Rota week not found'; end if;
  if target_week.status <> 'draft' then raise exception 'Hours can only be copied in a draft rota'; end if;
  if target_shift_date not between target_week.week_start_date and target_week.week_start_date + 6
    or source_date not between target_week.week_start_date and target_week.week_start_date + 6 then
    raise exception 'The previous day must be in the same rota week';
  end if;

  select count(*) into source_count
  from public.rota_shifts
  where rota_week_id = target_week_id
    and staff_id = target_staff_id
    and shift_date = source_date
    and archived_at is null
    and status <> 'cancelled';

  update public.rota_shifts
  set archived_at = now(),
      archived_by = manager_account.id,
      updated_by = manager_account.id
  where rota_week_id = target_week_id
    and staff_id = target_staff_id
    and shift_date = target_shift_date
    and archived_at is null;
  get diagnostics archived_count = row_count;

  insert into public.rota_shifts (
    rota_week_id,
    staff_id,
    shift_date,
    start_time,
    end_time,
    break_minutes,
    break_unspecified,
    status,
    created_by,
    updated_by
  )
  select
    target_week_id,
    target_staff_id,
    target_shift_date,
    source.start_time,
    source.end_time,
    source.break_minutes,
    source.break_unspecified,
    'scheduled',
    manager_account.id,
    manager_account.id
  from public.rota_shifts source
  where source.rota_week_id = target_week_id
    and source.staff_id = target_staff_id
    and source.shift_date = source_date
    and source.archived_at is null
    and source.status <> 'cancelled'
  order by source.start_time;
  get diagnostics created_count = row_count;

  return jsonb_build_object(
    'mode', case when source_count = 0 then 'not_working' else 'copied' end,
    'days_updated', 1,
    'shifts_archived', archived_count,
    'shifts_created', created_count
  );
end;
$$;

revoke all on function public.copy_staff_previous_day_pattern(uuid, text, date) from public;
grant execute on function public.copy_staff_previous_day_pattern(uuid, text, date) to authenticated;

create or replace function public.copy_shift_hours_to_days(
  source_shift_id uuid,
  target_shift_dates date[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  source_shift public.rota_shifts;
  target_week public.rota_weeks;
  target_count integer;
  archived_count integer;
  created_count integer;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then raise exception 'Manager access required'; end if;

  select * into source_shift
  from public.rota_shifts
  where id = source_shift_id
    and archived_at is null
    and status <> 'cancelled';
  if not found then raise exception 'Source shift not found'; end if;

  select * into target_week
  from public.rota_weeks
  where id = source_shift.rota_week_id;
  if not found then raise exception 'Rota week not found'; end if;
  if target_week.status <> 'draft' then raise exception 'Hours can only be copied in a draft rota'; end if;
  if coalesce(cardinality(target_shift_dates), 0) = 0 then
    raise exception 'Choose at least one target day';
  end if;
  if exists (
    select 1
    from unnest(target_shift_dates) as dates(target_date)
    where target_date <= source_shift.shift_date
      or target_date not between target_week.week_start_date and target_week.week_start_date + 6
  ) then
    raise exception 'Target days must be later in the same rota week';
  end if;

  select count(distinct target_date) into target_count
  from unnest(target_shift_dates) as dates(target_date);

  update public.rota_shifts
  set archived_at = now(),
      archived_by = manager_account.id,
      updated_by = manager_account.id
  where rota_week_id = source_shift.rota_week_id
    and staff_id = source_shift.staff_id
    and shift_date = any(target_shift_dates)
    and archived_at is null;
  get diagnostics archived_count = row_count;

  insert into public.rota_shifts (
    rota_week_id,
    staff_id,
    shift_date,
    start_time,
    end_time,
    break_minutes,
    break_unspecified,
    status,
    created_by,
    updated_by
  )
  select
    source_shift.rota_week_id,
    source_shift.staff_id,
    target_date,
    source_shift.start_time,
    source_shift.end_time,
    source_shift.break_minutes,
    source_shift.break_unspecified,
    'scheduled',
    manager_account.id,
    manager_account.id
  from (
    select distinct target_date
    from unnest(target_shift_dates) as dates(target_date)
  ) targets;
  get diagnostics created_count = row_count;

  return jsonb_build_object(
    'mode', 'copied',
    'days_updated', target_count,
    'shifts_archived', archived_count,
    'shifts_created', created_count
  );
end;
$$;

revoke all on function public.copy_shift_hours_to_days(uuid, date[]) from public;
grant execute on function public.copy_shift_hours_to_days(uuid, date[]) to authenticated;
