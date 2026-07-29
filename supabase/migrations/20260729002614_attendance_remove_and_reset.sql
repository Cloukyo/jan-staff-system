create or replace function public.remove_clock_event_from_hours(
  target_staff_id text,
  target_date date,
  target_event_id uuid,
  reason text,
  expected_revision text,
  operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  selected_event record;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if nullif(trim(target_staff_id), '') is null or target_date is null then
    raise exception 'Choose a staff member and date';
  end if;
  if target_event_id is null or expected_revision is null or operation_id is null then
    raise exception 'Reload attendance and review the removal again';
  end if;
  if reason is null or length(trim(reason)) < 5 then
    raise exception 'Enter a correction reason of at least five characters';
  end if;
  if not exists (
    select 1
    from public.staff_profiles profile
    where profile.id = target_staff_id
  ) then
    raise exception 'The staff member does not exist';
  end if;

  perform public.lock_attendance_staff_writes(target_staff_id);

  if exists (
    select 1
    from public.clock_event_corrections correction
    where correction.batch_id = operation_id
  ) then
    return operation_id;
  end if;

  if public.get_attendance_event_revision(target_staff_id, target_date)
    is distinct from expected_revision then
    raise exception using
      errcode = '40001',
      message = 'Attendance changed after this preview';
  end if;

  select event.*
  into selected_event
  from public.get_effective_clock_events(
    target_date,
    target_date,
    target_staff_id
  ) event
  where event.event_id = target_event_id;

  if not found then
    raise exception 'The effective clock event no longer exists';
  end if;

  insert into public.clock_event_corrections (
    id,
    batch_id,
    correction_role,
    staff_id,
    correction_kind,
    original_event_id,
    supersedes_correction_id,
    event_type,
    event_timestamp,
    recorded_date,
    reason,
    created_by
  )
  values (
    operation_id,
    operation_id,
    'primary',
    target_staff_id,
    'exclude',
    case
      when selected_event.correction_id is null then selected_event.event_id
      else null
    end,
    selected_event.correction_id,
    null,
    null,
    target_date,
    trim(reason),
    manager_account.id
  );

  return operation_id;
end;
$$;

revoke all on function public.remove_clock_event_from_hours(
  text,
  date,
  uuid,
  text,
  text,
  uuid
)
from public, anon, authenticated;
grant execute on function public.remove_clock_event_from_hours(
  text,
  date,
  uuid,
  text,
  text,
  uuid
)
to authenticated;

create or replace function public.reset_attendance_to_planned_hours(
  target_staff_id text,
  target_date date,
  reason text,
  expected_revision text,
  operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  planned_start time;
  planned_finish time;
  planned_start_at timestamptz;
  planned_finish_at timestamptz;
  effective_events jsonb;
  correction_actions jsonb;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if nullif(trim(target_staff_id), '') is null or target_date is null then
    raise exception 'Choose a staff member and date';
  end if;
  if expected_revision is null or operation_id is null then
    raise exception 'Reload attendance and review the reset again';
  end if;
  if reason is null or length(trim(reason)) < 5 then
    raise exception 'Enter a correction reason of at least five characters';
  end if;
  if not exists (
    select 1
    from public.staff_profiles profile
    where profile.id = target_staff_id
  ) then
    raise exception 'The staff member does not exist';
  end if;

  perform public.lock_attendance_staff_writes(target_staff_id);

  if exists (
    select 1
    from public.clock_event_corrections correction
    where correction.batch_id = operation_id
  ) then
    return operation_id;
  end if;

  if public.get_attendance_event_revision(target_staff_id, target_date)
    is distinct from expected_revision then
    raise exception using
      errcode = '40001',
      message = 'Attendance changed after this preview';
  end if;

  perform 1
  from public.rota_shifts rs
  join public.rota_weeks rw on rw.id = rs.rota_week_id
  where rs.staff_id = target_staff_id
    and rs.shift_date = target_date
    and rs.archived_at is null
    and rs.status <> 'cancelled'
    and rw.status = 'published'
  for update of rs, rw;

  select min(rs.start_time), max(rs.end_time)
  into planned_start, planned_finish
  from public.rota_shifts rs
  join public.rota_weeks rw on rw.id = rs.rota_week_id
  where rs.staff_id = target_staff_id
    and rs.shift_date = target_date
    and rs.archived_at is null
    and rs.status <> 'cancelled'
    and rw.status = 'published';

  if planned_start is null or planned_finish is null then
    raise exception 'No published rota shift exists for this staff date';
  end if;

  planned_start_at :=
    (target_date + planned_start)::timestamp at time zone 'Europe/London';
  planned_finish_at :=
    (target_date + planned_finish)::timestamp at time zone 'Europe/London';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', gen_random_uuid(),
        'correction_kind', 'exclude',
        'original_event_id',
          case when event.correction_id is null then event.event_id else null end,
        'supersedes_correction_id', event.correction_id,
        'event_type', null,
        'event_timestamp', null
      )
      order by event.event_timestamp, event.event_order_key, event.event_id
    ),
    '[]'::jsonb
  )
  into effective_events
  from public.get_effective_clock_events(
    target_date,
    target_date,
    target_staff_id
  ) event;

  correction_actions := effective_events || jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid(),
      'correction_kind', 'add',
      'original_event_id', null,
      'supersedes_correction_id', null,
      'event_type', 'clock_in',
      'event_timestamp', planned_start_at
    ),
    jsonb_build_object(
      'id', gen_random_uuid(),
      'correction_kind', 'add',
      'original_event_id', null,
      'supersedes_correction_id', null,
      'event_type', 'clock_out',
      'event_timestamp', planned_finish_at
    )
  );

  insert into public.clock_event_corrections (
    id,
    batch_id,
    correction_role,
    staff_id,
    correction_kind,
    original_event_id,
    supersedes_correction_id,
    event_type,
    event_timestamp,
    recorded_date,
    reason,
    created_by
  )
  select
    (action.item ->> 'id')::uuid,
    operation_id,
    case when action.ordinal = 1 then 'primary' else 'consequential' end,
    target_staff_id,
    action.item ->> 'correction_kind',
    nullif(action.item ->> 'original_event_id', '')::uuid,
    nullif(action.item ->> 'supersedes_correction_id', '')::uuid,
    action.item ->> 'event_type',
    nullif(action.item ->> 'event_timestamp', '')::timestamptz,
    target_date,
    trim(reason),
    manager_account.id
  from jsonb_array_elements(correction_actions)
    with ordinality as action(item, ordinal)
  order by action.ordinal;

  return operation_id;
end;
$$;

revoke all on function public.reset_attendance_to_planned_hours(
  text,
  date,
  text,
  text,
  uuid
)
from public, anon, authenticated;
grant execute on function public.reset_attendance_to_planned_hours(
  text,
  date,
  text,
  text,
  uuid
)
to authenticated;
