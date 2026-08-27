-- Keep the bootstrap snapshot contract valid before an organisation or kiosk exists.
create or replace function private.commercial_kiosk_snapshot(target_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.onboarding_sessions%rowtype;r public.commercial_kiosk_registrations%rowtype;d public.kiosk_devices%rowtype;staff_rows jsonb;eligible_count integer:=0;pin_count integer:=0;offline_count integer:=0;recent boolean:=false;roster_ok boolean:=false;
begin
  select * into s from public.onboarding_sessions where id=target_session_id;
  select * into r from public.commercial_kiosk_registrations where organisation_id=s.organisation_id order by created_at desc limit 1;
  if r.claimed_device_id is not null then select * into d from public.kiosk_devices where id=r.claimed_device_id;end if;
  select coalesce(jsonb_agg(jsonb_build_object('staffId',p.id,'displayName',p.display_name,'siteAssigned',true,'attendanceEligible',true,'pinRequired',true,
    'pinReady',coalesce(k.kiosk_enabled and k.pin_hash is not null and not k.pin_reset_required,false),
    'visibleOnKiosk',coalesce(k.kiosk_enabled and k.pin_hash is not null and not k.pin_reset_required,false)) order by p.display_name,p.id),'[]'::jsonb),
    count(*)::int,count(*) filter(where k.kiosk_enabled and k.pin_hash is not null and not k.pin_reset_required)::int
    into staff_rows,eligible_count,pin_count
    from public.staff_profiles p join public.staff_site_assignments a on a.organisation_id=p.organisation_id and a.staff_id=p.id
    join public.staff_kiosk_settings k on k.staff_id=p.id
    where p.organisation_id=s.organisation_id and p.active and k.onboarding_attendance_eligible
      and a.site_id=coalesce(r.site_id,(select id from public.organisation_sites where organisation_id=s.organisation_id and active and archived_at is null order by created_at limit 1))
      and a.effective_from<=current_date and(a.effective_to is null or a.effective_to>=current_date);
  recent:=d.id is not null and d.active and d.last_heartbeat_at>=now()-interval '5 minutes';
  roster_ok:=d.id is not null and d.roster_verified_at is not null and d.roster_verified_at>=coalesce(d.last_heartbeat_at,d.roster_verified_at)-interval '5 minutes';
  if d.id is not null then
    select count(*)::int into offline_count from public.kiosk_offline_authorisations
    where kiosk_device_id=d.id and revoked_at is null and expires_at>now();
  end if;
  return jsonb_build_object(
    'availableSites',coalesce((select jsonb_agg(jsonb_build_object('siteId',site.id,'displayName',site.name) order by site.name) from public.organisation_sites site where site.organisation_id=s.organisation_id and site.active and site.archived_at is null),'[]'::jsonb),
    'registration',case when r.id is null then null else jsonb_build_object('registrationId',r.id,'siteId',r.site_id,'deviceName',r.intended_device_name,'status',case when r.status='pending' and r.expires_at<=now() then 'expired' else r.status end,'expiresAt',r.expires_at,'claimedDeviceId',r.claimed_device_id,'revision',r.revision::text) end,
    'device',case when d.id is null then null else jsonb_build_object('deviceId',d.id,'siteId',d.site_id,'deviceName',d.device_name,'active',d.active,'status',case when not d.active then 'revoked' when recent then 'connected' when d.last_heartbeat_at is null then 'waiting' else 'connection_problem' end,'lastSeenAt',d.last_heartbeat_at,'appVersion',d.app_version,'protocolVersion',d.protocol_version,'platformCategory',d.platform_category) end,
    'readiness',jsonb_build_object('complete',r.status='verified' and d.active and d.organisation_id=s.organisation_id and d.site_id=r.site_id and recent and roster_ok and eligible_count>0 and pin_count>0 and not d.offline_enabled and offline_count=0,
      'registrationReady',coalesce(r.status in('claimed','verified'),false),'deviceActive',coalesce(d.active,false),'bindingValid',d.id is not null and d.organisation_id=s.organisation_id and d.site_id=r.site_id,
      'heartbeatRecent',recent,'rosterVerified',roster_ok,'eligibleStaffCount',eligible_count,'pinReadyStaffCount',pin_count,'offlineDisabled',coalesce(not d.offline_enabled,true),'offlineAuthorisationCount',offline_count),
    'staff',staff_rows);
end$$;

revoke all on function private.commercial_kiosk_snapshot(uuid) from public,anon,authenticated,service_role;
