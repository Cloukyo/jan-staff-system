create or replace function public.get_manager_dashboard_summary(reference_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  manager_account public.staff_accounts;
  dashboard_date date := coalesce(reference_date, (now() at time zone 'Europe/London')::date);
  dashboard_week_start date := dashboard_date - (extract(isodow from dashboard_date)::integer - 1);
  result jsonb;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  with
  active_staff as (
    select id, display_name, full_name
    from public.staff_profiles
    where active = true
  ),
  latest_events as (
    select distinct on (ce.staff_id)
      ce.staff_id,
      ce.event_type,
      ce.event_timestamp,
      ce.recorded_date
    from public.clock_events ce
    join active_staff staff on staff.id = ce.staff_id
    order by ce.staff_id, ce.event_timestamp desc, ce.created_at desc
  ),
  today_events as (
    select
      ce.staff_id,
      count(*) filter (where ce.event_type = 'clock_in')::integer as clock_in_count,
      count(*) filter (where ce.event_type = 'clock_out')::integer as clock_out_count,
      min(ce.event_timestamp) filter (where ce.event_type = 'clock_in') as first_clock_in
    from public.clock_events ce
    join active_staff staff on staff.id = ce.staff_id
    where ce.recorded_date = dashboard_date
    group by ce.staff_id
  ),
  today_shifts as (
    select
      rs.id,
      rs.staff_id,
      rs.start_time,
      rs.end_time,
      rs.break_minutes,
      rs.room_or_area,
      rs.role_on_shift
    from public.rota_shifts rs
    join public.rota_weeks rw on rw.id = rs.rota_week_id
    join active_staff staff on staff.id = rs.staff_id
    where rs.shift_date = dashboard_date
      and rs.archived_at is null
      and rs.status = 'scheduled'
      and rw.status <> 'archived'
  ),
  scheduled_by_staff as (
    select staff_id, count(*)::integer as scheduled_count, min(start_time) as scheduled_start, max(end_time) as scheduled_end
    from today_shifts
    group by staff_id
  ),
  attendance_exceptions as (
    select
      staff.id as staff_id,
      case
        when coalesce(shifts.scheduled_count, 0) > 0
          and coalesce(events.clock_in_count, 0) = 0
          and (
            dashboard_date < (now() at time zone 'Europe/London')::date
            or (
              dashboard_date = (now() at time zone 'Europe/London')::date
              and shifts.scheduled_start <= (now() at time zone 'Europe/London')::time
            )
          )
          then 'Scheduled shift has no clock-in'
        when coalesce(events.clock_in_count, 0) > 0 and coalesce(shifts.scheduled_count, 0) = 0 then 'Clocked in without a scheduled shift'
        when coalesce(events.clock_out_count, 0) > coalesce(events.clock_in_count, 0) then 'Clock-out without a matching clock-in'
        when coalesce(events.clock_in_count, 0) - coalesce(events.clock_out_count, 0) > 1 then 'Multiple unmatched clock-ins'
        else null
      end as warning
    from active_staff staff
    left join today_events events on events.staff_id = staff.id
    left join scheduled_by_staff shifts on shifts.staff_id = staff.id
  ),
  missing_clock_outs as (
    select latest.staff_id, latest.event_timestamp
    from latest_events latest
    where latest.event_type = 'clock_in'
      and latest.event_timestamp < now() - interval '12 hours'
  ),
  current_week as (
    select rw.id, rw.status, rw.week_start_date, rw.published_at
    from public.rota_weeks rw
    where rw.week_start_date = dashboard_week_start
      and rw.status <> 'archived'
    order by rw.created_at desc
    limit 1
  ),
  approved_leave_conflicts as (
    select distinct rs.id
    from public.rota_shifts rs
    join public.rota_weeks rw on rw.id = rs.rota_week_id and rw.status <> 'archived'
    join public.leave_requests lr
      on lr.staff_id = rs.staff_id
      and lr.status = 'approved'
      and rs.shift_date between lr.start_date and lr.end_date
      and (
        lr.day_part = 'full_day'
        or (
          lr.start_time is not null
          and lr.end_time is not null
          and rs.start_time < lr.end_time
          and rs.end_time > lr.start_time
        )
      )
    where rs.archived_at is null
      and rs.status = 'scheduled'
      and rs.shift_date >= dashboard_date
  ),
  central_item_status as (
    select
      staff.id as staff_id,
      count(items.id)::integer as item_count,
      count(items.id) filter (where items.status in ('complete', 'not_applicable'))::integer as completed_count
    from active_staff staff
    left join public.staff_central_record_items items on items.staff_id = staff.id
    group by staff.id
  ),
  central_legacy_status as (
    select
      staff.id as staff_id,
      (
        coalesce(record.appointment_induction_completed, false)::integer +
        coalesce(record.contract_form, false)::integer +
        coalesce(record.id_checked, false)::integer +
        coalesce(record.address_evidence_checked, false)::integer +
        coalesce(record.additional_employment_tax_evidence_checked, false)::integer +
        coalesce(record.dbs_recorded, false)::integer +
        coalesce(record.references_complete, false)::integer +
        coalesce(record.starter_form, false)::integer +
        coalesce(record.suitability_declaration, false)::integer +
        coalesce(record.medical_declaration, false)::integer +
        coalesce(record.employee_information_form, false)::integer
      ) as completed_count
    from active_staff staff
    left join public.staff_central_records record on record.staff_id = staff.id
  ),
  currently_clocked_in as (
    select
      staff.id as staff_id,
      coalesce(nullif(trim(staff.display_name), ''), staff.full_name) as display_name,
      latest.event_timestamp as clocked_in_at,
      shifts.scheduled_end
    from active_staff staff
    join latest_events latest on latest.staff_id = staff.id and latest.event_type = 'clock_in'
    left join scheduled_by_staff shifts on shifts.staff_id = staff.id
    order by latest.event_timestamp
  ),
  upcoming_shifts as (
    select
      rs.id,
      rs.shift_date,
      coalesce(nullif(trim(staff.display_name), ''), staff.full_name) as display_name,
      rs.start_time,
      rs.end_time,
      rs.room_or_area,
      rs.role_on_shift,
      rw.status as rota_status
    from public.rota_shifts rs
    join public.rota_weeks rw on rw.id = rs.rota_week_id and rw.status <> 'archived'
    join active_staff staff on staff.id = rs.staff_id
    where rs.shift_date between dashboard_date and dashboard_date + 1
      and rs.archived_at is null
      and rs.status = 'scheduled'
    order by rs.shift_date, rs.start_time, display_name
    limit 12
  ),
  exception_list as (
    select
      staff.id as staff_id,
      coalesce(nullif(trim(staff.display_name), ''), staff.full_name) as display_name,
      exceptions.warning,
      dashboard_date as warning_date
    from attendance_exceptions exceptions
    join active_staff staff on staff.id = exceptions.staff_id
    where exceptions.warning is not null
    union all
    select
      staff.id,
      coalesce(nullif(trim(staff.display_name), ''), staff.full_name),
      'Missing clock-out',
      (missing.event_timestamp at time zone 'Europe/London')::date
    from missing_clock_outs missing
    join active_staff staff on staff.id = missing.staff_id
  )
  select jsonb_build_object(
    'reference_date', dashboard_date,
    'week_start_date', dashboard_week_start,
    'active_staff', (select count(*) from active_staff),
    'currently_clocked_in', (select count(*) from currently_clocked_in),
    'today_scheduled_shifts', (select count(*) from today_shifts),
    'today_attendance_exceptions', (select count(*) from attendance_exceptions where warning is not null),
    'missing_clock_outs', (select count(*) from missing_clock_outs),
    'pending_leave_requests', (select count(*) from public.leave_requests where status = 'pending'),
    'approved_leave_rota_conflicts', (select count(*) from approved_leave_conflicts),
    'expired_certificates', (
      select count(*)
      from public.staff_certificates certificate
      join active_staff staff on staff.id = certificate.staff_id
      where certificate.archived_at is null
        and certificate.permanent = false
        and certificate.expiry_date < dashboard_date
    ),
    'certificates_expiring_30_days', (
      select count(*)
      from public.staff_certificates certificate
      join active_staff staff on staff.id = certificate.staff_id
      where certificate.archived_at is null
        and certificate.permanent = false
        and certificate.expiry_date between dashboard_date and dashboard_date + 30
    ),
    'incomplete_central_records', (
      select count(*)
      from central_item_status items
      join central_legacy_status legacy on legacy.staff_id = items.staff_id
      where case
        when items.item_count > 0 then items.item_count < 11 or items.completed_count < items.item_count
        else legacy.completed_count < 11
      end
    ),
    'staff_missing_kiosk_pin', (
      select count(*)
      from active_staff staff
      left join public.staff_kiosk_settings kiosk on kiosk.staff_id = staff.id
      where kiosk.staff_id is null
        or kiosk.pin_hash is null
        or kiosk.pin_reset_required = true
    ),
    'staff_missing_pay_arrangement', (
      select count(*)
      from active_staff staff
      where not exists (
        select 1
        from public.staff_pay_arrangements arrangement
        where arrangement.staff_id = staff.id
          and arrangement.is_active = true
          and arrangement.effective_from <= dashboard_date
          and (arrangement.effective_to is null or arrangement.effective_to >= dashboard_date)
      )
    ),
    'current_rota', (
      select coalesce(
        jsonb_build_object(
          'id', week.id,
          'status', week.status,
          'week_start_date', week.week_start_date,
          'published_at', week.published_at
        ),
        'null'::jsonb
      )
      from (select 1) seed
      left join current_week week on true
    ),
    'clocked_in_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', row.staff_id,
        'display_name', row.display_name,
        'clocked_in_at', row.clocked_in_at,
        'scheduled_end', row.scheduled_end
      ))
      from currently_clocked_in row
    ), '[]'::jsonb),
    'attendance_warnings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', row.staff_id,
        'display_name', row.display_name,
        'warning', row.warning,
        'warning_date', row.warning_date
      ) order by row.warning_date desc, row.display_name)
      from (select * from exception_list limit 8) row
    ), '[]'::jsonb),
    'upcoming_shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id,
        'shift_date', row.shift_date,
        'display_name', row.display_name,
        'start_time', row.start_time,
        'end_time', row.end_time,
        'room_or_area', row.room_or_area,
        'role_on_shift', row.role_on_shift,
        'rota_status', row.rota_status
      ))
      from upcoming_shifts row
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_manager_dashboard_summary(date) from public, anon, authenticated;
grant execute on function public.get_manager_dashboard_summary(date) to authenticated;
