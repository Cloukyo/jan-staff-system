create table public.clock_event_corrections (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  correction_role text not null check (correction_role in ('primary', 'consequential')),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  correction_kind text not null check (correction_kind in ('add', 'replace', 'exclude')),
  original_event_id uuid references public.clock_events(id) on delete restrict,
  supersedes_correction_id uuid references public.clock_event_corrections(id) on delete restrict,
  event_type text check (event_type in ('clock_in', 'clock_out')),
  event_timestamp timestamptz,
  recorded_date date not null,
  reason text not null check (length(trim(reason)) >= 5),
  created_by uuid not null references public.staff_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint clock_event_correction_target check (
    (
      correction_kind = 'add'
      and original_event_id is null
    )
    or
    (
      correction_kind in ('replace', 'exclude')
      and (
        (original_event_id is not null and supersedes_correction_id is null)
        or
        (original_event_id is null and supersedes_correction_id is not null)
      )
    )
  ),
  constraint clock_event_correction_payload check (
    (
      correction_kind = 'exclude'
      and event_type is null
      and event_timestamp is null
    )
    or
    (
      correction_kind in ('add', 'replace')
      and event_type is not null
      and event_timestamp is not null
    )
  ),
  constraint clock_event_correction_local_date check (
    event_timestamp is null
    or recorded_date = (event_timestamp at time zone 'Europe/London')::date
  ),
  constraint clock_event_correction_not_self_superseding check (
    supersedes_correction_id is null or supersedes_correction_id <> id
  )
);

create index clock_event_corrections_staff_date_idx
on public.clock_event_corrections (staff_id, recorded_date, created_at, id);

create index clock_event_corrections_original_idx
on public.clock_event_corrections (original_event_id)
where original_event_id is not null;

create index clock_event_corrections_supersedes_idx
on public.clock_event_corrections (supersedes_correction_id)
where supersedes_correction_id is not null;

create or replace function public.lock_attendance_staff_writes(target_staff_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(target_staff_id), '') is null then
    raise exception 'A staff member is required for attendance writes';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('attendance:' || target_staff_id, 0)
  );
end;
$$;

revoke all on function public.lock_attendance_staff_writes(text)
from public, anon, authenticated;

create or replace function public.lock_attendance_staff_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_attendance_staff_writes(new.staff_id);
  return new;
end;
$$;

revoke all on function public.lock_attendance_staff_insert()
from public, anon, authenticated;

create trigger attendance_staff_write_lock
before insert on public.clock_events
for each row execute function public.lock_attendance_staff_insert();

create trigger attendance_correction_staff_write_lock
before insert on public.clock_event_corrections
for each row execute function public.lock_attendance_staff_insert();

create or replace function public.validate_clock_event_correction_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_staff_id text;
  target_recorded_date date;
begin
  if new.original_event_id is not null then
    select event.staff_id, event.recorded_date
    into target_staff_id, target_recorded_date
    from public.clock_events event
    where event.id = new.original_event_id;
  elsif new.supersedes_correction_id is not null then
    select correction.staff_id, correction.recorded_date
    into target_staff_id, target_recorded_date
    from public.clock_event_corrections correction
    where correction.id = new.supersedes_correction_id;
  else
    return new;
  end if;

  if target_staff_id is null then
    raise exception 'The correction target does not exist';
  end if;
  if new.staff_id <> target_staff_id or new.recorded_date <> target_recorded_date then
    raise exception 'The correction target must belong to the same staff member and date';
  end if;

  return new;
end;
$$;

create trigger clock_event_correction_target_validation
before insert on public.clock_event_corrections
for each row execute function public.validate_clock_event_correction_target();

create or replace function public.require_clock_event_correction_batch_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.clock_event_corrections correction
    where correction.batch_id = new.batch_id
      and correction.correction_role = 'primary'
  ) then
    raise exception 'Each correction batch requires a primary correction';
  end if;

  return null;
end;
$$;

revoke all on function public.require_clock_event_correction_batch_primary()
from public, anon, authenticated;

create constraint trigger clock_event_correction_batch_primary
after insert on public.clock_event_corrections
deferrable initially deferred
for each row execute function public.require_clock_event_correction_batch_primary();

