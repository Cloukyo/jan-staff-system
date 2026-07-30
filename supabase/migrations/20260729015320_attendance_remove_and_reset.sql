create table public.attendance_operation_requests (
  operation_id uuid primary key,
  operation_kind text not null check (operation_kind in ('remove', 'reset')),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  recorded_date date not null,
  target_event_id uuid,
  reason text not null,
  expected_revision text not null,
  expected_planned_start time,
  expected_planned_finish time,
  created_at timestamptz not null default now(),
  constraint attendance_operation_request_target check (
    (
      operation_kind = 'remove'
      and target_event_id is not null
      and expected_planned_start is null
      and expected_planned_finish is null
    )
    or (
      operation_kind = 'reset'
      and target_event_id is null
      and expected_planned_start is not null
      and expected_planned_finish is not null
    )
  )
);

alter table public.attendance_operation_requests enable row level security;
revoke all on public.attendance_operation_requests from public, anon, authenticated;

create or replace function public.lock_attendance_operation(target_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_operation_id is null then
    raise exception 'An attendance operation ID is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('attendance-operation:' || target_operation_id::text, 0)
  );
end;
$$;

revoke all on function public.lock_attendance_operation(uuid)
from public, anon, authenticated;

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
  existing_request public.attendance_operation_requests;
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

  perform public.lock_attendance_operation(operation_id);
  perform public.lock_attendance_staff_writes(target_staff_id);

  select request.*
  into existing_request
  from public.attendance_operation_requests request
  where request.operation_id = remove_clock_event_from_hours.operation_id;

  if found then
    if existing_request.operation_kind = 'remove'
      and existing_request.staff_id = target_staff_id
      and existing_request.recorded_date = target_date
      and existing_request.target_event_id = target_event_id
      and existing_request.reason = trim(reason)
      and existing_request.expected_revision = expected_revision then
      return operation_id;
    end if;

    raise exception 'Operation ID is already used for a different attendance operation';
  end if;

  if exists (
    select 1
    from public.clock_event_corrections correction
    where correction.batch_id = operation_id
  ) then
    raise exception 'Operation ID is already used for a different attendance operation';
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

  insert into public.attendance_operation_requests (
    operation_id,
    operation_kind,
    staff_id,
    recorded_date,
    target_event_id,
    reason,
    expected_revision
  )
  values (
    operation_id,
    'remove',
    target_staff_id,
    target_date,
    target_event_id,
    trim(reason),
    expected_revision
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
  operation_id uuid,
  expected_planned_start time,
  expected_planned_finish time
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  existing_request public.attendance_operation_requests;
  published_rota_week_id uuid;
  planned_start time;
  planned_finish time;
  planned_start_at timestamptz;
  planned_finish_at timestamptz;
  planned_start_match_count integer;
  planned_finish_match_count integer;
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
  if expected_revision is null
    or operation_id is null
    or expected_planned_start is null
    or expected_planned_finish is null then
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

  perform public.lock_attendance_operation(operation_id);
  perform public.lock_attendance_staff_writes(target_staff_id);

  select request.*
  into existing_request
  from public.attendance_operation_requests request
  where request.operation_id = reset_attendance_to_planned_hours.operation_id;

  if found then
    if existing_request.operation_kind = 'reset'
      and existing_request.staff_id = target_staff_id
      and existing_request.recorded_date = target_date
      and existing_request.target_event_id is null
      and existing_request.reason = trim(reason)
      and existing_request.expected_revision = expected_revision
      and existing_request.expected_planned_start = expected_planned_start
      and existing_request.expected_planned_finish = expected_planned_finish then
      return operation_id;
    end if;

    raise exception 'Operation ID is already used for a different attendance operation';
  end if;

  if exists (
    select 1
    from public.clock_event_corrections correction
    where correction.batch_id = operation_id
  ) then
    raise exception 'Operation ID is already used for a different attendance operation';
  end if;

  if public.get_attendance_event_revision(target_staff_id, target_date)
    is distinct from expected_revision then
    raise exception using
      errcode = '40001',
      message = 'Attendance changed after this preview';
  end if;

  select rw.id
  into published_rota_week_id
  from public.rota_weeks rw
  where target_date between rw.week_start_date and rw.week_start_date + 6
    and rw.status = 'published'
  order by rw.week_start_date desc
  limit 1
  for update;

  if published_rota_week_id is null then
    raise exception 'No published rota shift exists for this staff date';
  end if;

  perform 1
  from public.rota_shifts rs
  where rs.rota_week_id = published_rota_week_id
    and rs.staff_id = target_staff_id
    and rs.shift_date = target_date
    and rs.archived_at is null
    and rs.status <> 'cancelled'
  for update;

  select min(rs.start_time), max(rs.end_time)
  into planned_start, planned_finish
  from public.rota_shifts rs
  where rs.rota_week_id = published_rota_week_id
    and rs.staff_id = target_staff_id
    and rs.shift_date = target_date
    and rs.archived_at is null
    and rs.status <> 'cancelled';

  if planned_start is null or planned_finish is null then
    raise exception 'No published rota shift exists for this staff date';
  end if;

  if planned_start is distinct from expected_planned_start
    or planned_finish is distinct from expected_planned_finish then
    raise exception using
      errcode = '40001',
      message = 'Published planned hours changed after this preview';
  end if;

  planned_start_at :=
    (target_date + planned_start)::timestamp at time zone 'Europe/London';
  planned_finish_at :=
    (target_date + planned_finish)::timestamp at time zone 'Europe/London';

  select count(*)
  into planned_start_match_count
  from (
    values
      (planned_start_at - interval '1 hour'),
      (planned_start_at),
      (planned_start_at + interval '1 hour')
  ) as candidates(candidate_at)
  where candidate_at at time zone 'Europe/London'
    = (target_date + planned_start)::timestamp;

  select count(*)
  into planned_finish_match_count
  from (
    values
      (planned_finish_at - interval '1 hour'),
      (planned_finish_at),
      (planned_finish_at + interval '1 hour')
  ) as candidates(candidate_at)
  where candidate_at at time zone 'Europe/London'
    = (target_date + planned_finish)::timestamp;

  if planned_start_match_count <> 1 or planned_finish_match_count <> 1 then
    raise exception 'A published rota boundary is affected by a UK clock change. Correct the published rota time before resetting attendance';
  end if;

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

  insert into public.attendance_operation_requests (
    operation_id,
    operation_kind,
    staff_id,
    recorded_date,
    target_event_id,
    reason,
    expected_revision,
    expected_planned_start,
    expected_planned_finish
  )
  values (
    operation_id,
    'reset',
    target_staff_id,
    target_date,
    null,
    trim(reason),
    expected_revision,
    expected_planned_start,
    expected_planned_finish
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
  uuid,
  time,
  time
)
from public, anon, authenticated;
grant execute on function public.reset_attendance_to_planned_hours(
  text,
  date,
  text,
  text,
  uuid,
  time,
  time
)
to authenticated;
