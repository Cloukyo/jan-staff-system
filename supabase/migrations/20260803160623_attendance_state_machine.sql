create table public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  operational_date date not null,
  exception_type text not null check (exception_type in (
    'missing_clock_out', 'missing_clock_in', 'consecutive_clock_in',
    'unmatched_clock_out', 'overlapping_attendance', 'unusually_long_shift',
    'offline_sync_conflict', 'device_clock_drift', 'offline_time_uncertain'
  )),
  status text not null default 'open' check (status in (
    'open', 'under_review', 'resolved', 'dismissed'
  )),
  primary_event_id uuid,
  related_event_ids uuid[] not null default '{}',
  anomaly_fingerprint text not null check (length(trim(anomaly_fingerprint)) > 0),
  detection_revision text not null check (length(detection_revision) > 0),
  suggested_resolution_at timestamptz,
  source text not null check (source in ('reconciliation', 'kiosk', 'offline_sync')),
  reviewing_manager_id uuid references public.staff_accounts(id) on delete restrict,
  review_started_at timestamptz,
  resolution_correction_batch_id uuid,
  resolution_reason text,
  resolved_at timestamptz,
  dismissal_reason text,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_exception_review_details check (
    (status = 'open' and reviewing_manager_id is null and review_started_at is null)
    or (status <> 'open' and reviewing_manager_id is not null and review_started_at is not null)
  ),
  constraint attendance_exception_resolution_details check (
    (status = 'resolved' and resolution_reason is not null
      and length(trim(resolution_reason)) >= 5 and resolved_at is not null)
    or (status <> 'resolved' and resolution_reason is null and resolved_at is null
      and resolution_correction_batch_id is null)
  ),
  constraint attendance_exception_dismissal_details check (
    (status = 'dismissed' and dismissal_reason is not null
      and length(trim(dismissal_reason)) >= 5 and dismissed_at is not null)
    or (status <> 'dismissed' and dismissal_reason is null and dismissed_at is null)
  )
);

create unique index attendance_exceptions_open_fingerprint_idx
on public.attendance_exceptions (
  staff_id, operational_date, exception_type, anomaly_fingerprint
)
where status in ('open', 'under_review');

create index attendance_exceptions_manager_queue_idx
on public.attendance_exceptions (status, operational_date desc, staff_id)
where status in ('open', 'under_review');

create index attendance_exceptions_reviewing_manager_idx
on public.attendance_exceptions (reviewing_manager_id)
where reviewing_manager_id is not null;

create table public.attendance_action_requests (
  idempotency_key uuid primary key,
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  kiosk_device_id uuid not null references public.kiosk_devices(id) on delete restrict,
  action text not null check (action in ('clock_in', 'clock_out', 'start_new_shift')),
  expected_revision text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  result_code text,
  resulting_state text check (resulting_state is null or resulting_state in (
    'clocked_out', 'clocked_in', 'missing_clock_out',
    'missing_clock_in', 'awaiting_manager_review'
  )),
  resulting_event_id uuid references public.clock_events(id) on delete restrict,
  safe_response jsonb,
  expires_at timestamptz not null default (now() + interval '90 days'),
  offline_authorisation_id uuid,
  device_sequence bigint,
  occurred_at_device timestamptz,
  received_at_server timestamptz,
  clock_confidence text,
  conflict_category text,
  constraint attendance_action_request_completion check (
    (completed_at is null and result_code is null and resulting_state is null
      and resulting_event_id is null and safe_response is null)
    or (completed_at is not null and result_code is not null
      and resulting_state is not null and safe_response is not null)
  ),
  constraint attendance_action_request_expiry check (expires_at > created_at)
);

create index attendance_action_requests_expiry_idx
on public.attendance_action_requests (expires_at)
where completed_at is not null;

create index attendance_action_requests_staff_created_idx
on public.attendance_action_requests (staff_id, created_at desc);

create index attendance_action_requests_device_idx
on public.attendance_action_requests (kiosk_device_id);

create index attendance_action_requests_resulting_event_idx
on public.attendance_action_requests (resulting_event_id)
where resulting_event_id is not null;

create or replace function public.attendance_operational_date(value timestamptz)
returns date
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select (value at time zone 'Europe/London')::date;
$$;

