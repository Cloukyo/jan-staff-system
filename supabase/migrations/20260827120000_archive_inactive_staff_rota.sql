-- Preserve historic rota evidence while removing inactive staff from live rota work.
-- Commercial administration remains the authoritative tenant-aware lifecycle path;
-- the legacy RPC remains available only for wholly unowned Jan-compatible rows.

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_fragment constant text := $old$        elsif command_name='deactivate_staff' then update public.staff_profiles set active=false,admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=profile.id;update public.staff_kiosk_settings set kiosk_enabled=false,onboarding_attendance_eligible=false,pin_reset_required=true,updated_at=clock_timestamp() where staff_id=profile.id;success:=true;$old$;
  new_fragment constant text := $new$        elsif command_name='deactivate_staff' then
          if actor.staff_id=profile.id then result:=jsonb_build_object('outcome','permission_denied','code','self_deactivation');
          elsif not private.has_permission(org.id,permission_name) then result:=jsonb_build_object('outcome','permission_denied','code','organisation_scope_required');
          else
            update public.rota_shifts set archived_at=clock_timestamp(),archived_by_membership_id=actor.id,updated_by_membership_id=actor.id,revision=revision+1,updated_at=clock_timestamp()
              where organisation_id=org.id and staff_id=profile.id and shift_date>=(clock_timestamp() at time zone org.timezone)::date and archived_at is null;
            update public.rota_template_shifts set archived_at=clock_timestamp(),archived_by_membership_id=actor.id,updated_by_membership_id=actor.id,revision=revision+1,updated_at=clock_timestamp()
              where organisation_id=org.id and staff_id=profile.id and archived_at is null;
            update public.organisation_memberships set status='suspended',suspended_at=clock_timestamp(),authorisation_revision=authorisation_revision+1,updated_at=clock_timestamp()
              where organisation_id=org.id and staff_id=profile.id and status='active';
            update public.staff_profiles set active=false,admin_revision=admin_revision+1,updated_at=clock_timestamp() where organisation_id=org.id and id=profile.id;
            update public.staff_kiosk_settings set kiosk_enabled=false,onboarding_attendance_eligible=false,pin_reset_required=true,updated_at=clock_timestamp() where staff_id=profile.id;
            success:=true;
          end if;$new$;