alter table public.clock_event_corrections enable row level security;

create policy "Managers can read clock event corrections"
on public.clock_event_corrections for select
to authenticated
using (public.current_staff_role() = 'manager');

create policy "Managers can add clock event corrections"
on public.clock_event_corrections for insert
to authenticated
with check (
  public.current_staff_role() = 'manager'
  and created_by = (public.current_staff_account()).id
);

revoke all on public.clock_event_corrections from public, anon, authenticated;
grant select, insert on public.clock_event_corrections to authenticated;

drop policy if exists "Managers can add clock corrections"
on public.clock_events;

revoke insert on public.clock_events from authenticated;

create or replace function public.get_effective_clock_events(
  range_start date,
  range_end date,
  target_staff_id text default null
)
returns table (
  event_id uuid,
  original_event_id uuid,
  correction_id uuid,
  staff_id text,
  event_type text,
  event_timestamp timestamptz,
  recorded_date date,
  source text
)
language sql
security definer
set search_path = public
stable
as $$
  with recursive correction_ancestry as (
    select
      candidate.id as leaf_correction_id,
      candidate.id as correction_id,
      candidate.supersedes_correction_id,
      candidate.original_event_id,
      0 as depth,
      array[candidate.id] as visited_correction_ids
    from public.clock_event_corrections candidate
    where candidate.recorded_date between range_start and range_end
      and (target_staff_id is null or candidate.staff_id = target_staff_id)
      and not exists (
        select 1
        from public.clock_event_corrections child
        where child.supersedes_correction_id = candidate.id
      )

    union all

    select
      ancestry.leaf_correction_id,
      parent.id,
      parent.supersedes_correction_id,
      parent.original_event_id,
      ancestry.depth + 1,
      ancestry.visited_correction_ids || parent.id
    from correction_ancestry ancestry
    join public.clock_event_corrections parent
      on parent.id = ancestry.supersedes_correction_id
    where not parent.id = any(ancestry.visited_correction_ids)
  ),
  leaf_context as (
    select
      ancestry.leaf_correction_id,
      (
        array_agg(ancestry.original_event_id order by ancestry.depth)
          filter (where ancestry.original_event_id is not null)
      )[1] as original_event_id,
      (array_agg(ancestry.correction_id order by ancestry.depth desc))[1] as root_correction_id
    from correction_ancestry ancestry
    group by ancestry.leaf_correction_id
  ),
  ranked_leaves as (
    select
      correction.id as correction_id,
      context.original_event_id,
      context.root_correction_id,
      correction.staff_id,
      correction.correction_kind,
      correction.event_type,
      correction.event_timestamp,
      correction.recorded_date,
      correction.created_at,
      row_number() over (
        partition by
          case
            when context.original_event_id is not null
              then 'original:' || context.original_event_id::text
            else 'correction:' || context.root_correction_id::text
          end
        order by correction.created_at desc, correction.id desc
      ) as lineage_rank
    from leaf_context context
    join public.clock_event_corrections correction
      on correction.id = context.leaf_correction_id
  ),
  active_leaves as (
    select *
    from ranked_leaves
    where lineage_rank = 1
  ),
  effective_events as (
    select
      original.id as event_id,
      null::uuid as original_event_id,
      null::uuid as correction_id,
      original.staff_id,
      original.event_type,
      original.event_timestamp,
      original.recorded_date,
      case
        when original.event_source = 'manager' then 'legacy_manager'
        else 'kiosk'
      end as source
    from public.clock_events original
    where original.recorded_date between range_start and range_end
      and (target_staff_id is null or original.staff_id = target_staff_id)
      and not exists (
        select 1
        from active_leaves active
        where active.original_event_id = original.id
          and active.correction_kind in ('replace', 'exclude')
      )

    union all

    select
      active.correction_id as event_id,
      active.original_event_id,
      active.correction_id,
      active.staff_id,
      active.event_type,
      active.event_timestamp,
      active.recorded_date,
      'manager_correction' as source
    from active_leaves active
    where active.correction_kind = 'add'
      or active.correction_kind = 'replace'
  )
  select *
  from effective_events
  order by event_timestamp, event_id;
$$;

