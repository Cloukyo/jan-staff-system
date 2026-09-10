-- Expose only the date-specific operational eligibility needed by the rota UI.
-- The authoritative recruitment decision remains private.staff_may_begin_work.
create or replace function public.get_commercial_rota_snapshot(target_organisation_id uuid,target_site_id uuid,target_week_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.has_site_permission(target_organisation_id,target_site_id,'rota.read') then raise exception 'Rota access denied'; end if;
  select jsonb_build_object(
    'organisationId',target_organisation_id,'siteId',target_site_id,'weekStart',target_week_start,
    'site',(select jsonb_build_object('id',site.id,'name',site.name) from public.organisation_sites site where site.organisation_id=target_organisation_id and site.id=target_site_id),
    'week',(select to_jsonb(week)-'created_by'-'updated_by'-'published_by'-'archived_by' from public.rota_weeks week where week.organisation_id=target_organisation_id and week.site_id=target_site_id and week.week_start_date=target_week_start and week.status<>'archived'),
    'shifts',coalesce((select jsonb_agg(to_jsonb(shift)-'created_by'-'updated_by'-'archived_by' order by shift.shift_date,shift.start_time) from public.rota_shifts shift join public.rota_weeks week on week.id=shift.rota_week_id and week.organisation_id=shift.organisation_id and week.site_id=shift.site_id where week.organisation_id=target_organisation_id and week.site_id=target_site_id and week.week_start_date=target_week_start and week.status<>'archived' and shift.archived_at is null),'[]'::jsonb),
    'staff',coalesce((select jsonb_agg(jsonb_build_object(
      'id',profile.id,'full_name',profile.full_name,'display_name',profile.display_name,'employment_role',profile.employment_role,'active',profile.active,
      'operational_readiness',(select jsonb_object_agg(day.value::text,private.staff_may_begin_work(target_organisation_id,profile.id,day.value) order by day.value)
        from generate_series(target_week_start,target_week_start+6,interval '1 day') generated(value)
        cross join lateral (select generated.value::date value) day)
    ) order by profile.full_name) from public.staff_profiles profile where profile.organisation_id=target_organisation_id and profile.active and exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id and assignment.site_id=target_site_id and assignment.staff_id=profile.id and assignment.effective_from<=target_week_start+6 and (assignment.effective_to is null or assignment.effective_to>=target_week_start))),'[]'::jsonb),
    'leave',coalesce((select jsonb_agg(jsonb_build_object('id',request.id,'staff_id',request.staff_id,'start_date',request.start_date,'end_date',request.end_date,'day_part',request.day_part,'start_time',request.start_time,'end_time',request.end_time,'status',request.status))
      from public.leave_requests request where request.organisation_id=target_organisation_id and request.status in ('pending','approved')
        and request.start_date<=target_week_start+6 and request.end_date>=target_week_start
        and exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id
          and assignment.site_id=target_site_id and assignment.staff_id=request.staff_id and assignment.effective_from<=least(request.end_date,target_week_start+6)
          and (assignment.effective_to is null or assignment.effective_to>=greatest(request.start_date,target_week_start)))),'[]'::jsonb),
    'workAreas',coalesce((select jsonb_agg(jsonb_build_object('id',area.id,'name',area.name,'code',area.code) order by area.name) from public.work_areas area where area.organisation_id=target_organisation_id and area.site_id=target_site_id and area.active and area.archived_at is null),'[]'::jsonb),
    'closures',coalesce((select jsonb_agg(jsonb_build_object('id',closure.id,'startsOn',closure.starts_on,'endsOn',closure.ends_on,'label',closure.label)) from public.site_closures closure where closure.organisation_id=target_organisation_id and closure.site_id=target_site_id and closure.archived_at is null and closure.starts_on<=target_week_start+6 and closure.ends_on>=target_week_start),'[]'::jsonb),
    'templates',coalesce((select jsonb_agg(
      (to_jsonb(template)-'created_by'-'updated_by'-'archived_by') || jsonb_build_object('shifts',coalesce((
        select jsonb_agg(to_jsonb(template_shift)-'created_by'-'updated_by'-'archived_by' order by template_shift.day_of_week,template_shift.sort_order,template_shift.start_time)
        from public.rota_template_shifts template_shift where template_shift.organisation_id=target_organisation_id
          and template_shift.site_id=target_site_id and template_shift.template_id=template.id and template_shift.archived_at is null
      ),'[]'::jsonb)) order by template.name)
      from public.rota_templates template where template.organisation_id=target_organisation_id and template.site_id=target_site_id and template.status='active'),'[]'::jsonb)
  ) into result;
  return result;
end
$$;