create or replace function public.get_attendance_state(
  target_staff_id text,
  evaluated_at timestamptz
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  operational_day date;
  event_row record;
  exception_row record;
  scan_day date;
  open_event jsonb;
  current_open_event jsonb;
  stale_open_event jsonb;
  day_warning_count integer := 0;
  current_warning_count integer := 0;
  warnings jsonb := '[]'::jsonb;
  unresolved jsonb := '[]'::jsonb;
  event_revision_input text := '';
  exception_revision_input text := '';
  current_exception_types text[] := '{}';
  derived_state text;
  actions jsonb;
  revision_value text;
  event_json jsonb;
begin
  if nullif(trim(target_staff_id), '') is null or evaluated_at is null then
    raise exception 'A staff member and evaluation time are required';
  end if;

  operational_day := public.attendance_operational_date(evaluated_at);

  for event_row in
    select event.*
    from public.get_effective_clock_events(
      operational_day - 366,
      operational_day,
      target_staff_id
    ) event
    order by event.event_timestamp, event.event_order_key, event.event_id
  loop
    if scan_day is distinct from event_row.recorded_date then
      if scan_day is not null then
        if scan_day = operational_day then
          current_open_event := open_event;
          current_warning_count := day_warning_count;
        elsif scan_day < operational_day and open_event is not null
          and stale_open_event is null then
          stale_open_event := open_event;
        end if;
      end if;
      scan_day := event_row.recorded_date;
      open_event := null;
      day_warning_count := 0;
    end if;

    event_json := jsonb_build_object(
      'eventId', event_row.event_id,
      'eventOrderKey', event_row.event_order_key,
      'originalEventId', event_row.original_event_id,
      'correctionId', event_row.correction_id,
      'staffId', event_row.staff_id,
      'eventType', event_row.event_type,
      'eventTimestamp', event_row.event_timestamp,
      'source', event_row.source
    );
    event_revision_input := event_revision_input || '|' ||
      concat_ws(':', event_row.event_id, event_row.event_order_key,
        event_row.original_event_id, event_row.correction_id,
        event_row.event_type, event_row.event_timestamp);

    if event_row.event_type = 'clock_in' then
      if open_event is not null then
        warnings := warnings || jsonb_build_array(jsonb_build_object(
          'type', 'consecutive_clock_in',
          'operationalDate', scan_day,
          'eventIds', jsonb_build_array(open_event ->> 'eventId', event_row.event_id)
        ));
        day_warning_count := day_warning_count + 1;
      end if;
      open_event := event_json;
    elsif open_event is null then
      warnings := warnings || jsonb_build_array(jsonb_build_object(
        'type', 'unmatched_clock_out',
        'operationalDate', scan_day,
        'eventIds', jsonb_build_array(event_row.event_id)
      ));
      day_warning_count := day_warning_count + 1;
    else
      open_event := null;
    end if;
  end loop;

  if scan_day = operational_day then
    current_open_event := open_event;
    current_warning_count := day_warning_count;
  elsif scan_day is not null and scan_day < operational_day
    and open_event is not null and stale_open_event is null then
    stale_open_event := open_event;
  end if;

  for exception_row in
    select issue.*
    from public.attendance_exceptions issue
    where issue.staff_id = target_staff_id
      and issue.status in ('open', 'under_review')
      and issue.operational_date <= operational_day
    order by issue.id
  loop
    unresolved := unresolved || jsonb_build_array(jsonb_build_object(
      'id', exception_row.id,
      'staffId', exception_row.staff_id,
      'operationalDate', exception_row.operational_date,
      'type', exception_row.exception_type,
      'status', exception_row.status
    ));
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'type', exception_row.exception_type,
      'operationalDate', exception_row.operational_date,
      'exceptionId', exception_row.id
    ));
    exception_revision_input := exception_revision_input || '|' ||
      concat_ws(':', exception_row.id, exception_row.operational_date,
        exception_row.exception_type, exception_row.status);
    if exception_row.operational_date = operational_day then
      current_exception_types := array_append(
        current_exception_types, exception_row.exception_type
      );
    end if;
  end loop;

  if current_open_event is not null
    and extract(epoch from (evaluated_at - (current_open_event ->> 'eventTimestamp')::timestamptz)) / 60 > 720 then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'type', 'unusually_long_shift',
      'operationalDate', operational_day,
      'eventIds', jsonb_build_array(current_open_event ->> 'eventId')
    ));
  end if;

  if current_warning_count > 0 then
    if current_open_event is null and not exists (
      select 1 from jsonb_array_elements(warnings) item
      where item ->> 'operationalDate' = operational_day::text
        and item ->> 'type' <> 'unmatched_clock_out'
    ) then
      derived_state := 'missing_clock_in';
    else
      derived_state := 'awaiting_manager_review';
    end if;
    actions := '[]'::jsonb;
  elsif current_open_event is not null then
    derived_state := 'clocked_in';
    actions := '["clock_out"]'::jsonb;
  elsif cardinality(current_exception_types) > 0 then
    if (select count(distinct value) from unnest(current_exception_types) value) = 1
      and current_exception_types[1] = 'missing_clock_out' then
      derived_state := 'missing_clock_out';
      actions := '["start_new_shift"]'::jsonb;
    elsif (select count(distinct value) from unnest(current_exception_types) value) = 1
      and current_exception_types[1] in ('missing_clock_in', 'unmatched_clock_out') then
      derived_state := 'missing_clock_in';
      actions := '[]'::jsonb;
    else
      derived_state := 'awaiting_manager_review';
      actions := '[]'::jsonb;
    end if;
  elsif stale_open_event is not null then
    derived_state := 'missing_clock_out';
    actions := '["start_new_shift"]'::jsonb;
  else
    derived_state := 'clocked_out';
    actions := '["clock_in"]'::jsonb;
  end if;

  revision_value := encode(digest(
    'attendance-state-v1|' || operational_day || event_revision_input || exception_revision_input,
    'sha256'
  ), 'hex');

  return jsonb_build_object(
    'state', derived_state,
    'operationalDate', operational_day,
    'currentEvent', current_open_event,
    'unresolvedExceptions', unresolved,
    'allowedActions', actions,
    'warnings', warnings,
    'revision', revision_value,
    'evaluatedAt', evaluated_at
  );
