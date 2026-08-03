create table public.attendance_exception_operations (
  operation_id uuid primary key,
  exception_id uuid not null references public.attendance_exceptions(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('resolve', 'dismiss')),
  expected_revision text not null check (length(expected_revision) > 0),
  reason text not null check (length(trim(reason)) >= 5),
  request_fingerprint text not null check (length(request_fingerprint) > 0),
  created_by uuid not null references public.staff_accounts(id) on delete restrict,
  correction_batch_id uuid,
  safe_response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint attendance_exception_operation_completion check (
    (completed_at is null and safe_response is null and correction_batch_id is null)
    or (completed_at is not null and safe_response is not null)
  ),
  constraint attendance_exception_operation_correction check (
    operation_kind = 'resolve' or correction_batch_id is null
  )
);

create index attendance_exception_operations_exception_idx
on public.attendance_exception_operations (exception_id, created_at, operation_id);

create index attendance_exception_operations_created_by_idx
on public.attendance_exception_operations (created_by, created_at desc);

alter table public.attendance_exception_operations enable row level security;
revoke all on public.attendance_exception_operations from public, anon, authenticated;

create or replace function public.prevent_attendance_exception_duplicate_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.attendance_exceptions existing
    where existing.staff_id = new.staff_id
      and existing.operational_date = new.operational_date
      and existing.exception_type = new.exception_type
      and existing.anomaly_fingerprint = new.anomaly_fingerprint
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_attendance_exception_duplicate_history()
from public, anon, authenticated;

create trigger attendance_exception_duplicate_history_guard
before insert on public.attendance_exceptions
for each row execute function public.prevent_attendance_exception_duplicate_history();

