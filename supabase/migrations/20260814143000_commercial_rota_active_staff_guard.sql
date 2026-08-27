-- Workstream 8A follow-up: commercial scheduling must fail closed for inactive staff.
-- The explicit Jan compatibility path and existing historic shifts are unchanged.

create or replace function private.validate_commercial_rota_shift(
  target_organisation_id uuid,
  target_site_id uuid,
  target_staff_id text,
  target_shift_date date,
  target_start_time time,
  target_end_time time,
  target_work_area_id uuid default null,
  excluded_shift_id uuid default null,
  excluded_week_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare conflict_site uuid;
begin
  if target_end_time <= target_start_time then
    return jsonb_build_object('ok',false,'code','invalid_time');
  end if;
  if not exists (
    select 1 from public.staff_profiles staff where staff.organisation_id=target_organisation_id
      and staff.id=target_staff_id and staff.active
  ) then return jsonb_build_object('ok',false,'code','staff_inactive'); end if;
  if not exists (
    select 1 from public.staff_site_assignments assignment
    where assignment.organisation_id=target_organisation_id and assignment.site_id=target_site_id
      and assignment.staff_id=target_staff_id and assignment.effective_from<=target_shift_date
      and (assignment.effective_to is null or assignment.effective_to>=target_shift_date)
  ) then return jsonb_build_object('ok',false,'code','assignment_required'); end if;
  if target_work_area_id is not null and not exists (
    select 1 from public.work_areas area where area.organisation_id=target_organisation_id
      and area.site_id=target_site_id and area.id=target_work_area_id and area.active and area.archived_at is null
  ) then return jsonb_build_object('ok',false,'code','work_area_unavailable'); end if;
  if exists (
    select 1 from public.site_closures closure where closure.organisation_id=target_organisation_id
      and closure.site_id=target_site_id and closure.archived_at is null
      and target_shift_date between closure.starts_on and closure.ends_on
  ) then return jsonb_build_object('ok',false,'code','site_closed'); end if;
  select shift.site_id into conflict_site from public.rota_shifts shift
    where shift.organisation_id=target_organisation_id and shift.staff_id=target_staff_id
      and shift.shift_date=target_shift_date and shift.archived_at is null and shift.status<>'cancelled'
      and shift.id is distinct from excluded_shift_id
      and (excluded_week_id is null or shift.rota_week_id<>excluded_week_id)
      and target_start_time<shift.end_time and target_end_time>shift.start_time
    order by shift.start_time limit 1;
  if found then return jsonb_build_object('ok',false,'code',case when conflict_site=target_site_id then 'shift_overlap' else 'cross_site_overlap' end,'conflictSiteId',conflict_site); end if;
  if exists (
    select 1 from public.leave_requests request where request.organisation_id=target_organisation_id
      and request.staff_id=target_staff_id and request.status='approved'
      and target_shift_date between request.start_date and request.end_date
      and (request.day_part='full_day' or (request.start_date=target_shift_date and target_start_time<request.end_time and target_end_time>request.start_time))
  ) then return jsonb_build_object('ok',false,'code','approved_leave_conflict'); end if;
  return jsonb_build_object('ok',true,'code','ok');
end
$$;

revoke all on function private.validate_commercial_rota_shift(uuid,uuid,text,date,time,time,uuid,uuid,uuid)
from public, anon, authenticated;