end;
$$;

create or replace function public.reconcile_attendance_exceptions(
  target_staff_id text,
  start_date date,
  end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  day_value date;
  event_row record;
  open_event_id uuid;
  prior_event_id uuid;
  prior_type text;
  fingerprint text;
  revision_value text;
  candidate_type text;
  candidate_ids uuid[];
  created_count integer := 0;
  existing_count integer := 0;
  skipped_count integer := 0;
  inserted_count integer;
begin
  if nullif(trim(target_staff_id), '') is null
    or start_date is null or end_date is null or start_date > end_date
    or end_date - start_date > 366 then
    raise exception 'Choose a valid bounded attendance reconciliation range';
  end if;

  perform public.lock_attendance_staff_writes(target_staff_id);

  for day_value in select generate_series(start_date, end_date, interval '1 day')::date
  loop
    open_event_id := null;
    prior_event_id := null;
    prior_type := null;
    revision_value := public.get_attendance_event_revision(target_staff_id, day_value);

    for event_row in
      select event.* from public.get_effective_clock_events(day_value, day_value, target_staff_id) event
      order by event.event_timestamp, event.event_order_key, event.event_id
    loop
      candidate_type := null;
      candidate_ids := '{}';
      if event_row.event_type = 'clock_in' then
        if open_event_id is not null then
          candidate_type := 'consecutive_clock_in';
          candidate_ids := array[open_event_id, event_row.event_id];
        end if;
        open_event_id := event_row.event_id;
      elsif open_event_id is null then
        candidate_type := 'unmatched_clock_out';
        candidate_ids := array[event_row.event_id];
      else
        if extract(epoch from (event_row.event_timestamp - (
          select e.event_timestamp from public.get_effective_clock_events(
            day_value, day_value, target_staff_id
          ) e where e.event_id = open_event_id limit 1
        ))) / 60 > 720 then
          candidate_type := 'unusually_long_shift';
          candidate_ids := array[open_event_id, event_row.event_id];
        end if;
        open_event_id := null;
      end if;

      if candidate_type is not null then
        fingerprint := encode(digest(
          candidate_type || '|' || day_value || '|' || array_to_string(candidate_ids, ','),
          'sha256'
        ), 'hex');
        insert into public.attendance_exceptions (
          staff_id, operational_date, exception_type, primary_event_id,
          related_event_ids, anomaly_fingerprint, detection_revision, source
        ) values (
          target_staff_id, day_value, candidate_type, candidate_ids[1],
          candidate_ids, fingerprint, coalesce(revision_value, ''), 'reconciliation'
        ) on conflict (staff_id, operational_date, exception_type, anomaly_fingerprint)
          where status in ('open', 'under_review') do nothing;
        get diagnostics inserted_count = row_count;
        if inserted_count = 1 then created_count := created_count + 1;
        else existing_count := existing_count + 1; end if;
      end if;
      prior_event_id := event_row.event_id;
      prior_type := event_row.event_type;
    end loop;

    if open_event_id is not null and day_value < public.attendance_operational_date(now()) then
      fingerprint := encode(digest(
        'missing_clock_out|' || day_value || '|' || open_event_id,
        'sha256'
      ), 'hex');
      insert into public.attendance_exceptions (
        staff_id, operational_date, exception_type, primary_event_id,
        related_event_ids, anomaly_fingerprint, detection_revision, source
      ) values (
        target_staff_id, day_value, 'missing_clock_out', open_event_id,
        array[open_event_id], fingerprint, coalesce(revision_value, ''), 'reconciliation'
      ) on conflict (staff_id, operational_date, exception_type, anomaly_fingerprint)
        where status in ('open', 'under_review') do nothing;
      get diagnostics inserted_count = row_count;
      if inserted_count = 1 then created_count := created_count + 1;
      else existing_count := existing_count + 1; end if;
    elsif open_event_id is not null then
      skipped_count := skipped_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'created', created_count, 'existing', existing_count, 'skipped', skipped_count
  );
