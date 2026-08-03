create or replace function public.get_manager_hours_preview(range_start date, range_end date)
returns table (
  staff_id text,
  display_name text,
  full_name text,
  completed_minutes integer,
  open_shift_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  manager_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if range_start is null or range_end is null or range_start > range_end then
    raise exception 'Choose a valid date range';
  end if;

  return query
  with active_staff as (
    select
      profile.id,
      coalesce(nullif(trim(profile.display_name), ''), profile.full_name) as display_name,
      profile.full_name
    from public.staff_profiles profile
    where profile.active = true
  ),
  ordered as (
    select
      ce.staff_id,
      ce.event_type,
      ce.event_timestamp,
      lead(ce.event_type) over (partition by ce.staff_id order by ce.event_timestamp, ce.created_at) as next_event_type,
      lead(ce.event_timestamp) over (partition by ce.staff_id order by ce.event_timestamp, ce.created_at) as next_event_timestamp
    from public.clock_events ce
    join active_staff staff on staff.id = ce.staff_id
    where ce.recorded_date between range_start and range_end
  ),
  totals as (
    select
      ordered.staff_id,
      coalesce(sum(
        case
          when ordered.event_type = 'clock_in'
            and ordered.next_event_type = 'clock_out'
            and ordered.next_event_timestamp >= ordered.event_timestamp
          then round(extract(epoch from (ordered.next_event_timestamp - ordered.event_timestamp)) / 60)::integer
          else 0
        end
      ), 0)::integer as completed_minutes,
      count(*) filter (where ordered.event_type = 'clock_in' and ordered.next_event_type is null)::integer as open_shift_count
    from ordered
    group by ordered.staff_id
  )
  select
    staff.id,
    staff.display_name,
    staff.full_name,
    coalesce(totals.completed_minutes, 0),
    coalesce(totals.open_shift_count, 0)
  from active_staff staff
  left join totals on totals.staff_id = staff.id
  order by staff.full_name;
end;
$$;

revoke all on function public.get_manager_hours_preview(date, date) from public, anon, authenticated;
grant execute on function public.get_manager_hours_preview(date, date) to authenticated;
