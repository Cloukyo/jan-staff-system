create or replace function public.get_commercial_attendance_dashboard(
  target_organisation_id uuid,
  target_site_id uuid,
  reference_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
  week_start date := reference_date - (extract(isodow from reference_date)::integer - 1);
  pay_reference_date date := (date_trunc('month', reference_date::timestamp) + interval '1 month - 1 day')::date;
  can_rota boolean := private.has_site_permission(target_organisation_id, target_site_id, 'rota.read');
  can_leave boolean := private.has_site_permission(target_organisation_id, target_site_id, 'leave.read');
  can_payroll boolean := private.has_site_permission(target_organisation_id, target_site_id, 'payroll.read');
  can_kiosk boolean := private.has_site_permission(target_organisation_id, target_site_id, 'kiosk.read');
  can_compliance boolean := private.has_site_permission(target_organisation_id, target_site_id, 'compliance.read');
begin
  if auth.uid() is null
    or not private.has_site_permission(target_organisation_id, target_site_id, 'attendance.read') then
    raise exception 'attendance dashboard access is not authorised';
  end if;

  with eligible as (
    select distinct profile.id as staff_id
    from public.staff_profiles profile
    join public.staff_site_assignments assignment
      on assignment.organisation_id = profile.organisation_id
     and assignment.staff_id = profile.id
    where profile.organisation_id = target_organisation_id
      and profile.active
      and profile.appointment_date <= reference_date
      and assignment.site_id = target_site_id
      and assignment.effective_from <= reference_date
      and (assignment.effective_to is null or assignment.effective_to >= reference_date)
  ), effective as (
    select event.*,
      row_number() over (
        partition by event.staff_id
        order by event.event_timestamp desc, event.event_order_key desc
      ) as latest_rank
    from private.get_commercial_effective_clock_events(
      target_organisation_id, target_site_id, reference_date, reference_date, null
    ) event
  ), clocked as (
    select * from effective where latest_rank = 1 and event_type = 'clock_in'
  ), issues as (
    select
      count(*) filter (where status::text in ('open', 'under_review'))::integer as unresolved,
      count(*) filter (where status::text in ('open', 'under_review') and exception_type::text = 'missing_clock_out')::integer as missing,
      count(*) filter (where status::text in ('open', 'under_review') and exception_type::text = 'unusually_long_shift')::integer as long_running
    from public.attendance_exceptions
    where organisation_id = target_organisation_id
      and site_id = target_site_id
      and operational_date <= reference_date
  ), current_rota as (
    select rota.id, rota.status, rota.week_start_date, rota.published_at
    from public.rota_weeks rota
    where can_rota
      and rota.organisation_id = target_organisation_id
      and rota.site_id = target_site_id
      and rota.week_start_date = week_start
      and rota.archived_at is null
    order by rota.created_at desc
    limit 1
  ), authority as (
    select
      case when can_rota then (
        select count(*)::integer
        from public.rota_shifts shift
        join public.rota_weeks rota on rota.id = shift.rota_week_id and rota.archived_at is null
        join eligible on eligible.staff_id = shift.staff_id
        where shift.organisation_id = target_organisation_id
          and shift.site_id = target_site_id
          and shift.shift_date = reference_date
          and shift.status::text = 'scheduled'
          and shift.archived_at is null
      ) else null end as today_scheduled_shifts,
      case when can_leave then (
        select count(*)::integer
        from public.leave_requests leave_request
        join eligible on eligible.staff_id = leave_request.staff_id
        where leave_request.organisation_id = target_organisation_id
          and leave_request.source_site_id = target_site_id
          and leave_request.status::text = 'pending'
      ) else null end as pending_leave_requests,
      case when can_leave and can_rota then (
        select count(distinct leave_request.id)::integer
        from public.leave_requests leave_request
        join public.rota_shifts shift
          on shift.organisation_id = leave_request.organisation_id
         and shift.staff_id = leave_request.staff_id
         and shift.site_id = target_site_id
         and shift.shift_date between leave_request.start_date and leave_request.end_date
         and shift.status::text = 'scheduled'
         and shift.archived_at is null
        join public.rota_weeks rota on rota.id = shift.rota_week_id and rota.archived_at is null
        where leave_request.organisation_id = target_organisation_id
          and leave_request.status::text = 'approved'
      ) else null end as approved_leave_rota_conflicts,
      case when can_compliance then (
        select count(*)::integer
        from public.staff_certificates certificate
        join eligible on eligible.staff_id = certificate.staff_id
        where certificate.organisation_id = target_organisation_id
          and certificate.archived_at is null
          and certificate.expiry_date < reference_date
      ) else null end as expired_certificates,
      case when can_compliance then (
        select count(*)::integer
        from public.staff_certificates certificate
        join eligible on eligible.staff_id = certificate.staff_id
        where certificate.organisation_id = target_organisation_id
          and certificate.archived_at is null
          and certificate.expiry_date between reference_date and reference_date + 30
      ) else null end as certificates_expiring_30_days,
      case when can_compliance then (
        select count(*)::integer
        from public.staff_recruitment_readiness readiness
        join eligible on eligible.staff_id = readiness.staff_id
        where readiness.organisation_id = target_organisation_id
          and not readiness.may_begin_work
      ) else null end as incomplete_central_records,
      case when can_kiosk then (
        select count(*)::integer
        from public.staff_kiosk_settings kiosk
        join eligible on eligible.staff_id = kiosk.staff_id
        where kiosk.onboarding_attendance_eligible
          and (not kiosk.kiosk_enabled or nullif(trim(kiosk.pin_hash), '') is null or kiosk.pin_reset_required)
      ) else null end as staff_missing_kiosk_pin,
      case when can_payroll then (
        select count(*)::integer
        from eligible
        where not exists (
          select 1
          from public.staff_pay_arrangements arrangement
          where arrangement.organisation_id = target_organisation_id
            and arrangement.staff_id = eligible.staff_id
            and arrangement.is_active
            and (arrangement.site_id is null or arrangement.site_id = target_site_id)
            and arrangement.effective_from <= pay_reference_date
            and (arrangement.effective_to is null or arrangement.effective_to >= pay_reference_date)
        )
      ) else null end as staff_missing_pay_arrangement
  )
  select jsonb_build_object(
    'reference_date', reference_date,
    'week_start_date', week_start,
    'active_staff', (select count(*) from eligible),
    'currently_clocked_in', (select count(*) from clocked),
    'today_scheduled_shifts', authority.today_scheduled_shifts,
    'today_attendance_exceptions', (
      select count(*) from public.attendance_exceptions
      where organisation_id = target_organisation_id and site_id = target_site_id
        and operational_date = reference_date and status::text in ('open', 'under_review')
    ),
    'unresolved_attendance_issues', issues.unresolved,
    'missing_clock_outs', issues.missing,
    'long_running_shifts', issues.long_running,
    'pending_corrections', (
      select count(*) from public.attendance_correction_requests
      where organisation_id = target_organisation_id and site_id = target_site_id and status::text = 'pending'
    ),
    'pending_leave_requests', authority.pending_leave_requests,
    'approved_leave_rota_conflicts', authority.approved_leave_rota_conflicts,
    'expired_certificates', authority.expired_certificates,
    'certificates_expiring_30_days', authority.certificates_expiring_30_days,
    'incomplete_central_records', authority.incomplete_central_records,
    'staff_missing_kiosk_pin', authority.staff_missing_kiosk_pin,
    'staff_missing_pay_arrangement', authority.staff_missing_pay_arrangement,
    'requires_manager_action',
      issues.unresolved > 0
      or (select count(*) from public.attendance_correction_requests
          where organisation_id = target_organisation_id and site_id = target_site_id and status::text = 'pending') > 0
      or coalesce(authority.pending_leave_requests, 0) > 0
      or coalesce(authority.approved_leave_rota_conflicts, 0) > 0
      or coalesce(authority.expired_certificates, 0) > 0
      or coalesce(authority.certificates_expiring_30_days, 0) > 0
      or coalesce(authority.incomplete_central_records, 0) > 0
      or coalesce(authority.staff_missing_kiosk_pin, 0) > 0
      or coalesce(authority.staff_missing_pay_arrangement, 0) > 0,
    'current_rota', (
      select jsonb_build_object('id', rota.id, 'status', rota.status,
        'week_start_date', rota.week_start_date, 'published_at', rota.published_at)
      from current_rota rota
    ),
    'clocked_in_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', clocked.staff_id,
        'display_name', coalesce(nullif(trim(profile.display_name), ''), profile.full_name),
        'clocked_in_at', clocked.event_timestamp,
        'scheduled_end', null
      ) order by profile.full_name)
      from clocked
      join public.staff_profiles profile on profile.organisation_id = target_organisation_id and profile.id = clocked.staff_id
    ), '[]'::jsonb),
    'attendance_warnings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', issue.staff_id,
        'display_name', coalesce(nullif(trim(profile.display_name), ''), profile.full_name),
        'warning', replace(issue.exception_type::text, '_', ' '),
        'warning_date', issue.operational_date
      ) order by issue.operational_date desc, profile.full_name)
      from public.attendance_exceptions issue
      join public.staff_profiles profile on profile.organisation_id = issue.organisation_id and profile.id = issue.staff_id
      where issue.organisation_id = target_organisation_id and issue.site_id = target_site_id
        and issue.status::text in ('open', 'under_review') and issue.operational_date <= reference_date
    ), '[]'::jsonb),
    'upcoming_shifts', case when can_rota then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shift.id, 'shift_date', shift.shift_date,
        'display_name', coalesce(nullif(trim(profile.display_name), ''), profile.full_name),
        'start_time', shift.start_time, 'end_time', shift.end_time,
        'work_area', shift.work_area, 'room_or_area', shift.room_or_area,
        'role_on_shift', shift.role_on_shift, 'rota_status', rota.status
      ) order by shift.shift_date, shift.start_time, profile.full_name)
      from public.rota_shifts shift
      join public.rota_weeks rota on rota.id = shift.rota_week_id and rota.archived_at is null
      join eligible on eligible.staff_id = shift.staff_id
      join public.staff_profiles profile on profile.organisation_id = target_organisation_id and profile.id = shift.staff_id
      where shift.organisation_id = target_organisation_id and shift.site_id = target_site_id
        and shift.shift_date between reference_date and reference_date + 6
        and shift.status::text = 'scheduled' and shift.archived_at is null
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result_value
  from issues cross join authority;

  return result_value;
end
$$;

revoke all on function public.get_commercial_attendance_dashboard(uuid, uuid, date) from public;
revoke all on function public.get_commercial_attendance_dashboard(uuid, uuid, date) from anon;
grant execute on function public.get_commercial_attendance_dashboard(uuid, uuid, date) to authenticated;
grant execute on function public.get_commercial_attendance_dashboard(uuid, uuid, date) to service_role;