end;
$$;

create or replace function public.perform_device_kiosk_attendance_action(
  device_token text,
  target_staff_id text,
  candidate_pin text,
  requested_action text,
  expected_revision text,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  device_id uuid;
  verification record;
  existing_request public.attendance_action_requests%rowtype;
  state_value jsonb;
  response_value jsonb;
  created_event_id uuid;
  created_event_at timestamptz;
  expected_state text;
begin
  device_id := public.require_kiosk_device(device_token);
  select * into verification from public.verify_kiosk_pin(target_staff_id, candidate_pin);
  if not coalesce(verification.ok, false) then
    return jsonb_build_object(
      'ok', false, 'code', coalesce(verification.code, 'unavailable'),
      'state', coalesce(verification.current_status, 'clocked_out')
    );
  end if;
  if requested_action not in ('clock_in', 'clock_out', 'start_new_shift')
    or idempotency_key is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform public.lock_attendance_staff_writes(target_staff_id);
  select * into existing_request
  from public.attendance_action_requests request
  where request.idempotency_key = perform_device_kiosk_attendance_action.idempotency_key;

  if found then
    if existing_request.staff_id = target_staff_id
      and existing_request.action = requested_action
      and existing_request.kiosk_device_id = device_id then
      return existing_request.safe_response;
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  state_value := public.get_attendance_state(target_staff_id, now());
  if state_value ->> 'revision' is distinct from expected_revision then
    response_value := jsonb_build_object(
      'ok', false, 'code', 'state_conflict', 'state', state_value ->> 'state',
      'attendanceState', state_value
    );
  else
    expected_state := case requested_action
      when 'clock_in' then 'clocked_out'
      when 'clock_out' then 'clocked_in'
      when 'start_new_shift' then 'missing_clock_out'
    end;
    if state_value ->> 'state' <> expected_state then
      response_value := jsonb_build_object(
        'ok', false, 'code', 'invalid_transition', 'state', state_value ->> 'state',
        'attendanceState', state_value
      );
    else
      if requested_action = 'start_new_shift' then
        perform public.reconcile_attendance_exceptions(
          target_staff_id,
          public.attendance_operational_date(now()) - 366,
          public.attendance_operational_date(now())
        );
      end if;
      insert into public.clock_events (
        staff_id, event_type, kiosk_device_id
      ) values (
        target_staff_id,
        case when requested_action = 'clock_out' then 'clock_out' else 'clock_in' end,
        device_id::text
      ) returning id, event_timestamp into created_event_id, created_event_at;

      state_value := public.get_attendance_state(target_staff_id, created_event_at);
      response_value := jsonb_build_object(
        'ok', true, 'code', 'recorded', 'state', state_value ->> 'state',
        'eventId', created_event_id, 'recordedAt', created_event_at,
        'attendanceState', state_value
      );
    end if;
  end if;

  insert into public.attendance_action_requests (
    idempotency_key, staff_id, kiosk_device_id, action, expected_revision,
    completed_at, result_code, resulting_state, resulting_event_id,
    safe_response, received_at_server
  ) values (
    idempotency_key, target_staff_id, device_id, requested_action, expected_revision,
    now(), response_value ->> 'code', response_value ->> 'state', created_event_id,
    response_value, now()
  );
  return response_value;
end;
$$;

create or replace function public.resolve_attendance_exception(
  target_exception_id uuid,
  correction_plan jsonb,
  reason text,
  expected_revision text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  issue public.attendance_exceptions%rowtype;
  current_revision text;
  batch_id uuid;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if reason is null or length(trim(reason)) < 5 then
    raise exception using errcode = '23514', message = 'Enter a resolution reason of at least five characters';
  end if;
  select * into issue from public.attendance_exceptions where id = target_exception_id;
  if not found or issue.status not in ('open', 'under_review') then
    raise exception 'The attendance exception is no longer available';
  end if;
  perform public.lock_attendance_staff_writes(issue.staff_id);
  current_revision := public.get_attendance_state(issue.staff_id, now()) ->> 'revision';
  if expected_revision is null or current_revision is distinct from expected_revision then
    raise exception using errcode = '40001', message = 'Attendance changed after this review opened';
  end if;
  batch_id := public.save_clock_event_correction_chain(
    correction_plan || jsonb_build_object('reason', trim(reason))
  );
  update public.attendance_exceptions set
    status = 'resolved', reviewing_manager_id = manager_account.id,
    review_started_at = coalesce(review_started_at, now()),
    resolution_correction_batch_id = batch_id,
    resolution_reason = trim(reason), resolved_at = now(), updated_at = now()
  where id = target_exception_id;
  return batch_id;
end;
$$;

create or replace function public.dismiss_attendance_exception(
  target_exception_id uuid,
  reason text,
  expected_revision text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  issue public.attendance_exceptions%rowtype;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if reason is null or length(trim(reason)) < 5 then
    raise exception using errcode = '23514', message = 'Enter a dismissal reason of at least five characters';
  end if;
  select * into issue from public.attendance_exceptions where id = target_exception_id;
  if not found or issue.status not in ('open', 'under_review') then
    raise exception 'The attendance exception is no longer available';
  end if;
  perform public.lock_attendance_staff_writes(issue.staff_id);
  if expected_revision is null
    or public.get_attendance_state(issue.staff_id, now()) ->> 'revision'
      is distinct from expected_revision then
    raise exception using errcode = '40001', message = 'Attendance changed after this review opened';
  end if;
  update public.attendance_exceptions set
    status = 'dismissed', reviewing_manager_id = manager_account.id,
    review_started_at = coalesce(review_started_at, now()),
    dismissal_reason = trim(reason), dismissed_at = now(), updated_at = now()
  where id = target_exception_id;
end;
$$;

create or replace function public.get_effective_attendance_day_summaries(
  start_date date,
  end_date date,
  target_staff_id text default null
)
returns table (
  staff_id text,
  operational_date date,
  completed_minutes integer,
  open_shift_in_progress boolean,
  unresolved_exceptions jsonb
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

  return query
  with ordered as (
    select event.*,
      lag(event.event_type) over day_order as previous_type,
      lag(event.event_timestamp) over day_order as previous_at
    from public.get_effective_clock_events(start_date, end_date, target_staff_id) event
    window day_order as (
      partition by event.staff_id, event.recorded_date
      order by event.event_timestamp, event.event_order_key, event.event_id
    )
  ), staff_days as (
    select distinct event.staff_id, event.recorded_date from ordered event
  )
  select days.staff_id, days.recorded_date,
    coalesce(sum(
      case when ordered.event_type = 'clock_out' and ordered.previous_type = 'clock_in'
        then floor(extract(epoch from (ordered.event_timestamp - ordered.previous_at)) / 60)::integer
        else 0 end
    ), 0)::integer,
    coalesce((array_agg(ordered.event_type order by ordered.event_timestamp desc,
      ordered.event_order_key desc, ordered.event_id desc))[1] = 'clock_in', false),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id', issue.id, 'type', issue.exception_type, 'status', issue.status
    ) order by issue.id)
      from public.attendance_exceptions issue
      where issue.staff_id = days.staff_id
        and issue.operational_date = days.recorded_date
        and issue.status in ('open', 'under_review')), '[]'::jsonb)
  from staff_days days
  join ordered on ordered.staff_id = days.staff_id
    and ordered.recorded_date = days.recorded_date
  group by days.staff_id, days.recorded_date;
