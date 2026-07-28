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
  correction_batch_id uuid := gen_random_uuid();
  planned_start time;
  planned_finish time;
  planned_start_at timestamptz;
  planned_finish_at timestamptz;
  event_count integer;
  effective_event record;
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

  perform 1
  from public.clock_events event
  where event.staff_id = target_staff_id
    and event.recorded_date = target_date
  for update;

  perform 1
  from public.clock_event_corrections correction
  where correction.staff_id = target_staff_id
    and correction.recorded_date = target_date
  for update;

  select count(*)
  into event_count
  from public.get_effective_clock_events(target_date, target_date, target_staff_id);

  if event_count = 0 then
    insert into public.clock_event_corrections (
      batch_id, correction_role, staff_id, correction_kind,
      event_type, event_timestamp, recorded_date, reason, created_by
    )
    values
      (
        correction_batch_id, 'primary', target_staff_id, 'add',
        'clock_in', planned_start_at, target_date, trim(reason), manager_account.id
      ),
      (
        correction_batch_id, 'consequential', target_staff_id, 'add',
        'clock_out', planned_finish_at, target_date, trim(reason), manager_account.id
      );

    return correction_batch_id;
  end if;

  for effective_event in
    select
      ce.*,
      row_number() over (order by ce.event_timestamp, ce.event_id) as event_position,
      count(*) over () as event_count
    from public.get_effective_clock_events(target_date, target_date, target_staff_id) ce
  loop
    if effective_event.event_position = 1
      and (
        effective_event.event_type <> 'clock_in'
        or effective_event.event_timestamp <> planned_start_at
      ) then
      insert into public.clock_event_corrections (
        batch_id, correction_role, staff_id, correction_kind,
        original_event_id, supersedes_correction_id,
        event_type, event_timestamp, recorded_date, reason, created_by
      )
      values (
        correction_batch_id,
        'primary',
        target_staff_id,
        'replace',
        case when effective_event.correction_id is null then effective_event.event_id else null end,
        effective_event.correction_id,
        'clock_in',
        planned_start_at,
        target_date,
        trim(reason),
        manager_account.id
      );
    elsif effective_event.event_position = effective_event.event_count
      and effective_event.event_count > 1
      and effective_event.event_count::integer % 2 = 0
      and (
        effective_event.event_type <> 'clock_out'
        or effective_event.event_timestamp <> planned_finish_at
      ) then
      insert into public.clock_event_corrections (
        batch_id, correction_role, staff_id, correction_kind,
        original_event_id, supersedes_correction_id,
        event_type, event_timestamp, recorded_date, reason, created_by
      )
      values (
        correction_batch_id,
        'consequential',
        target_staff_id,
        'replace',
        case when effective_event.correction_id is null then effective_event.event_id else null end,
        effective_event.correction_id,
        'clock_out',
        planned_finish_at,
        target_date,
        trim(reason),
        manager_account.id
      );
    elsif effective_event.event_position > 1
      and (
        effective_event.event_position < effective_event.event_count
        or effective_event.event_count::integer % 2 = 1
      )
      and effective_event.event_type <> (case
        when effective_event.event_position::integer % 2 = 1 then 'clock_in'
        else 'clock_out'
      end) then
      insert into public.clock_event_corrections (
        batch_id, correction_role, staff_id, correction_kind,
        original_event_id, supersedes_correction_id,
        event_type, event_timestamp, recorded_date, reason, created_by
      )
      values (
        correction_batch_id,
        'consequential',
        target_staff_id,
        'replace',
        case when effective_event.correction_id is null then effective_event.event_id else null end,
        effective_event.correction_id,
        case
          when effective_event.event_position::integer % 2 = 1 then 'clock_in'
          else 'clock_out'
        end,
        effective_event.event_timestamp,
        target_date,
        trim(reason),
        manager_account.id
      );
    end if;
  end loop;

  if event_count % 2 = 1 then
    insert into public.clock_event_corrections (
      batch_id, correction_role, staff_id, correction_kind,
      event_type, event_timestamp, recorded_date, reason, created_by
    )
    values (
      correction_batch_id, 'consequential', target_staff_id, 'add',
      'clock_out', planned_finish_at, target_date, trim(reason), manager_account.id
    );
  end if;

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