create or replace function public.resolve_attendance_exception(
  target_exception_id uuid,
  correction_plan jsonb,
  reason text,
  expected_revision text,
  operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  manager_account public.staff_accounts;
  issue public.attendance_exceptions%rowtype;
  existing_operation public.attendance_exception_operations%rowtype;
  current_revision text;
  batch_id uuid;
  fingerprint text;
  response_value jsonb;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if target_exception_id is null or operation_id is null
    or expected_revision is null or correction_plan is null then
    raise exception 'Reload the attendance issue and review the correction again';
  end if;
  if reason is null or length(trim(reason)) < 5 then
    raise exception using errcode = '23514',
      message = 'Enter a resolution reason of at least five characters';
  end if;
  if nullif(correction_plan -> 'primary' ->> 'id', '')::uuid
    is distinct from operation_id then
    raise exception 'The correction operation ID does not match the correction plan';
  end if;

  fingerprint := encode(digest(
    concat_ws('|', 'resolve', target_exception_id, expected_revision,
      trim(reason), correction_plan::text),
    'sha256'
  ), 'hex');

  perform public.lock_attendance_operation(operation_id);
  select operation.* into existing_operation
  from public.attendance_exception_operations operation
  where operation.operation_id = resolve_attendance_exception.operation_id;
  if found then
    if existing_operation.exception_id = target_exception_id
      and existing_operation.operation_kind = 'resolve'
      and existing_operation.expected_revision = expected_revision
      and existing_operation.reason = trim(reason)
      and existing_operation.request_fingerprint = fingerprint
      and existing_operation.completed_at is not null then
      return existing_operation.safe_response;
    end if;
    raise exception 'Operation ID is already used for a different attendance decision';
  end if;

  select * into issue
  from public.attendance_exceptions
  where id = target_exception_id;
  if not found or issue.status not in ('open', 'under_review') then
    raise exception 'The attendance exception is no longer available';
  end if;

  perform public.lock_attendance_staff_writes(issue.staff_id);
  select * into issue
  from public.attendance_exceptions
  where id = target_exception_id
  for update;
  if issue.status not in ('open', 'under_review') then
    raise exception 'The attendance exception is no longer available';
  end if;

  current_revision := public.get_attendance_event_revision(
    issue.staff_id,
    issue.operational_date
  );
  if current_revision is distinct from expected_revision then
    raise exception using errcode = '40001',
      message = 'Attendance changed after this review opened';
  end if;

  insert into public.attendance_exception_operations (
    operation_id, exception_id, operation_kind, expected_revision,
    reason, request_fingerprint, created_by
  ) values (
    operation_id, target_exception_id, 'resolve', expected_revision,
    trim(reason), fingerprint, manager_account.id
  );

  batch_id := public.save_manual_clock_event_correction(
    issue.staff_id,
    issue.operational_date,
    coalesce(
      nullif(correction_plan -> 'primary' ->> 'supersedes_correction_id', '')::uuid,
      nullif(correction_plan -> 'primary' ->> 'original_event_id', '')::uuid
    ),
    operation_id,
    correction_plan -> 'primary' ->> 'event_type',
    nullif(correction_plan -> 'primary' ->> 'event_timestamp', '')::timestamptz,
    trim(reason),
    expected_revision
  );

  update public.attendance_exceptions set
    status = 'resolved',
    reviewing_manager_id = manager_account.id,
    review_started_at = coalesce(review_started_at, now()),
    resolution_correction_batch_id = batch_id,
    resolution_reason = trim(reason),
    resolved_at = now(),
    updated_at = now()
  where id = target_exception_id;

  response_value := jsonb_build_object(
    'ok', true,
    'code', 'resolved',
    'status', 'resolved',
    'exceptionId', target_exception_id,
    'operationId', operation_id,
    'correctionBatchId', batch_id,
    'attendanceState', public.get_attendance_state(issue.staff_id, now())
  );
  update public.attendance_exception_operations set
    correction_batch_id = batch_id,
    safe_response = response_value,
    completed_at = now()
  where attendance_exception_operations.operation_id = resolve_attendance_exception.operation_id;

  return response_value;
end;
$$;

create or replace function public.dismiss_attendance_exception(
  target_exception_id uuid,
  reason text,
  expected_revision text,
  operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  manager_account public.staff_accounts;
  issue public.attendance_exceptions%rowtype;
  existing_operation public.attendance_exception_operations%rowtype;
  current_revision text;
  fingerprint text;
  response_value jsonb;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if target_exception_id is null or operation_id is null or expected_revision is null then
    raise exception 'Reload the attendance issue and review the dismissal again';
  end if;
  if reason is null or length(trim(reason)) < 5 then
    raise exception using errcode = '23514',
      message = 'Enter a dismissal reason of at least five characters';
  end if;

  fingerprint := encode(digest(
    concat_ws('|', 'dismiss', target_exception_id, expected_revision, trim(reason)),
    'sha256'
  ), 'hex');

  perform public.lock_attendance_operation(operation_id);
  select operation.* into existing_operation
  from public.attendance_exception_operations operation
  where operation.operation_id = dismiss_attendance_exception.operation_id;
  if found then
    if existing_operation.exception_id = target_exception_id
      and existing_operation.operation_kind = 'dismiss'
      and existing_operation.expected_revision = expected_revision
      and existing_operation.reason = trim(reason)
      and existing_operation.request_fingerprint = fingerprint
      and existing_operation.completed_at is not null then
      return existing_operation.safe_response;
    end if;
    raise exception 'Operation ID is already used for a different attendance decision';
  end if;

  select * into issue
  from public.attendance_exceptions
  where id = target_exception_id;
  if not found or issue.status not in ('open', 'under_review') then
    raise exception 'The attendance exception is no longer available';
  end if;

  perform public.lock_attendance_staff_writes(issue.staff_id);
  select * into issue
  from public.attendance_exceptions
  where id = target_exception_id
  for update;
  if issue.status not in ('open', 'under_review') then
    raise exception 'The attendance exception is no longer available';
  end if;
  current_revision := public.get_attendance_event_revision(
    issue.staff_id,
    issue.operational_date
  );
  if current_revision is distinct from expected_revision then
    raise exception using errcode = '40001',
      message = 'Attendance changed after this review opened';
  end if;

  insert into public.attendance_exception_operations (
    operation_id, exception_id, operation_kind, expected_revision,
    reason, request_fingerprint, created_by
  ) values (
    operation_id, target_exception_id, 'dismiss', expected_revision,
    trim(reason), fingerprint, manager_account.id
  );

  update public.attendance_exceptions set
    status = 'dismissed',
    reviewing_manager_id = manager_account.id,
    review_started_at = coalesce(review_started_at, now()),
    dismissal_reason = trim(reason),
    dismissed_at = now(),
    updated_at = now()
  where id = target_exception_id;

  response_value := jsonb_build_object(
    'ok', true,
    'code', 'dismissed',
    'status', 'dismissed',
    'exceptionId', target_exception_id,
    'operationId', operation_id,
    'attendanceState', public.get_attendance_state(issue.staff_id, now())
  );
  update public.attendance_exception_operations set
    safe_response = response_value,
    completed_at = now()
  where attendance_exception_operations.operation_id = dismiss_attendance_exception.operation_id;

  return response_value;
end;
$$;

create or replace function public.get_manager_attendance_exceptions(
  range_start date,
  range_end date,
  requested_status text default null,
  requested_type text default null,
  requested_staff_id text default null
)
returns setof jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if range_start is null or range_end is null or range_start > range_end
    or range_end - range_start > 366 then
    raise exception 'Choose a valid attendance issue date range';
  end if;
  if requested_status is not null
    and requested_status not in ('open', 'under_review', 'resolved', 'dismissed') then
    raise exception 'Choose a valid attendance issue status';
  end if;
  if requested_type is not null and requested_type not in (
    'missing_clock_out', 'missing_clock_in', 'consecutive_clock_in',
    'unmatched_clock_out', 'overlapping_attendance', 'unusually_long_shift',
    'offline_sync_conflict', 'device_clock_drift', 'offline_time_uncertain'
  ) then
    raise exception 'Choose a valid attendance issue type';
  end if;

  return query
  select jsonb_build_object(
    'id', issue.id,
    'staff_id', issue.staff_id,
    'full_name', staff.full_name,
    'operational_date', issue.operational_date,
    'exception_type', issue.exception_type,
    'status', issue.status,
    'source', issue.source,
    'created_at', issue.created_at,
    'updated_at', issue.updated_at,
    'state_revision', public.get_attendance_event_revision(
      issue.staff_id,
      issue.operational_date
    ),
    'suggested_resolution_at', coalesce(
      issue.suggested_resolution_at,
      suggestion.suggested_at
    ),
    'payroll_may_be_affected', issue.status in ('open', 'under_review'),
    'original_events', coalesce(originals.value, '[]'::jsonb),
    'effective_events', coalesce(effective.value, '[]'::jsonb),
    'corrections', coalesce(corrections.value, '[]'::jsonb),
    'scheduled_shifts', coalesce(shifts.value, '[]'::jsonb),
    'leave_context', coalesce(leave_rows.value, '[]'::jsonb),
    'operation_history', coalesce(operations.value, '[]'::jsonb),
    'resolution_reason', issue.resolution_reason,
    'dismissal_reason', issue.dismissal_reason,
    'resolved_at', issue.resolved_at,
    'dismissed_at', issue.dismissed_at,
    'reviewing_manager_name', reviewer.full_name
  )
  from public.attendance_exceptions issue
  join public.staff_profiles staff on staff.id = issue.staff_id
  left join public.staff_accounts reviewer on reviewer.id = issue.reviewing_manager_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', event.id,
      'event_type', event.event_type,
      'event_timestamp', event.event_timestamp,
      'kiosk_device_id', event.kiosk_device_id,
      'event_source', event.event_source,
      'created_at', event.created_at
    ) order by event.event_timestamp, event.id) as value
    from public.clock_events event
    where event.staff_id = issue.staff_id
      and event.recorded_date = issue.operational_date
  ) originals on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'event_id', event.event_id,
      'event_order_key', event.event_order_key,
      'original_event_id', event.original_event_id,
      'correction_id', event.correction_id,
      'event_type', event.event_type,
      'event_timestamp', event.event_timestamp,
      'source', event.source
    ) order by event.event_timestamp, event.event_order_key, event.event_id) as value
    from public.get_effective_clock_events(
      issue.operational_date, issue.operational_date, issue.staff_id
    ) event
  ) effective on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', correction.id,
      'batch_id', correction.batch_id,
      'correction_role', correction.correction_role,
      'correction_kind', correction.correction_kind,
      'original_event_id', correction.original_event_id,
      'supersedes_correction_id', correction.supersedes_correction_id,
      'event_type', correction.event_type,
      'event_timestamp', correction.event_timestamp,
      'reason', correction.reason,
      'manager_name', account.full_name,
      'created_at', correction.created_at
    ) order by correction.created_at, correction.id) as value
    from public.clock_event_corrections correction
    join public.staff_accounts account on account.id = correction.created_by
    where correction.staff_id = issue.staff_id
      and correction.recorded_date = issue.operational_date
  ) corrections on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', shift.id,
      'start_time', shift.start_time,
      'end_time', shift.end_time,
      'break_minutes', shift.break_minutes,
      'status', shift.status,
      'room_or_area', shift.room_or_area,
      'role_on_shift', shift.role_on_shift
    ) order by shift.start_time, shift.id) as value
    from public.rota_shifts shift
    join public.rota_weeks week on week.id = shift.rota_week_id
    where shift.staff_id = issue.staff_id
      and shift.shift_date = issue.operational_date
      and shift.archived_at is null
      and shift.status <> 'cancelled'
      and week.status = 'published'
  ) shifts on true
  left join lateral (
    select min(
      (issue.operational_date + shift.end_time)::timestamp
        at time zone 'Europe/London'
    ) as suggested_at
    from public.rota_shifts shift
    join public.rota_weeks week on week.id = shift.rota_week_id
    where shift.staff_id = issue.staff_id
      and shift.shift_date = issue.operational_date
      and shift.archived_at is null
      and shift.status <> 'cancelled'
      and week.status = 'published'
  ) suggestion on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', leave_request.id,
      'leave_type', leave_request.leave_type,
      'start_date', leave_request.start_date,
      'end_date', leave_request.end_date,
      'day_part', leave_request.day_part,
      'start_time', leave_request.start_time,
      'end_time', leave_request.end_time
    ) order by leave_request.start_date, leave_request.id) as value
    from public.leave_requests leave_request
    where leave_request.staff_id = issue.staff_id
      and leave_request.status = 'approved'
      and leave_request.start_date <= issue.operational_date
      and leave_request.end_date >= issue.operational_date
  ) leave_rows on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'operation_id', operation.operation_id,
      'operation_kind', operation.operation_kind,
      'reason', operation.reason,
      'manager_name', account.full_name,
      'correction_batch_id', operation.correction_batch_id,
      'created_at', operation.created_at,
      'completed_at', operation.completed_at
    ) order by operation.created_at, operation.operation_id) as value
    from public.attendance_exception_operations operation
    join public.staff_accounts account on account.id = operation.created_by
    where operation.exception_id = issue.id
  ) operations on true
  where issue.operational_date between range_start and range_end
    and (requested_status is null or issue.status = requested_status)
    and (requested_type is null or issue.exception_type = requested_type)
    and (requested_staff_id is null or issue.staff_id = requested_staff_id)
  order by
    case issue.status when 'open' then 0 when 'under_review' then 1 else 2 end,
    issue.operational_date desc,
    staff.full_name,
    issue.created_at,
    issue.id;