end;
$$;

create or replace function public.record_kiosk_clock_event(
  target_staff_id text,
  candidate_pin text,
  requested_event_type text,
  device_identifier text default null
)
returns table (ok boolean, code text, current_status text, recorded_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  verification record;
  state_value jsonb;
  created_at_value timestamptz;
begin
  if requested_event_type not in ('clock_in', 'clock_out') then
    return query select false, 'invalid_event', null::text, null::timestamptz;
    return;
  end if;
  select * into verification from public.verify_kiosk_pin(target_staff_id, candidate_pin);
  if not coalesce(verification.ok, false) then
    return query select false, verification.code, verification.current_status, null::timestamptz;
    return;
  end if;
  perform public.lock_attendance_staff_writes(target_staff_id);
  state_value := public.get_attendance_state(target_staff_id, now());
  if requested_event_type = 'clock_out' and state_value ->> 'state' = 'missing_clock_out' then
    return query select false, 'stale_shift_requires_review', 'clocked_out', null::timestamptz;
    return;
  end if;
  if (requested_event_type = 'clock_in' and state_value ->> 'state' <> 'clocked_out')
    or (requested_event_type = 'clock_out' and state_value ->> 'state' <> 'clocked_in') then
    return query select false, 'invalid_transition', state_value ->> 'state', null::timestamptz;
    return;
  end if;
  insert into public.clock_events (staff_id, event_type, kiosk_device_id)
  values (target_staff_id, requested_event_type, nullif(left(trim(device_identifier), 100), ''))
  returning event_timestamp into created_at_value;
  return query select true, 'recorded',
    case when requested_event_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
    created_at_value;
end;
$$;

alter table public.attendance_exceptions enable row level security;
alter table public.attendance_action_requests enable row level security;

create policy "Managers can read attendance exceptions"
on public.attendance_exceptions for select to authenticated
using ((select public.current_staff_role()) = 'manager');

revoke all on public.attendance_exceptions from public, anon, authenticated;
revoke all on public.attendance_action_requests from public, anon, authenticated;
grant select on public.attendance_exceptions to authenticated;

revoke all on function public.attendance_operational_date(timestamptz) from public, anon, authenticated;
revoke all on function public.get_attendance_state(text, timestamptz) from public, anon, authenticated;
revoke all on function public.reconcile_attendance_exceptions(text, date, date) from public, anon, authenticated;
revoke all on function public.perform_device_kiosk_attendance_action(text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.resolve_attendance_exception(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.dismiss_attendance_exception(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_effective_attendance_day_summaries(date, date, text) from public, anon, authenticated;
revoke all on function public.record_kiosk_clock_event(text, text, text, text) from public, anon, authenticated;

grant execute on function public.perform_device_kiosk_attendance_action(text, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.resolve_attendance_exception(uuid, jsonb, text, text) to authenticated;
grant execute on function public.dismiss_attendance_exception(uuid, text, text) to authenticated;
grant execute on function public.get_effective_attendance_day_summaries(date, date, text) to authenticated;