revoke all on function public.get_effective_clock_events(date, date, text)
from public, anon, authenticated;

create or replace function public.save_clock_event_correction_chain(plan jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  correction_batch_id uuid := gen_random_uuid();
  plan_entries jsonb;
  plan_reason text;
  distinct_staff_count integer;
  distinct_date_count integer;
  invalid_target_count integer;
  locked_staff_id text;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  if jsonb_typeof(plan) <> 'object'
    or jsonb_typeof(plan -> 'primary') <> 'object'
    or coalesce(jsonb_typeof(plan -> 'consequential'), 'array') <> 'array' then
    raise exception 'Choose a valid correction plan';
  end if;

  plan_reason := nullif(trim(plan ->> 'reason'), '');
  if plan_reason is null or length(plan_reason) < 5 then
    raise exception 'Enter a correction reason of at least five characters';
  end if;

  plan_entries :=
    jsonb_build_array(plan -> 'primary')
    || coalesce(plan -> 'consequential', '[]'::jsonb);

  select coalesce(
    (
      select original.staff_id
      from public.clock_events original
      where original.id = nullif(plan -> 'primary' ->> 'original_event_id', '')::uuid
    ),
    (
      select superseded.staff_id
      from public.clock_event_corrections superseded
      where superseded.id = nullif(
        plan -> 'primary' ->> 'supersedes_correction_id',
        ''
      )::uuid
    ),
    nullif(plan -> 'primary' ->> 'staff_id', '')
  )
  into locked_staff_id;

  if locked_staff_id is null then
    raise exception 'The primary correction target does not exist';
  end if;

  perform public.lock_attendance_staff_writes(locked_staff_id);

  with entries as (
    select item
    from jsonb_array_elements(plan_entries) as entry(item)
  ),
  parsed as (
    select
      item,
      nullif(item ->> 'staff_id', '') as supplied_staff_id,
      nullif(item ->> 'recorded_date', '')::date as supplied_recorded_date,
      nullif(item ->> 'original_event_id', '')::uuid as original_event_id,
      nullif(item ->> 'supersedes_correction_id', '')::uuid as supersedes_correction_id
    from entries
  ),
  resolved as (
    select
      parsed.*,
      coalesce(original.staff_id, superseded.staff_id, parsed.supplied_staff_id) as staff_id,
      coalesce(original.recorded_date, superseded.recorded_date, parsed.supplied_recorded_date) as recorded_date,
      original.id as found_original_event_id,
      superseded.id as found_superseded_correction_id
    from parsed
    left join public.clock_events original on original.id = parsed.original_event_id
    left join public.clock_event_corrections superseded
      on superseded.id = parsed.supersedes_correction_id
  )
  select
    count(distinct staff_id),
    count(distinct recorded_date),
    count(*) filter (
      where staff_id is null
        or recorded_date is null
        or (original_event_id is not null and found_original_event_id is null)
        or (supersedes_correction_id is not null and found_superseded_correction_id is null)
        or (
          supplied_staff_id is not null
          and supplied_staff_id <> staff_id
        )
        or (
          supplied_recorded_date is not null
          and supplied_recorded_date <> recorded_date
        )
    )
  into distinct_staff_count, distinct_date_count, invalid_target_count
  from resolved;

  if invalid_target_count > 0
    or distinct_staff_count <> 1
    or distinct_date_count <> 1 then
    raise exception 'All correction targets must belong to one staff member and one recorded date';
  end if;

  with entries as (
    select item, ordinal
    from jsonb_array_elements(plan_entries) with ordinality as entry(item, ordinal)
  ),
  parsed as (
    select
      entries.item,
      entries.ordinal,
      nullif(entries.item ->> 'staff_id', '') as supplied_staff_id,
      nullif(entries.item ->> 'recorded_date', '')::date as supplied_recorded_date,
      nullif(entries.item ->> 'original_event_id', '')::uuid as original_event_id,
      nullif(entries.item ->> 'supersedes_correction_id', '')::uuid as supersedes_correction_id
    from entries
  ),
  resolved as (
    select
      parsed.*,
      coalesce(original.staff_id, superseded.staff_id, parsed.supplied_staff_id) as staff_id,
      coalesce(original.recorded_date, superseded.recorded_date, parsed.supplied_recorded_date) as recorded_date
    from parsed
    left join public.clock_events original on original.id = parsed.original_event_id
    left join public.clock_event_corrections superseded
      on superseded.id = parsed.supersedes_correction_id
  )
  insert into public.clock_event_corrections (
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
    correction_batch_id,
    case when ordinal = 1 then 'primary' else 'consequential' end,
    staff_id,
    item ->> 'correction_kind',
    original_event_id,
    supersedes_correction_id,
    nullif(item ->> 'event_type', ''),
    nullif(item ->> 'event_timestamp', '')::timestamptz,
    recorded_date,
    plan_reason,
    manager_account.id
  from resolved
  order by ordinal;

  return correction_batch_id;
end;
$$;

revoke all on function public.save_clock_event_correction_chain(jsonb)
from public, anon, authenticated;
grant execute on function public.save_clock_event_correction_chain(jsonb) to authenticated;

create or replace function public.use_planned_hours(
  target_staff_id text,
  target_date date,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  correction_batch_id uuid;
  planned_start time;
  planned_finish time;
  planned_start_at timestamptz;
  planned_finish_at timestamptz;
  event_count integer;
  left_boundary_count integer;
  right_boundary_count integer;
  intermediate_count integer;
  effective_events jsonb;
  correction_actions jsonb := '[]'::jsonb;
  boundary_event record;
  intermediate_event record;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;
  if target_staff_id is null or target_date is null then
    raise exception 'Choose a staff member and date';
  end if;
  if reason is null or length(trim(reason)) < 5 then
    raise exception 'Enter a correction reason of at least five characters';
  end if;

  perform public.lock_attendance_staff_writes(target_staff_id);

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
        'event_id', event.event_id,
        'correction_id', event.correction_id,
        'event_type', event.event_type,
        'event_timestamp', event.event_timestamp
      )
      order by event.event_timestamp, event.event_id
    ),
    '[]'::jsonb
  )
  into effective_events
  from public.get_effective_clock_events(
    target_date,
    target_date,
    target_staff_id
  ) event;

  event_count := jsonb_array_length(effective_events);

  select
    count(*) filter (where snapshot.event_timestamp <= planned_start_at),
    count(*) filter (
      where snapshot.event_timestamp > planned_start_at
        and snapshot.event_timestamp < planned_finish_at
    ),
    count(*) filter (where snapshot.event_timestamp >= planned_finish_at)
  into left_boundary_count, intermediate_count, right_boundary_count
  from jsonb_to_recordset(effective_events) as snapshot(
    event_id uuid,
    correction_id uuid,
    event_type text,
    event_timestamp timestamptz
  );

  if left_boundary_count + intermediate_count + right_boundary_count <> event_count then
    raise exception 'Attendance event snapshot could not be classified safely';
  end if;

  if left_boundary_count > 1 or right_boundary_count > 1 then
    raise exception
      'Multiple clock events fall outside the planned boundaries; make manual corrections first';
  end if;

  if intermediate_count % 2 = 1 then
    raise exception
      'An odd number of intermediate clock events requires manual correction before planned hours can be used';
  end if;

  if left_boundary_count = 0 then
    correction_actions := correction_actions || jsonb_build_array(
      jsonb_build_object(
        'correction_kind', 'add',
        'original_event_id', null,
        'supersedes_correction_id', null,
        'event_type', 'clock_in',
        'event_timestamp', planned_start_at
      )
    );
  else
    select snapshot.*
    into boundary_event
    from jsonb_to_recordset(effective_events) as snapshot(
      event_id uuid,
      correction_id uuid,
      event_type text,
      event_timestamp timestamptz
    )
    where snapshot.event_timestamp <= planned_start_at;

    if boundary_event.event_type <> 'clock_in'
      or boundary_event.event_timestamp <> planned_start_at then
      correction_actions := correction_actions || jsonb_build_array(
        jsonb_build_object(
          'correction_kind', 'replace',
          'original_event_id',
            case when boundary_event.correction_id is null
              then boundary_event.event_id
              else null
            end,
          'supersedes_correction_id', boundary_event.correction_id,
          'event_type', 'clock_in',
          'event_timestamp', planned_start_at
        )
      );
    end if;
  end if;

  for intermediate_event in
    select
      snapshot.*,
      row_number() over (
        order by snapshot.event_timestamp, snapshot.event_id
      ) as intermediate_position
    from jsonb_to_recordset(effective_events) as snapshot(
      event_id uuid,
      correction_id uuid,
      event_type text,
      event_timestamp timestamptz
    )
    where snapshot.event_timestamp > planned_start_at
      and snapshot.event_timestamp < planned_finish_at
    order by snapshot.event_timestamp, snapshot.event_id
  loop
    if intermediate_event.event_type <> (
      case
        when intermediate_event.intermediate_position::integer % 2 = 1
          then 'clock_out'
        else 'clock_in'
      end
    ) then
      correction_actions := correction_actions || jsonb_build_array(
        jsonb_build_object(
          'correction_kind', 'replace',
          'original_event_id',
            case when intermediate_event.correction_id is null
              then intermediate_event.event_id
              else null
            end,
          'supersedes_correction_id', intermediate_event.correction_id,
          'event_type',
            case
              when intermediate_event.intermediate_position::integer % 2 = 1
                then 'clock_out'
              else 'clock_in'
            end,
          'event_timestamp', intermediate_event.event_timestamp
        )
      );
    end if;
  end loop;

  if right_boundary_count = 0 then
    correction_actions := correction_actions || jsonb_build_array(
      jsonb_build_object(
        'correction_kind', 'add',
        'original_event_id', null,
        'supersedes_correction_id', null,
        'event_type', 'clock_out',
        'event_timestamp', planned_finish_at
      )
    );
  else
    select snapshot.*
    into boundary_event
    from jsonb_to_recordset(effective_events) as snapshot(
      event_id uuid,
      correction_id uuid,
      event_type text,
      event_timestamp timestamptz
    )
    where snapshot.event_timestamp >= planned_finish_at;

    if boundary_event.event_type <> 'clock_out'
      or boundary_event.event_timestamp <> planned_finish_at then
      correction_actions := correction_actions || jsonb_build_array(
        jsonb_build_object(
          'correction_kind', 'replace',
          'original_event_id',
            case when boundary_event.correction_id is null
              then boundary_event.event_id
              else null
            end,
          'supersedes_correction_id', boundary_event.correction_id,
          'event_type', 'clock_out',
          'event_timestamp', planned_finish_at
        )
      );
    end if;
  end if;

  if jsonb_array_length(correction_actions) = 0 then
    return null;
  end if;

  correction_batch_id := gen_random_uuid();

  insert into public.clock_event_corrections (
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
    correction_batch_id,
    case when action.ordinal = 1 then 'primary' else 'consequential' end,
    target_staff_id,
    action.item ->> 'correction_kind',
    nullif(action.item ->> 'original_event_id', '')::uuid,
    nullif(action.item ->> 'supersedes_correction_id', '')::uuid,
    action.item ->> 'event_type',
    (action.item ->> 'event_timestamp')::timestamptz,
    target_date,
    trim(reason),
    manager_account.id
  from jsonb_array_elements(correction_actions)
    with ordinality as action(item, ordinal)
  order by action.ordinal;

  return correction_batch_id;
end;
$$;

revoke all on function public.use_planned_hours(text, date, text)
from public, anon, authenticated;
grant execute on function public.use_planned_hours(text, date, text) to authenticated;

create or replace function public.get_staff_weekly_hours(
  target_staff_id text,
  reference_date date default null
)
returns table (
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  range_start date;
  range_end date;
begin
  select start_date, end_date
  into range_start, range_end
  from public.get_current_work_week_range(reference_date);

  return query
  with ordered as (
    select
      ce.event_type,
      ce.event_timestamp,
      lead(ce.event_type) over (
        order by ce.event_timestamp, ce.event_id
      ) as next_event_type,
      lead(ce.event_timestamp) over (
        order by ce.event_timestamp, ce.event_id
      ) as next_event_timestamp
    from public.get_effective_clock_events(range_start, range_end, target_staff_id) ce
  )
  select
    range_start,
    range_end,
    coalesce(sum(
      case
        when event_type = 'clock_in'
          and next_event_type = 'clock_out'
          and next_event_timestamp >= event_timestamp
        then round(extract(epoch from (next_event_timestamp - event_timestamp)) / 60)::integer
        else 0
      end
    ), 0)::integer,
    coalesce(bool_or(event_type = 'clock_in' and next_event_type is null), false)
  from ordered;
end;
$$;

revoke all on function public.get_staff_weekly_hours(text, date)
from public, anon, authenticated;

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
  if (range_end - range_start) + 1 > 366 then
    raise exception 'Choose a valid date range of up to 366 days';
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
      lead(ce.event_type) over (
        partition by ce.staff_id
        order by ce.event_timestamp, ce.event_id
      ) as next_event_type,
      lead(ce.event_timestamp) over (
        partition by ce.staff_id
        order by ce.event_timestamp, ce.event_id
      ) as next_event_timestamp
    from public.get_effective_clock_events(range_start, range_end, null) ce
    join active_staff staff on staff.id = ce.staff_id
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
      count(*) filter (
        where ordered.event_type = 'clock_in'
          and ordered.next_event_type is null
      )::integer as open_shift_count
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

revoke all on function public.get_manager_hours_preview(date, date)
from public, anon, authenticated;
grant execute on function public.get_manager_hours_preview(date, date) to authenticated;

create or replace function public.get_latest_effective_clock_event(
  target_staff_id text,
  reference_date date default null,
  lookback_days integer default 366
)
returns table (
  event_id uuid,
  event_type text,
  event_timestamp timestamptz,
  recorded_date date
)
language sql
security definer
set search_path = public
stable
as $$
  select
    effective.event_id,
    effective.event_type,
    effective.event_timestamp,
    effective.recorded_date
  from public.get_effective_clock_events(
    coalesce(
      reference_date,
      (now() at time zone 'Europe/London')::date
    ) - (
      least(greatest(coalesce(lookback_days, 366), 1), 366) - 1
    ),
    coalesce(
      reference_date,
      (now() at time zone 'Europe/London')::date
    ),
    target_staff_id
  ) effective
  order by effective.event_timestamp desc, effective.event_id desc
  limit 1;
$$;

revoke all on function public.get_latest_effective_clock_event(text, date, integer)
from public, anon, authenticated;

create or replace function public.get_manager_kiosk_statuses(
  reference_date date default null
)
returns table (
  staff_id text,
  current_status text
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

  return query
  select
    profile.id,
    case
      when latest.event_type = 'clock_in' then 'clocked_in'
      else 'clocked_out'
    end
  from public.staff_profiles profile
  left join lateral public.get_latest_effective_clock_event(
    profile.id,
    reference_date,
    366
  ) latest on true
  where profile.active = true
  order by profile.full_name, profile.id;
end;
$$;

revoke all on function public.get_manager_kiosk_statuses(date)
from public, anon, authenticated;
grant execute on function public.get_manager_kiosk_statuses(date) to authenticated;

create or replace function public.get_kiosk_roster()
returns table (
  staff_id text,
  display_name text,
  full_name text,
  employment_role text,
  current_status text,
  pin_ready boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    profile.id,
    coalesce(nullif(trim(profile.display_name), ''), profile.full_name),
    profile.full_name,
    profile.employment_role,
    case
      when latest.event_type = 'clock_in' then 'clocked_in'
      else 'clocked_out'
    end,
    settings.pin_hash is not null
  from public.staff_profiles profile
  join public.staff_kiosk_settings settings
    on settings.staff_id = profile.id
  left join lateral public.get_latest_effective_clock_event(
    profile.id,
    null,
    366
  ) latest on true
  where profile.active = true
    and settings.kiosk_enabled = true
  order by coalesce(nullif(trim(profile.display_name), ''), profile.full_name);
$$;

revoke all on function public.get_kiosk_roster()
from public, anon, authenticated;

create or replace function public.verify_kiosk_pin(
  target_staff_id text,
  candidate_pin text
)
returns table (
  ok boolean,
  code text,
  current_status text,
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  failures integer;
  hours_row record;
begin
  select kiosk_settings.*
  into settings
  from public.staff_kiosk_settings kiosk_settings
  join public.staff_profiles profile
    on profile.id = kiosk_settings.staff_id
  where kiosk_settings.staff_id = target_staff_id
    and profile.active = true
  for update of kiosk_settings;

  if not found or not settings.kiosk_enabled then
    return query
    select false, 'unavailable', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.locked_until is not null and settings.locked_until > now() then
    return query
    select false, 'locked', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.pin_hash is null then
    return query
    select false, 'reset_required', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set
      failed_attempt_count = failures,
      locked_until = case
        when failures >= 4 then now() + interval '15 minutes'
        else null
      end
    where staff_id = target_staff_id;

    return query
    select
      false,
      case
        when failures >= 4 then 'locked'
        when failures = 3 then 'invalid_pin_attempt_3'
        when failures = 2 then 'invalid_pin_attempt_2'
        else 'invalid_pin_attempt_1'
      end,
      null::text,
      null::date,
      null::date,
      null::integer,
      false;
    return;
  end if;

  update public.staff_kiosk_settings
  set failed_attempt_count = 0, locked_until = null
  where staff_id = target_staff_id;

  select latest.event_type
  into latest_type
  from public.get_latest_effective_clock_event(target_staff_id, null, 366) latest;

  select *
  into hours_row
  from public.get_staff_weekly_hours(target_staff_id);

  return query
  select
    true,
    case when settings.pin_reset_required then 'change_required' else 'ok' end,
    case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
    hours_row.work_week_start_date,
    hours_row.work_week_end_date,
    hours_row.completed_minutes,
    hours_row.open_shift_in_progress;
end;
$$;

revoke all on function public.verify_kiosk_pin(text, text)
from public, anon, authenticated;

create or replace function public.change_device_kiosk_pin(
  device_token text,
  target_staff_id text,
  temporary_pin text,
  new_pin text
)
returns table (
  ok boolean,
  code text,
  current_status text,
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  failures integer;
  hours_row record;
begin
  perform public.require_kiosk_device(device_token);

  select kiosk_settings.*
  into settings
  from public.staff_kiosk_settings kiosk_settings
  join public.staff_profiles profile
    on profile.id = kiosk_settings.staff_id
  where kiosk_settings.staff_id = target_staff_id
    and profile.active = true
  for update of kiosk_settings;

  if not found or not settings.kiosk_enabled then
    return query
    select false, 'unavailable', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.locked_until is not null and settings.locked_until > now() then
    return query
    select false, 'locked', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if settings.pin_hash is null or not settings.pin_reset_required then
    return query
    select false, 'change_not_required', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if crypt(temporary_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set
      failed_attempt_count = failures,
      locked_until = case
        when failures >= 4 then now() + interval '15 minutes'
        else null
      end
    where staff_id = target_staff_id;

    return query
    select
      false,
      case
        when failures >= 4 then 'locked'
        when failures = 3 then 'invalid_pin_attempt_3'
        when failures = 2 then 'invalid_pin_attempt_2'
        else 'invalid_pin_attempt_1'
      end,
      null::text,
      null::date,
      null::date,
      null::integer,
      false;
    return;
  end if;
  if not public.kiosk_pin_is_acceptable(new_pin) then
    return query
    select false, 'weak_pin', null::text, null::date, null::date, null::integer, false;
    return;
  end if;
  if crypt(new_pin, settings.pin_hash) = settings.pin_hash then
    return query
    select false, 'same_pin', null::text, null::date, null::date, null::integer, false;
    return;
  end if;

  update public.staff_kiosk_settings
  set
    pin_hash = crypt(new_pin, gen_salt('bf', 12)),
    pin_updated_at = now(),
    pin_updated_by = null,
    pin_reset_required = false,
    failed_attempt_count = 0,
    locked_until = null
  where staff_id = target_staff_id;

  select latest.event_type
  into latest_type
  from public.get_latest_effective_clock_event(target_staff_id, null, 366) latest;

  select *
  into hours_row
  from public.get_staff_weekly_hours(target_staff_id);

  return query
  select
    true,
    'pin_changed',
    case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
    hours_row.work_week_start_date,
    hours_row.work_week_end_date,
    hours_row.completed_minutes,
    hours_row.open_shift_in_progress;
end;
$$;

revoke all on function public.change_device_kiosk_pin(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.change_device_kiosk_pin(text, text, text, text)
to anon, authenticated;

create or replace function public.record_kiosk_clock_event(
  target_staff_id text,
  candidate_pin text,
  requested_event_type text,
  device_identifier text default null
)
returns table (
  ok boolean,
  code text,
  current_status text,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  settings public.staff_kiosk_settings%rowtype;
  latest_type text;
  latest_at timestamptz;
  created_event_at timestamptz;
  failures integer;
begin
  if requested_event_type not in ('clock_in', 'clock_out') then
    return query select false, 'invalid_event', null::text, null::timestamptz;
    return;
  end if;

  select kiosk_settings.*
  into settings
  from public.staff_kiosk_settings kiosk_settings
  join public.staff_profiles profile
    on profile.id = kiosk_settings.staff_id
  where kiosk_settings.staff_id = target_staff_id
    and profile.active = true
  for update of kiosk_settings;

  if not found or not settings.kiosk_enabled then
    return query select false, 'unavailable', null::text, null::timestamptz;
    return;
  end if;
  if settings.locked_until is not null and settings.locked_until > now() then
    return query select false, 'locked', null::text, null::timestamptz;
    return;
  end if;
  if settings.pin_hash is null or settings.pin_reset_required then
    return query select false, 'reset_required', null::text, null::timestamptz;
    return;
  end if;
  if crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    failures := settings.failed_attempt_count + 1;
    update public.staff_kiosk_settings
    set
      failed_attempt_count = failures,
      locked_until = case
        when failures >= 4 then now() + interval '15 minutes'
        else null
      end
    where staff_id = target_staff_id;

    return query
    select
      false,
      case
        when failures >= 4 then 'locked'
        when failures = 3 then 'invalid_pin_attempt_3'
        when failures = 2 then 'invalid_pin_attempt_2'
        else 'invalid_pin_attempt_1'
      end,
      null::text,
      null::timestamptz;
    return;
  end if;

  update public.staff_kiosk_settings
  set failed_attempt_count = 0, locked_until = null
  where staff_id = target_staff_id;

  perform public.lock_attendance_staff_writes(target_staff_id);

  select latest.event_type, latest.event_timestamp
  into latest_type, latest_at
  from public.get_latest_effective_clock_event(target_staff_id, null, 366) latest;

  if requested_event_type = 'clock_in' and latest_type = 'clock_in' then
    return query select false, 'already_clocked_in', 'clocked_in', null::timestamptz;
    return;
  end if;
  if requested_event_type = 'clock_out'
    and coalesce(latest_type, 'clock_out') = 'clock_out' then
    return query select false, 'not_clocked_in', 'clocked_out', null::timestamptz;
    return;
  end if;
  if latest_at is not null and latest_at > now() - interval '5 seconds' then
    return query
    select
      false,
      'too_soon',
      case when latest_type = 'clock_in' then 'clocked_in' else 'clocked_out' end,
      null::timestamptz;
    return;
  end if;

  insert into public.clock_events (
    staff_id,
    event_type,
    kiosk_device_id
  )
  values (
    target_staff_id,
    requested_event_type,
    nullif(left(trim(device_identifier), 100), '')
  )
  returning event_timestamp into created_event_at;

  return query
  select
    true,
    'recorded',
    case
      when requested_event_type = 'clock_in' then 'clocked_in'
      else 'clocked_out'
    end,
    created_event_at;
end;
$$;

revoke all on function public.record_kiosk_clock_event(text, text, text, text)
from public, anon, authenticated;

revoke all on function public.get_device_kiosk_roster(text)
from public, anon, authenticated;
revoke all on function public.verify_device_kiosk_pin(text, text, text)
from public, anon, authenticated;
revoke all on function public.record_device_kiosk_clock_event(text, text, text, text)
from public, anon, authenticated;

grant execute on function public.get_device_kiosk_roster(text) to anon, authenticated;
grant execute on function public.verify_device_kiosk_pin(text, text, text) to anon, authenticated;
grant execute on function public.record_device_kiosk_clock_event(text, text, text, text)
to anon, authenticated;