end;
$$;

revoke all on function public.resolve_attendance_exception(uuid, jsonb, text, text)
from public, anon, authenticated;
revoke all on function public.dismiss_attendance_exception(uuid, text, text)
from public, anon, authenticated;
revoke all on function public.resolve_attendance_exception(uuid, jsonb, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.dismiss_attendance_exception(uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.get_manager_attendance_exceptions(date, date, text, text, text)
from public, anon, authenticated;

grant execute on function public.resolve_attendance_exception(uuid, jsonb, text, text, uuid)
to authenticated;
grant execute on function public.dismiss_attendance_exception(uuid, text, text, uuid)
to authenticated;
grant execute on function public.get_manager_attendance_exceptions(date, date, text, text, text)
to authenticated;

create or replace function public.get_manager_effective_clock_events(
  range_start date,
  range_end date,
  target_staff_id text default null
)
returns table (
  event_id uuid,
  event_order_key text,
  original_event_id uuid,
  correction_id uuid,
  staff_id text,
  event_type text,
  event_timestamp timestamptz,
  recorded_date date,
  source text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if range_start is null or range_end is null or range_start > range_end
    or range_end - range_start > 366 then
    raise exception 'Choose a valid attendance range';
  end if;
  return query select event.*
  from public.get_effective_clock_events(range_start, range_end, target_staff_id) event;
end;
$$;

revoke all on function public.get_manager_effective_clock_events(date, date, text)
from public, anon, authenticated;
grant execute on function public.get_manager_effective_clock_events(date, date, text)
to authenticated;

create or replace function public.get_own_effective_clock_events(
  range_start date,
  range_end date
)
returns table (
  event_id uuid,
  event_order_key text,
  original_event_id uuid,
  correction_id uuid,
  staff_id text,
  event_type text,
  event_timestamp timestamptz,
  recorded_date date,
  source text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  staff_account public.staff_accounts;
begin
  staff_account := public.current_staff_account();
  if staff_account.id is null or staff_account.role <> 'staff'
    or staff_account.active is not true then
    raise exception 'Staff access required';
  end if;
  if range_start is null or range_end is null or range_start > range_end
    or range_end - range_start > 94 then
    raise exception 'Choose a valid attendance range';
  end if;
  return query select event.*
  from public.get_effective_clock_events(
    range_start, range_end, staff_account.staff_id
  ) event;
end;
$$;

revoke all on function public.get_own_effective_clock_events(date, date)
from public, anon, authenticated;
grant execute on function public.get_own_effective_clock_events(date, date)
to authenticated;

create or replace function public.get_manager_attendance_dashboard(
  reference_date date
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  result_value jsonb;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if reference_date is null then raise exception 'A reference date is required'; end if;

  with effective as (
    select event.*,
      row_number() over (
        partition by event.staff_id
        order by event.event_timestamp desc, event.event_order_key desc, event.event_id desc
      ) as latest_rank
    from public.get_effective_clock_events(reference_date, reference_date, null) event
  ), clocked_in as (
    select effective.* from effective
    where effective.latest_rank = 1 and effective.event_type = 'clock_in'
  ), issue_counts as (
    select
      count(*) filter (where issue.status in ('open', 'under_review'))::integer as unresolved_count,
      count(*) filter (where issue.status in ('open', 'under_review') and issue.exception_type = 'missing_clock_out')::integer as missing_count,
      count(*) filter (where issue.status in ('open', 'under_review') and issue.exception_type = 'unusually_long_shift')::integer as long_count
    from public.attendance_exceptions issue
    where issue.operational_date <= reference_date
  ), correction_requests as (
    select count(*)::integer as pending_count
    from public.attendance_correction_requests request
    where request.status = 'pending'
  )
  select jsonb_build_object(
    'unresolved_attendance_issues', issue_counts.unresolved_count,
    'missing_clock_outs', issue_counts.missing_count,
    'long_running_shifts', issue_counts.long_count,
    'pending_corrections', correction_requests.pending_count,
    'currently_clocked_in', (select count(*) from clocked_in),
    'clocked_in_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', clocked.staff_id,
        'display_name', coalesce(nullif(trim(profile.display_name), ''), profile.full_name),
        'clocked_in_at', clocked.event_timestamp,
        'scheduled_end', shift.scheduled_end
      ) order by profile.full_name)
      from clocked_in clocked
      join public.staff_profiles profile on profile.id = clocked.staff_id
      left join lateral (
        select rota_shift.end_time as scheduled_end
        from public.rota_shifts rota_shift
        join public.rota_weeks week on week.id = rota_shift.rota_week_id
        where rota_shift.staff_id = clocked.staff_id
          and rota_shift.shift_date = reference_date
          and rota_shift.archived_at is null
          and rota_shift.status <> 'cancelled'
          and week.status = 'published'
        order by rota_shift.end_time desc limit 1
      ) shift on true
    ), '[]'::jsonb),
    'attendance_warnings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', issue.staff_id,
        'display_name', coalesce(nullif(trim(profile.display_name), ''), profile.full_name),
        'warning', replace(issue.exception_type, '_', ' '),
        'warning_date', issue.operational_date,
        'exception_type', issue.exception_type
      ) order by issue.operational_date desc, profile.full_name)
      from public.attendance_exceptions issue
      join public.staff_profiles profile on profile.id = issue.staff_id
      where issue.status in ('open', 'under_review')
        and issue.operational_date <= reference_date
    ), '[]'::jsonb)
  ) into result_value
  from issue_counts cross join correction_requests;
  return result_value;
end;
$$;

revoke all on function public.get_manager_attendance_dashboard(date)
from public, anon, authenticated;
grant execute on function public.get_manager_attendance_dashboard(date)
to authenticated;
