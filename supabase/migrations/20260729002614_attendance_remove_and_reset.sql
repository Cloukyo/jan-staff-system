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