begin
  if to_regprocedure('commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)') is null then
    raise exception 'authoritative commercial administration command is missing';
  end if;
  function_definition:=pg_get_functiondef('commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  patched_definition:=replace(function_definition,old_fragment,new_fragment);
  if patched_definition=function_definition then
    raise exception 'commercial staff deactivation implementation did not match its verified predecessor';
  end if;
  execute patched_definition;
end
$migration$;

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_validation constant text := $old$      for shift in select * from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=source_week.id and s.archived_at is null and s.status<>'cancelled' loop$old$;
  new_validation constant text := $new$      for shift in select s.* from public.rota_shifts s join public.staff_profiles copied_profile on copied_profile.organisation_id=s.organisation_id and copied_profile.id=s.staff_id and copied_profile.active where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=source_week.id and s.archived_at is null and s.status<>'cancelled' loop$new$;
  old_insert constant text := $old$          from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=source_week.id and s.archived_at is null and s.status<>'cancelled'$old$;
  new_insert constant text := $new$          from public.rota_shifts s join public.staff_profiles copied_profile on copied_profile.organisation_id=s.organisation_id and copied_profile.id=s.staff_id and copied_profile.active where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=source_week.id and s.archived_at is null and s.status<>'cancelled'$new$;
begin
  if to_regprocedure('public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint)') is null then
    raise exception 'commercial rota command is missing';
  end if;
  function_definition:=pg_get_functiondef('public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint)'::regprocedure);
  patched_definition:=replace(function_definition,old_validation,new_validation);
  if patched_definition=function_definition then
    raise exception 'commercial previous-week validation implementation did not match its verified predecessor';
  end if;
  function_definition:=patched_definition;
  patched_definition:=replace(function_definition,old_insert,new_insert);
  if patched_definition=function_definition then
    raise exception 'commercial previous-week insert implementation did not match its verified predecessor';
  end if;
  execute patched_definition;
end
$migration$;

create or replace function public.set_staff_profile_active(p_staff_id text,p_active boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare manager_account public.staff_accounts;target_profile public.staff_profiles;target_account public.staff_accounts;
begin
  manager_account:=public.current_staff_account();
  if manager_account.id is null or manager_account.role<>'manager' then raise exception 'Manager access required';end if;
  select * into target_profile from public.staff_profiles where id=p_staff_id and organisation_id is null for update;
  if not found then raise exception 'Staff profile not found';end if;
  if not p_active and manager_account.staff_id=p_staff_id then raise exception 'You cannot deactivate the account currently in use';end if;
  if not p_active then
    update public.rota_shifts set archived_at=now(),archived_by=manager_account.id,updated_by=manager_account.id,revision=revision+1,updated_at=now()
      where organisation_id is null and site_id is null and staff_id=p_staff_id and shift_date>=(now() at time zone 'Europe/London')::date and archived_at is null;
    update public.rota_template_shifts set archived_at=now(),archived_by=manager_account.id,updated_by=manager_account.id,revision=revision+1,updated_at=now()
      where organisation_id is null and site_id is null and staff_id=p_staff_id and archived_at is null;
  end if;
  update public.staff_profiles set active=p_active,updated_at=now() where id=p_staff_id and organisation_id is null;
  if not p_active then
    select * into target_account from public.staff_accounts where staff_id=p_staff_id for update;
    if target_account.id is not null and target_account.active then
      update public.staff_accounts set active=false,disabled_by=manager_account.id,disabled_at=now() where id=target_account.id;
      insert into public.staff_account_access_audit(staff_account_id,staff_id,action,previous_role,new_role,performed_by)
      values(target_account.id,p_staff_id,'disabled',target_account.role,target_account.role,manager_account.id);
    end if;
    update public.staff_kiosk_settings set kiosk_enabled=false,pin_reset_required=true,updated_at=now() where staff_id=p_staff_id;
  end if;
end$$;

revoke all on function public.set_staff_profile_active(text,boolean) from public,anon,authenticated;
grant execute on function public.set_staff_profile_active(text,boolean) to authenticated;

create or replace function public.copy_previous_rota_week(target_week_start date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare manager_account public.staff_accounts;source_week public.rota_weeks;target_week public.rota_weeks;copied_count integer;
begin
  manager_account:=public.current_staff_account();
  if manager_account.id is null or manager_account.role<>'manager' then raise exception 'Manager access required';end if;
  if extract(isodow from target_week_start)<>1 then raise exception 'Week must start on Monday';end if;
  select * into source_week from public.rota_weeks where organisation_id is null and site_id is null and week_start_date=target_week_start-7 and status<>'archived';
  if not found then raise exception 'Previous rota week does not exist';end if;
  select * into target_week from public.rota_weeks where organisation_id is null and site_id is null and week_start_date=target_week_start and status<>'archived';
  if found and target_week.status<>'draft' then raise exception 'Previous week can only be copied into a draft rota';end if;
  if not found then insert into public.rota_weeks(week_start_date,status,title,created_by,updated_by) values(target_week_start,'draft','Copied from previous week',manager_account.id,manager_account.id) returning * into target_week;end if;
  insert into public.rota_shifts(rota_week_id,staff_id,shift_date,start_time,end_time,break_minutes,room_or_area,role_on_shift,notes,status,created_by,updated_by)
  select target_week.id,shift.staff_id,shift.shift_date+7,shift.start_time,shift.end_time,shift.break_minutes,shift.room_or_area,shift.role_on_shift,shift.notes,'scheduled',manager_account.id,manager_account.id
  from public.rota_shifts shift join public.staff_profiles profile on profile.id=shift.staff_id and profile.organisation_id is null and profile.active
  where shift.organisation_id is null and shift.site_id is null and shift.rota_week_id=source_week.id and shift.archived_at is null and shift.status<>'cancelled'
    and not exists(select 1 from public.rota_shifts existing where existing.organisation_id is null and existing.site_id is null and existing.rota_week_id=target_week.id and existing.staff_id=shift.staff_id and existing.shift_date=shift.shift_date+7 and existing.start_time=shift.start_time and existing.end_time=shift.end_time and existing.archived_at is null and existing.status<>'cancelled');
  get diagnostics copied_count=row_count;
  return jsonb_build_object('week_id',target_week.id,'copied_shifts',copied_count);
end$$;

revoke all on function public.copy_previous_rota_week(date) from public,anon,authenticated;
grant execute on function public.copy_previous_rota_week(date) to authenticated;
revoke all on function commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) to authenticated;
revoke all on function public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint) to authenticated;
