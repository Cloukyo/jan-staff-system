create or replace function public.save_rota_week_as_template(
  source_week_id uuid,
  template_name text,
  template_description text default null,
  include_cancelled boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  new_template_id uuid;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then raise exception 'Manager access required'; end if;
  if nullif(trim(template_name), '') is null then raise exception 'Template name is required'; end if;
  if not exists (select 1 from public.rota_weeks where id = source_week_id) then
    raise exception 'Rota week not found';
  end if;

  insert into public.rota_templates (
    name, description, source_type, created_by, updated_by
  ) values (
    trim(template_name), nullif(trim(template_description), ''), 'saved_from_rota',
    manager_account.id, manager_account.id
  ) returning id into new_template_id;

  insert into public.rota_template_shifts (
    template_id, staff_id, day_of_week, start_time, end_time, break_minutes,
    room_or_area, role_on_shift, notes, sort_order, created_by, updated_by
  )
  select
    new_template_id, shift.staff_id, extract(isodow from shift.shift_date)::smallint,
    shift.start_time, shift.end_time, shift.break_minutes, shift.room_or_area,
    shift.role_on_shift, shift.notes,
    row_number() over (order by shift.shift_date, shift.start_time, shift.staff_id)::integer,
    manager_account.id, manager_account.id
  from public.rota_shifts shift
  where shift.rota_week_id = source_week_id
    and shift.archived_at is null
    and (include_cancelled or shift.status <> 'cancelled');

  return new_template_id;
end;
$$;

create or replace function public.apply_rota_template(
  source_template_id uuid,
  target_week_id uuid,
  requested_mode public.rota_template_apply_mode,
  request_key uuid,
  confirm_replace boolean default false,
  leave_override_reason text default null,
  overlap_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  source_template public.rota_templates;
  target_week public.rota_weeks;
  application_id uuid;
  existing_application public.rota_template_applications;
  archived_count integer := 0;
  created_count integer := 0;
  eligible_count integer := 0;
  approved_leave_count integer := 0;
  overlap_count integer := 0;
  inactive_count integer := 0;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then raise exception 'Manager access required'; end if;

  select * into existing_application
  from public.rota_template_applications application
  where application.request_key = apply_rota_template.request_key;
  if found then
    return jsonb_build_object(
      'application_id', existing_application.id,
      'created_shifts', existing_application.created_shifts,
      'archived_shifts', existing_application.archived_shifts,
      'skipped_shifts', existing_application.skipped_shifts,
      'retried', true
    );
  end if;

  select * into source_template
  from public.rota_templates
  where id = source_template_id and status = 'active';
  if not found then raise exception 'Active template not found'; end if;

  select * into target_week
  from public.rota_weeks
  where id = target_week_id and status = 'draft';
  if not found then raise exception 'Templates can only be applied to a draft rota'; end if;
  if requested_mode = 'replace' and not confirm_replace then
    raise exception 'Replace mode requires explicit confirmation';
  end if;

  with candidates as (
    select
      template_shift.*,
      target_week.week_start_date + (template_shift.day_of_week - 1) as target_date
    from public.rota_template_shifts template_shift
    where template_shift.template_id = source_template_id
      and template_shift.archived_at is null
      and (
        requested_mode <> 'empty_days'
        or not exists (
          select 1 from public.rota_shifts existing
          where existing.rota_week_id = target_week_id
            and existing.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
            and existing.archived_at is null
            and existing.status <> 'cancelled'
        )
      )
      and (
        requested_mode = 'replace'
        or not exists (
          select 1 from public.rota_shifts duplicate
          where duplicate.rota_week_id = target_week_id
            and duplicate.staff_id = template_shift.staff_id
            and duplicate.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
            and duplicate.start_time = template_shift.start_time
            and duplicate.end_time = template_shift.end_time
            and duplicate.archived_at is null
            and duplicate.status <> 'cancelled'
        )
      )
  )
  select
    count(*),
    count(*) filter (where not staff.active)
  into eligible_count, inactive_count
  from candidates candidate
  join public.staff_profiles staff on staff.id = candidate.staff_id;
  if inactive_count > 0 then raise exception 'Inactive staff must be resolved before applying a template'; end if;

  with candidates as (
    select
      template_shift.*,
      target_week.week_start_date + (template_shift.day_of_week - 1) as target_date
    from public.rota_template_shifts template_shift
    where template_shift.template_id = source_template_id
      and template_shift.archived_at is null
      and (
        requested_mode <> 'empty_days'
        or not exists (
          select 1 from public.rota_shifts existing
          where existing.rota_week_id = target_week_id
            and existing.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
            and existing.archived_at is null
            and existing.status <> 'cancelled'
        )
      )
      and (
        requested_mode = 'replace'
        or not exists (
          select 1 from public.rota_shifts duplicate
          where duplicate.rota_week_id = target_week_id
            and duplicate.staff_id = template_shift.staff_id
            and duplicate.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
            and duplicate.start_time = template_shift.start_time
            and duplicate.end_time = template_shift.end_time
            and duplicate.archived_at is null
            and duplicate.status <> 'cancelled'
        )
      )
  )
  select count(*) into approved_leave_count
  from candidates candidate
  where exists (
    select 1 from public.leave_requests leave_request
    where leave_request.staff_id = candidate.staff_id
      and leave_request.status = 'approved'
      and candidate.target_date between leave_request.start_date and leave_request.end_date
      and (
        leave_request.day_part = 'full_day'
        or (
          leave_request.start_date = candidate.target_date
          and candidate.start_time < leave_request.end_time
          and candidate.end_time > leave_request.start_time
        )
      )
  );
  if approved_leave_count > 0 and nullif(trim(leave_override_reason), '') is null then
    raise exception 'Approved leave conflict requires an override reason';
  end if;

  if requested_mode <> 'replace' then
    with candidates as (
      select
        template_shift.*,
        target_week.week_start_date + (template_shift.day_of_week - 1) as target_date
      from public.rota_template_shifts template_shift
      where template_shift.template_id = source_template_id
        and template_shift.archived_at is null
        and (
          requested_mode <> 'empty_days'
          or not exists (
            select 1 from public.rota_shifts existing
            where existing.rota_week_id = target_week_id
              and existing.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
              and existing.archived_at is null
              and existing.status <> 'cancelled'
          )
        )
        and not exists (
          select 1 from public.rota_shifts duplicate
          where duplicate.rota_week_id = target_week_id
            and duplicate.staff_id = template_shift.staff_id
            and duplicate.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
            and duplicate.start_time = template_shift.start_time
            and duplicate.end_time = template_shift.end_time
            and duplicate.archived_at is null
            and duplicate.status <> 'cancelled'
        )
    )
    select count(*) into overlap_count
    from candidates candidate
    where exists (
      select 1 from public.rota_shifts existing
      where existing.rota_week_id = target_week_id
        and existing.staff_id = candidate.staff_id
        and existing.shift_date = candidate.target_date
        and existing.archived_at is null
        and existing.status <> 'cancelled'
        and candidate.start_time < existing.end_time
        and candidate.end_time > existing.start_time
    );
    if overlap_count > 0 and nullif(trim(overlap_override_reason), '') is null then
      raise exception 'Overlapping shift requires an override reason';
    end if;
  end if;

  insert into public.rota_template_applications (
    request_key, template_id, rota_week_id, apply_mode, applied_by
  ) values (
    request_key, source_template_id, target_week_id, requested_mode, manager_account.id
  ) returning id into application_id;

  if requested_mode = 'replace' then
    update public.rota_shifts existing
    set archived_at = now(), archived_by = manager_account.id, updated_by = manager_account.id
    where existing.rota_week_id = target_week_id
      and existing.archived_at is null
      and extract(isodow from existing.shift_date)::smallint in (
        select distinct day_of_week from public.rota_template_shifts
        where template_id = source_template_id and archived_at is null
      );
    get diagnostics archived_count = row_count;
  end if;

  with candidates as (
    select
      template_shift.*,
      target_week.week_start_date + (template_shift.day_of_week - 1) as target_date
    from public.rota_template_shifts template_shift
    where template_shift.template_id = source_template_id
      and template_shift.archived_at is null
      and (
        requested_mode <> 'empty_days'
        or not exists (
          select 1 from public.rota_shifts existing
          where existing.rota_week_id = target_week_id
            and existing.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
            and existing.archived_at is null
            and existing.status <> 'cancelled'
        )
      )
      and (
        requested_mode = 'replace'
        or not exists (
          select 1 from public.rota_shifts duplicate
          where duplicate.rota_week_id = target_week_id
            and duplicate.staff_id = template_shift.staff_id
            and duplicate.shift_date = target_week.week_start_date + (template_shift.day_of_week - 1)
            and duplicate.start_time = template_shift.start_time
            and duplicate.end_time = template_shift.end_time
            and duplicate.archived_at is null
            and duplicate.status <> 'cancelled'
        )
      )
  )
  insert into public.rota_shifts (
    rota_week_id, staff_id, shift_date, start_time, end_time, break_minutes,
    room_or_area, role_on_shift, notes, status, leave_override_reason,
    overlap_override_reason, created_by, updated_by,
    source_template_shift_id, template_application_id
  )
  select
    target_week_id, candidate.staff_id, candidate.target_date, candidate.start_time,
    candidate.end_time, candidate.break_minutes, candidate.room_or_area,
    candidate.role_on_shift, candidate.notes, 'scheduled',
    case when approved_leave_count > 0 then nullif(trim(leave_override_reason), '') end,
    case when overlap_count > 0 then nullif(trim(overlap_override_reason), '') end,
    manager_account.id, manager_account.id, candidate.id, application_id
  from candidates candidate
  on conflict do nothing;
  get diagnostics created_count = row_count;

  update public.rota_template_applications
  set created_shifts = created_count,
      archived_shifts = archived_count,
      skipped_shifts = greatest(eligible_count - created_count, 0)
  where id = application_id;

  return jsonb_build_object(
    'application_id', application_id,
    'created_shifts', created_count,
    'archived_shifts', archived_count,
    'skipped_shifts', greatest(eligible_count - created_count, 0),
    'retried', false
  );
end;
$$;
