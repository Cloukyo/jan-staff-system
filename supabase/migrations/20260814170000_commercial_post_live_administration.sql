alter table public.organisations add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);
alter table public.organisation_sites add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);
alter table public.staff_profiles add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);
alter table public.staff_site_assignments add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);
alter table public.work_areas add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);
alter table public.site_closures add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);
alter table public.organisation_settings add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);
alter table public.site_settings add column if not exists admin_revision bigint not null default 1 check(admin_revision>0);

create table public.commercial_admin_events(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  site_id uuid,
  actor_membership_id uuid not null,
  event_type text not null check(event_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  resource_type text not null check(resource_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  resource_id text,
  organisation_revision bigint not null check(organisation_revision>0),
  safe_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(safe_metadata)='object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(organisation_id,site_id) references public.organisation_sites(organisation_id,id) on delete restrict,
  foreign key(organisation_id,actor_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict
);
create index commercial_admin_events_org_created_idx on public.commercial_admin_events(organisation_id,created_at desc);

create table public.commercial_admin_command_receipts(
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  idempotency_key uuid not null,
  command_name text not null,
  request_hash bytea not null check(octet_length(request_hash)=32),
  actor_membership_id uuid not null,
  status text not null default 'processing' check(status in('processing','succeeded','failed_final')),
  result_json jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key(organisation_id,idempotency_key),
  foreign key(organisation_id,actor_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict
);

alter table public.commercial_admin_events enable row level security;
alter table public.commercial_admin_command_receipts enable row level security;
revoke all on public.commercial_admin_events,public.commercial_admin_command_receipts from public,anon,authenticated;
grant select on public.commercial_admin_events to authenticated;
create policy commercial_admin_events_read on public.commercial_admin_events for select to authenticated
  using(private.has_permission(organisation_id,'organisation.audit.read'));
create policy commercial_admin_receipts_no_client_access on public.commercial_admin_command_receipts
  for all to authenticated using(false) with check(false);

create or replace function private.protect_commercial_admin_event()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'commercial administration evidence is append-only';end;$$;
create trigger commercial_admin_events_append_only before update or delete on public.commercial_admin_events
for each row execute function private.protect_commercial_admin_event();

create or replace function private.protect_commercial_admin_ownership()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.organisation_id is distinct from old.organisation_id or new.site_id is distinct from old.site_id then
    raise exception 'commercial administration ownership is immutable';
  end if;
  return new;
end;$$;
create trigger commercial_admin_event_ownership before update on public.commercial_admin_events
for each row execute function private.protect_commercial_admin_ownership();

create or replace function private.commercial_admin_uuid(candidate text)
returns uuid language plpgsql immutable set search_path='' as $$begin return candidate::uuid;exception when others then return null;end;$$;
create or replace function private.commercial_admin_date(candidate text)
returns date language plpgsql stable set search_path='' as $$declare parsed date;begin if candidate is null or candidate!~'^\d{4}-\d{2}-\d{2}$' then return null;end if;parsed:=candidate::date;if to_char(parsed,'YYYY-MM-DD')<>candidate then return null;end if;return parsed;exception when others then return null;end;$$;
create or replace function private.commercial_admin_time(candidate text)
returns time language plpgsql stable set search_path='' as $$declare parsed time;begin if candidate is null or candidate!~'^([01]\d|2[0-3]):[0-5]\d$' then return null;end if;parsed:=candidate::time;return parsed;exception when others then return null;end;$$;

create or replace function private.commercial_admin_snapshot(target_organisation_id uuid,target_site_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member public.organisation_memberships%rowtype;org public.organisations%rowtype;permissions jsonb;result jsonb;
begin
  select * into member from public.organisation_memberships m where m.id=private.current_membership_id(target_organisation_id) and m.status='active';
  if not found then raise exception 'commercial administration access denied';end if;
  select * into org from public.organisations o where o.id=target_organisation_id and o.archived_at is null;
  if not found then raise exception 'commercial administration access denied';end if;
  if target_site_id is not null and not exists(select 1 from public.organisation_sites s where s.organisation_id=org.id and s.id=target_site_id and s.archived_at is null) then raise exception 'commercial site access denied';end if;
  if target_site_id is not null and not(private.has_site_permission(org.id,target_site_id,'site.read') or private.has_permission(org.id,'organisation.manage')) then raise exception 'commercial site access denied';end if;
  select coalesce(jsonb_agg(distinct rp.permission order by rp.permission),'[]'::jsonb) into permissions
    from public.membership_role_assignments assignment join private.role_permissions rp on rp.role=assignment.role
    where assignment.organisation_id=org.id and assignment.membership_id=member.id and assignment.revoked_at is null
      and (assignment.scope_type='organisation' or (assignment.site_id is not null and exists(select 1 from public.membership_site_access access where access.organisation_id=org.id and access.membership_id=member.id and access.site_id=assignment.site_id and access.revoked_at is null)));
  select jsonb_build_object(
    'organisation',jsonb_build_object('id',org.id,'displayName',org.display_name,'legalName',org.legal_name,'contactEmail',org.contact_email,'contactPhone',org.contact_phone,'countryCode',org.country_code,'timezone',org.timezone,'operationalState',org.operational_state,'addressLine1',org.address_line_1,'addressLine2',org.address_line_2,'locality',org.locality,'region',org.region,'postcode',org.postcode,'revision',org.admin_revision),
    'actor',jsonb_build_object('membershipId',member.id,'revision',member.authorisation_revision,'permissions',permissions),
    'selectedSiteId',target_site_id,
    'sites',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'active',s.active,'timezone',s.timezone,'addressLine1',s.address_line_1,'locality',s.locality,'postcode',s.postcode,'phone',s.phone,'email',s.email,'archivedAt',s.archived_at,'revision',s.admin_revision) order by s.active desc,s.name) from public.organisation_sites s where s.organisation_id=org.id and (private.has_site_permission(org.id,s.id,'site.read') or private.has_permission(org.id,'organisation.manage'))),'[]'::jsonb),
    'staff',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'fullName',p.full_name,'displayName',p.display_name,'employmentRole',p.employment_role,'email',p.email,'active',p.active,'appointmentDate',p.appointment_date,'revision',p.admin_revision,'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'siteId',a.site_id,'siteName',s.name,'effectiveFrom',a.effective_from,'effectiveTo',a.effective_to,'primary',a.is_primary,'revision',a.admin_revision) order by a.effective_from desc) from public.staff_site_assignments a join public.organisation_sites s on s.organisation_id=a.organisation_id and s.id=a.site_id where a.organisation_id=org.id and a.staff_id=p.id),'[]'::jsonb),'kiosk',jsonb_build_object('enabled',coalesce(k.kiosk_enabled,false),'pinReady',k.pin_hash is not null and not k.pin_reset_required)) order by p.active desc,p.full_name) from public.staff_profiles p left join public.staff_kiosk_settings k on k.staff_id=p.id where p.organisation_id=org.id and private.can_access_staff(org.id,p.id,'staff.read')),'[]'::jsonb),
    'memberships',case when private.has_permission(org.id,'membership.read') then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'email',(select u.email from auth.users u where u.id=m.auth_user_id),'status',m.status,'staffId',m.staff_id,'revision',m.authorisation_revision,'roles',coalesce((select jsonb_agg(jsonb_build_object('role',r.role,'scopeType',r.scope_type,'siteId',r.site_id)) from public.membership_role_assignments r where r.organisation_id=org.id and r.membership_id=m.id and r.revoked_at is null),'[]'::jsonb),'siteIds',coalesce((select jsonb_agg(a.site_id) from public.membership_site_access a where a.organisation_id=org.id and a.membership_id=m.id and a.revoked_at is null),'[]'::jsonb)) order by m.created_at) from public.organisation_memberships m where m.organisation_id=org.id),'[]'::jsonb) else '[]'::jsonb end,
    'invitations',case when private.has_permission(org.id,'membership.read') then coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.invited_email,'kind',i.invitation_kind,'status',i.status,'expiresAt',i.expires_at,'staffId',i.staff_id) order by i.created_at desc) from public.organisation_invitations i where i.organisation_id=org.id and i.status in('pending','accepted')),'[]'::jsonb) else '[]'::jsonb end,
    'workAreas',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'siteId',w.site_id,'name',w.name,'code',w.code,'active',w.active,'revision',w.admin_revision) order by w.site_id,w.name) from public.work_areas w where w.organisation_id=org.id and w.archived_at is null and private.has_site_permission(org.id,w.site_id,'site.read')),'[]'::jsonb),
    'closures',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'siteId',c.site_id,'label',c.label,'startsOn',c.starts_on,'endsOn',c.ends_on,'revision',c.admin_revision) order by c.starts_on desc) from public.site_closures c where c.organisation_id=org.id and c.archived_at is null and private.has_site_permission(org.id,c.site_id,'site.read')),'[]'::jsonb),
    'devices',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'siteId',d.site_id,'deviceName',d.device_name,'active',d.active,'lastSeenAt',d.last_heartbeat_at,'appVersion',d.app_version,'protocolVersion',d.protocol_version,'reprovisionRequired',d.reprovision_required,'offlineEnabled',false) order by d.active desc,d.device_name) from public.kiosk_devices d where d.organisation_id=org.id and d.site_id is not null and private.has_site_permission(org.id,d.site_id,'kiosk.read')),'[]'::jsonb),
    'settings',jsonb_build_object('organisation',(select jsonb_build_object('workWeekStarts',s.work_week_starts,'defaultTimezone',s.default_timezone,'operatingDefaults',s.operating_defaults,'staffingDefaults',s.staffing_defaults,'branding',s.branding,'revision',s.admin_revision) from public.organisation_settings s where s.organisation_id=org.id),'sites',coalesce((select jsonb_agg(jsonb_build_object('siteId',s.site_id,'openingTime',s.opening_time,'closingTime',s.closing_time,'timezoneOverride',s.timezone_override,'workWeekStartsOverride',s.work_week_starts_override,'operatingOverrides',s.operating_overrides,'staffingOverrides',s.staffing_overrides,'revision',s.admin_revision)) from public.site_settings s where s.organisation_id=org.id and private.has_site_permission(org.id,s.site_id,'site.read')),'[]'::jsonb))
  ) into result;
  return result;
end;$$;

create or replace function public.get_commercial_admin_snapshot(target_organisation_id uuid,target_site_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$select private.commercial_admin_snapshot(target_organisation_id,target_site_id)$$;

create or replace function public.execute_commercial_admin_command(
  target_organisation_id uuid,command_name text,payload jsonb,idempotency_key uuid,expected_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.organisation_memberships%rowtype;org public.organisations%rowtype;existing public.commercial_admin_command_receipts%rowtype;
  request_hash bytea;result jsonb;success boolean:=false;permission_name text;resource_type text:='organisation';resource_id text;event_name text;
  site public.organisation_sites%rowtype;profile public.staff_profiles%rowtype;assignment public.staff_site_assignments%rowtype;
  member public.organisation_memberships%rowtype;area public.work_areas%rowtype;closure public.site_closures%rowtype;device public.kiosk_devices%rowtype;
  invitation public.organisation_invitations%rowtype;replacement_invitation public.organisation_invitations%rowtype;
  target_site_uuid uuid;staff_value text;resource_uuid uuid;key_value uuid:=idempotency_key;from_date date;to_date date;decision jsonb;new_revision bigint;raw_status text;role_value public.organisation_role;scope_value public.membership_scope_type;
begin
  if auth.uid() is null then return jsonb_build_object('outcome','permission_denied');end if;
  select * into actor from public.organisation_memberships m where m.id=private.current_membership_id(target_organisation_id) and m.status='active';
  if not found then return jsonb_build_object('outcome','permission_denied');end if;
  select * into org from public.organisations o where o.id=target_organisation_id and o.archived_at is null for update;
  if not found then return jsonb_build_object('outcome','not_found');end if;
  if org.operational_state<>'live' then return jsonb_build_object('outcome','not_live');end if;
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then return jsonb_build_object('outcome','mfa_required');end if;
  if payload is null or jsonb_typeof(payload)<>'object' or idempotency_key is null then return jsonb_build_object('outcome','invalid_request');end if;
  request_hash:=sha256(convert_to(command_name||':'||payload::text,'UTF8'));
  select * into existing from public.commercial_admin_command_receipts r where r.organisation_id=org.id and r.idempotency_key=key_value for update;
  if found then
    if existing.command_name<>command_name or existing.request_hash<>request_hash then return jsonb_build_object('outcome','idempotency_conflict');end if;
    if existing.status in('succeeded','failed_final') then return existing.result_json;end if;
    return jsonb_build_object('outcome','indeterminate','code','command_in_progress');
  end if;
  insert into public.commercial_admin_command_receipts(organisation_id,idempotency_key,command_name,request_hash,actor_membership_id)
  values(org.id,key_value,command_name,request_hash,actor.id);
  if expected_revision is null or expected_revision<>org.admin_revision then
    result:=jsonb_build_object('outcome','workflow_changed','revision',org.admin_revision);
  else
    begin
      if command_name='update_organisation' then
        permission_name:='organisation.manage';resource_type:='organisation';resource_id:=org.id::text;event_name:='organisation_updated';
        if not private.has_permission(org.id,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif length(btrim(payload->>'displayName')) not between 2 and 160 or length(btrim(payload->>'legalName')) not between 2 and 200 or coalesce(payload->>'contactEmail','')!~*'^[^@\s]+@[^@\s]+\.[^@\s]+$' then result:=jsonb_build_object('outcome','invalid_request');
        else update public.organisations set display_name=btrim(payload->>'displayName'),legal_name=btrim(payload->>'legalName'),contact_email=lower(btrim(payload->>'contactEmail')),contact_phone=nullif(btrim(payload->>'contactPhone'),''),address_line_1=nullif(btrim(payload->>'addressLine1'),''),address_line_2=nullif(btrim(payload->>'addressLine2'),''),locality=nullif(btrim(payload->>'locality'),''),region=nullif(btrim(payload->>'region'),''),postcode=nullif(btrim(payload->>'postcode'),''),updated_at=clock_timestamp() where id=org.id;success:=true;end if;
      elsif command_name='create_site' then
        permission_name:='site.manage';resource_type:='site';event_name:='site_created';
        decision:=private.commercial_capability_decision(org.id,'sites.active.limit',jsonb_build_object('requestedUnits',1));
        if not private.has_permission(org.id,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif not coalesce((decision->>'allowed')::boolean,false) then result:=jsonb_build_object('outcome','upgrade_required','capabilityKey','sites.active.limit','decisionCode',decision->>'decisionCode');
        elsif length(btrim(payload->>'name')) not between 2 and 160 or (nullif(payload->>'email','') is not null and payload->>'email'!~*'^[^@\s]+@[^@\s]+\.[^@\s]+$') then result:=jsonb_build_object('outcome','invalid_request');
        else
          insert into public.organisation_sites(organisation_id,name,slug,timezone,active,address_line_1,address_line_2,locality,region,postcode,phone,email,country_code)
          values(org.id,btrim(payload->>'name'),private.commercial_allocate_site_slug(org.id,payload->>'name'),coalesce(nullif(payload->>'timezone',''),'Europe/London'),true,nullif(btrim(payload->>'addressLine1'),''),nullif(btrim(payload->>'addressLine2'),''),nullif(btrim(payload->>'locality'),''),nullif(btrim(payload->>'region'),''),nullif(btrim(payload->>'postcode'),''),nullif(btrim(payload->>'phone'),''),nullif(lower(btrim(payload->>'email')),''),coalesce(nullif(payload->>'countryCode',''),'GB')) returning * into site;
          insert into public.site_settings(organisation_id,site_id) values(org.id,site.id);
          resource_id:=site.id::text;success:=true;
        end if;
      elsif command_name in('update_site','archive_site') then
        target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');select * into site from public.organisation_sites s where s.organisation_id=org.id and s.id=target_site_uuid for update;
        permission_name:='site.manage';resource_type:='site';resource_id:=target_site_uuid::text;event_name:=case when command_name='archive_site' then 'site_archived' else 'site_updated' end;
        if not found then result:=jsonb_build_object('outcome','not_found');
        elsif not private.has_site_permission(org.id,site.id,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif command_name='archive_site' and (exists(select 1 from public.kiosk_devices d where d.organisation_id=org.id and d.site_id=site.id and d.active) or exists(select 1 from public.staff_site_assignments a where a.organisation_id=org.id and a.site_id=site.id and (a.effective_to is null or a.effective_to>=(clock_timestamp() at time zone org.timezone)::date))) then result:=jsonb_build_object('outcome','conflict','code','site_in_use');
        elsif command_name='archive_site' then update public.organisation_sites set active=false,archived_at=clock_timestamp(),admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=site.id;success:=true;
        elsif length(btrim(payload->>'name')) not between 2 and 160 or (nullif(payload->>'email','') is not null and payload->>'email'!~*'^[^@\s]+@[^@\s]+\.[^@\s]+$') then result:=jsonb_build_object('outcome','invalid_request');
        else update public.organisation_sites set name=btrim(payload->>'name'),address_line_1=nullif(btrim(payload->>'addressLine1'),''),locality=nullif(btrim(payload->>'locality'),''),postcode=nullif(btrim(payload->>'postcode'),''),phone=nullif(btrim(payload->>'phone'),''),email=nullif(lower(btrim(payload->>'email')),''),admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=site.id;success:=true;end if;
      elsif command_name='create_staff' then
        target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');permission_name:='staff.manage';resource_type:='staff';event_name:='staff_created';
        decision:=private.commercial_capability_decision(org.id,'staff.active.limit',jsonb_build_object('requestedUnits',1));
        if not private.has_site_permission(org.id,target_site_uuid,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif not coalesce((decision->>'allowed')::boolean,false) then result:=jsonb_build_object('outcome','upgrade_required','capabilityKey','staff.active.limit','decisionCode',decision->>'decisionCode');
        elsif private.commercial_admin_date(payload->>'effectiveFrom') is null then result:=jsonb_build_object('outcome','invalid_request');
        else staff_value:=public.create_commercial_staff_profile(org.id,target_site_uuid,payload->>'fullName',coalesce(nullif(payload->>'displayName',''),split_part(payload->>'fullName',' ',1)),payload->>'employmentRole',private.commercial_admin_date(payload->>'effectiveFrom'),coalesce((payload->>'primary')::boolean,true));resource_id:=staff_value;success:=true;end if;
      elsif command_name in('update_staff','deactivate_staff','set_staff_attendance_eligibility') then
        staff_value:=payload->>'staffId';select * into profile from public.staff_profiles p where p.organisation_id=org.id and p.id=staff_value for update;
        permission_name:='staff.manage';resource_type:='staff';resource_id:=staff_value;event_name:=case when command_name='deactivate_staff' then 'staff_deactivated' when command_name='set_staff_attendance_eligibility' then 'staff_attendance_eligibility_changed' else 'staff_updated' end;
        if not found then result:=jsonb_build_object('outcome','not_found');
        elsif not private.can_access_staff(org.id,staff_value,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif command_name='deactivate_staff' then update public.staff_profiles set active=false,admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=profile.id;update public.staff_kiosk_settings set kiosk_enabled=false,onboarding_attendance_eligible=false,pin_reset_required=true,updated_at=clock_timestamp() where staff_id=profile.id;success:=true;
        elsif command_name='set_staff_attendance_eligibility' then update public.staff_kiosk_settings set kiosk_enabled=coalesce((payload->>'eligible')::boolean,false),onboarding_attendance_eligible=coalesce((payload->>'eligible')::boolean,false),pin_reset_required=case when coalesce((payload->>'eligible')::boolean,false) then pin_reset_required else true end,updated_at=clock_timestamp() where staff_id=profile.id;success:=found;
        elsif length(btrim(payload->>'fullName')) not between 2 and 200 or length(btrim(payload->>'employmentRole')) not between 2 and 120 then result:=jsonb_build_object('outcome','invalid_request');
        else update public.staff_profiles set full_name=btrim(payload->>'fullName'),display_name=coalesce(nullif(btrim(payload->>'displayName'),''),split_part(btrim(payload->>'fullName'),' ',1)),employment_role=btrim(payload->>'employmentRole'),email=nullif(lower(btrim(payload->>'email')),''),admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=profile.id;success:=true;end if;
      elsif command_name='upsert_assignment' then
        staff_value:=payload->>'staffId';target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');resource_uuid:=private.commercial_admin_uuid(payload->>'assignmentId');from_date:=private.commercial_admin_date(payload->>'effectiveFrom');to_date:=private.commercial_admin_date(payload->>'effectiveTo');
        permission_name:='staff.manage';resource_type:='staff_assignment';event_name:='staff_assignment_changed';
        if not private.has_site_permission(org.id,target_site_uuid,permission_name) or not exists(select 1 from public.staff_profiles p where p.organisation_id=org.id and p.id=staff_value) or not exists(select 1 from public.organisation_sites s where s.organisation_id=org.id and s.id=target_site_uuid and s.active) then result:=jsonb_build_object('outcome','permission_denied');
        elsif from_date is null or (payload?'effectiveTo' and nullif(payload->>'effectiveTo','') is not null and to_date is null) or (to_date is not null and to_date<from_date) then result:=jsonb_build_object('outcome','invalid_request');
        else
          if coalesce((payload->>'primary')::boolean,false) then update public.staff_site_assignments a set is_primary=false,admin_revision=a.admin_revision+1,updated_at=clock_timestamp() where a.organisation_id=org.id and a.staff_id=staff_value and a.is_primary and a.effective_from<=coalesce(to_date,'infinity'::date) and (a.effective_to is null or a.effective_to>=from_date) and a.id is distinct from resource_uuid;end if;
          if resource_uuid is null then insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,effective_to,is_primary,employment_role,created_by_membership_id) values(org.id,staff_value,target_site_uuid,from_date,to_date,coalesce((payload->>'primary')::boolean,false),nullif(payload->>'employmentRole',''),actor.id) returning * into assignment;
          else update public.staff_site_assignments set effective_from=from_date,effective_to=to_date,is_primary=coalesce((payload->>'primary')::boolean,false),employment_role=nullif(payload->>'employmentRole',''),admin_revision=admin_revision+1,updated_at=clock_timestamp() where organisation_id=org.id and id=resource_uuid returning * into assignment;end if;
          if assignment.id is null then result:=jsonb_build_object('outcome','not_found');else resource_id:=assignment.id::text;success:=true;end if;
        end if;
      elsif command_name='update_membership_access' then
        resource_uuid:=private.commercial_admin_uuid(payload->>'membershipId');select * into member from public.organisation_memberships m where m.organisation_id=org.id and m.id=resource_uuid for update;
        permission_name:='membership.manage';resource_type:='membership';resource_id:=resource_uuid::text;event_name:='membership_access_changed';raw_status:=payload->>'role';
        if not private.has_permission(org.id,permission_name) or not found then result:=jsonb_build_object('outcome','permission_denied');
        elsif member.id=actor.id then result:=jsonb_build_object('outcome','permission_denied','code','self_escalation');
        elsif member.authorisation_revision<>coalesce((payload->>'membershipRevision')::bigint,-1) then result:=jsonb_build_object('outcome','workflow_changed','revision',member.authorisation_revision);
        elsif not private.can_grant_manager_role(org.id,actor.id,raw_status) then result:=jsonb_build_object('outcome','permission_denied','code','ungrantable_role');
        else
          role_value:=raw_status::public.organisation_role;scope_value:=coalesce(nullif(payload->>'scopeType',''),'organisation')::public.membership_scope_type;target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');
          if scope_value='site' and (target_site_uuid is null or not exists(select 1 from public.organisation_sites s where s.organisation_id=org.id and s.id=target_site_uuid and s.active)) then result:=jsonb_build_object('outcome','invalid_request','code','site_required');
           else update public.membership_role_assignments set revoked_at=clock_timestamp() where organisation_id=org.id and membership_id=member.id and revoked_at is null;update public.membership_site_access set revoked_at=clock_timestamp() where organisation_id=org.id and membership_id=member.id and revoked_at is null;insert into public.membership_role_assignments(organisation_id,membership_id,role,scope_type,site_id,granted_by_membership_id) values(org.id,member.id,role_value,scope_value,case when scope_value='site' then target_site_uuid end,actor.id);if scope_value='site' then insert into public.membership_site_access(organisation_id,membership_id,site_id,granted_by_membership_id) values(org.id,member.id,target_site_uuid,actor.id);end if;update public.organisation_memberships set authorisation_revision=authorisation_revision+1,updated_at=clock_timestamp() where id=member.id;success:=true;end if;
        end if;
      elsif command_name in('suspend_membership','revoke_membership') then
        resource_uuid:=private.commercial_admin_uuid(payload->>'membershipId');select * into member from public.organisation_memberships m where m.organisation_id=org.id and m.id=resource_uuid for update;
        permission_name:='membership.manage';resource_type:='membership';resource_id:=resource_uuid::text;event_name:=case when command_name='suspend_membership' then 'membership_suspended' else 'membership_revoked' end;
        if not private.has_permission(org.id,permission_name) or not found or member.id=actor.id then result:=jsonb_build_object('outcome','permission_denied');
        elsif member.authorisation_revision<>coalesce((payload->>'membershipRevision')::bigint,-1) then result:=jsonb_build_object('outcome','workflow_changed','revision',member.authorisation_revision);
        else raw_status:=case when command_name='suspend_membership' then 'suspended' else 'revoked' end;update public.organisation_memberships set status=raw_status::public.organisation_membership_status,suspended_at=case when raw_status='suspended' then clock_timestamp() else suspended_at end,revoked_at=case when raw_status='revoked' then clock_timestamp() else revoked_at end,authorisation_revision=authorisation_revision+1,updated_at=clock_timestamp() where id=member.id;success:=true;end if;
      elsif command_name in('create_work_area','update_work_area','archive_work_area') then
        target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');resource_uuid:=private.commercial_admin_uuid(payload->>'workAreaId');permission_name:='settings.manage';resource_type:='work_area';event_name:=case command_name when 'create_work_area' then 'work_area_created' when 'archive_work_area' then 'work_area_archived' else 'work_area_updated' end;
        if not private.has_site_permission(org.id,target_site_uuid,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif command_name='create_work_area' and length(btrim(payload->>'name')) between 2 and 120 then insert into public.work_areas(organisation_id,site_id,name,code) values(org.id,target_site_uuid,btrim(payload->>'name'),private.commercial_site_slug_base(payload->>'name')) returning * into area;resource_id:=area.id::text;success:=true;
        else select * into area from public.work_areas w where w.organisation_id=org.id and w.site_id=target_site_uuid and w.id=resource_uuid for update;if not found then result:=jsonb_build_object('outcome','not_found');elsif command_name='archive_work_area' then update public.work_areas set active=false,archived_at=clock_timestamp(),admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=area.id;resource_id:=area.id::text;success:=true;elsif length(btrim(payload->>'name')) between 2 and 120 then update public.work_areas set name=btrim(payload->>'name'),admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=area.id;resource_id:=area.id::text;success:=true;else result:=jsonb_build_object('outcome','invalid_request');end if;end if;
      elsif command_name in('create_site_closure','archive_site_closure') then
        target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');resource_uuid:=private.commercial_admin_uuid(payload->>'closureId');permission_name:='settings.manage';resource_type:='site_closure';event_name:=case when command_name='create_site_closure' then 'site_closure_created' else 'site_closure_archived' end;
        if not private.has_site_permission(org.id,target_site_uuid,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif command_name='create_site_closure' then from_date:=private.commercial_admin_date(payload->>'startsOn');to_date:=private.commercial_admin_date(payload->>'endsOn');if from_date is null or to_date is null or to_date<from_date or length(btrim(payload->>'label')) not between 2 and 160 then result:=jsonb_build_object('outcome','invalid_request');else insert into public.site_closures(organisation_id,site_id,starts_on,ends_on,label,notes,created_by_membership_id) values(org.id,target_site_uuid,from_date,to_date,btrim(payload->>'label'),nullif(btrim(payload->>'notes'),''),actor.id) returning * into closure;resource_id:=closure.id::text;success:=true;end if;
        else update public.site_closures c set archived_at=clock_timestamp(),admin_revision=c.admin_revision+1,updated_at=clock_timestamp() where c.organisation_id=org.id and c.site_id=target_site_uuid and c.id=resource_uuid and c.archived_at is null returning * into closure;if closure.id is null then result:=jsonb_build_object('outcome','not_found');else resource_id:=closure.id::text;success:=true;end if;end if;
      elsif command_name='update_organisation_settings' then
        permission_name:='settings.manage';resource_type:='organisation_settings';resource_id:=org.id::text;event_name:='organisation_settings_updated';
        if not private.has_permission(org.id,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif coalesce((payload->>'workWeekStarts')::integer,0) not between 1 and 7 then result:=jsonb_build_object('outcome','invalid_request');
        else update public.organisation_settings set work_week_starts=(payload->>'workWeekStarts')::smallint,default_timezone=coalesce(nullif(payload->>'defaultTimezone',''),'Europe/London'),operating_defaults=coalesce(payload->'operatingDefaults','{}'::jsonb),staffing_defaults=coalesce(payload->'staffingDefaults','{}'::jsonb),admin_revision=admin_revision+1,updated_at=clock_timestamp() where organisation_id=org.id;success:=true;end if;
      elsif command_name='update_site_settings' then
        target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');permission_name:='settings.manage';resource_type:='site_settings';resource_id:=target_site_uuid::text;event_name:='site_settings_updated';
        if not private.has_site_permission(org.id,target_site_uuid,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif private.commercial_admin_time(payload->>'openingTime') is null or private.commercial_admin_time(payload->>'closingTime') is null or private.commercial_admin_time(payload->>'openingTime')>=private.commercial_admin_time(payload->>'closingTime') then result:=jsonb_build_object('outcome','invalid_request');
        else update public.site_settings s set opening_time=private.commercial_admin_time(payload->>'openingTime'),closing_time=private.commercial_admin_time(payload->>'closingTime'),timezone_override=nullif(payload->>'timezoneOverride',''),work_week_starts_override=nullif(payload->>'workWeekStartsOverride','')::smallint,admin_revision=s.admin_revision+1,updated_at=clock_timestamp() where s.organisation_id=org.id and s.site_id=target_site_uuid;success:=found;end if;
      elsif command_name in('create_manager_invitation','create_staff_invitation','resend_invitation','revoke_invitation') then
        permission_name:='membership.manage';resource_type:='invitation';resource_uuid:=private.commercial_admin_uuid(payload->>'invitationId');event_name:=case when command_name='revoke_invitation' then 'invitation_revoked' else 'invitation_created' end;
        if not private.has_permission(org.id,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif command_name='revoke_invitation' then update public.organisation_invitations set status='revoked',revoked_at=clock_timestamp(),revoked_by_membership_id=actor.id,updated_at=clock_timestamp() where organisation_id=org.id and id=resource_uuid and status='pending';resource_id:=resource_uuid::text;success:=found;
        elsif command_name='resend_invitation' then
          select * into invitation from public.organisation_invitations i where i.organisation_id=org.id and i.id=resource_uuid and i.status='pending' for update;
          if not found then result:=jsonb_build_object('outcome','not_found');
          elsif coalesce(payload->>'tokenHash','')!~'^[0-9a-f]{64}$' then result:=jsonb_build_object('outcome','invalid_request');
          else
            update public.organisation_invitations set status='superseded',superseded_at=clock_timestamp(),updated_at=clock_timestamp() where id=invitation.id;
            insert into public.organisation_invitations(organisation_id,invited_email,token_hash,status,expires_at,invited_by_membership_id,invitation_kind,template_version,staff_id,resend_of_invitation_id)
            values(org.id,invitation.invited_email,decode(payload->>'tokenHash','hex'),'pending',clock_timestamp()+interval '7 days',actor.id,invitation.invitation_kind,invitation.template_version,invitation.staff_id,invitation.id) returning * into replacement_invitation;
            insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type,site_id) select organisation_id,replacement_invitation.id,role,scope_type,site_id from public.organisation_invitation_roles where organisation_id=org.id and invitation_id=invitation.id;
            insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) select organisation_id,replacement_invitation.id,site_id from public.organisation_invitation_site_access where organisation_id=org.id and invitation_id=invitation.id;
            update public.organisation_invitations set superseded_by_invitation_id=replacement_invitation.id where id=invitation.id;
            resource_id:=replacement_invitation.id::text;event_name:='invitation_resent';success:=true;
          end if;
        else
          if command_name='create_manager_invitation' then decision:=private.commercial_capability_decision(org.id,'members.privileged.limit',jsonb_build_object('requestedUnits',1));if not coalesce((decision->>'allowed')::boolean,false) then result:=jsonb_build_object('outcome','upgrade_required','capabilityKey','members.privileged.limit');end if;end if;
          if result is null and (coalesce(payload->>'email','')!~*'^[^@\s]+@[^@\s]+\.[^@\s]+$' or coalesce(payload->>'tokenHash','')!~'^[0-9a-f]{64}$') then result:=jsonb_build_object('outcome','invalid_request');end if;
          if result is null then
            staff_value:=nullif(payload->>'staffId','');target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');raw_status:=case when command_name='create_staff_invitation' then 'staff' else coalesce(payload->>'role','site_manager') end;
            if command_name='create_staff_invitation' and not exists(select 1 from public.staff_profiles p where p.organisation_id=org.id and p.id=staff_value and p.active) then result:=jsonb_build_object('outcome','not_found');
            elsif command_name='create_manager_invitation' and not private.can_grant_manager_role(org.id,actor.id,raw_status) then result:=jsonb_build_object('outcome','permission_denied');
            else
              insert into public.organisation_invitations(organisation_id,invited_email,token_hash,status,expires_at,invited_by_membership_id,invitation_kind,template_version,staff_id)
              values(org.id,lower(btrim(payload->>'email')),decode(payload->>'tokenHash','hex'),'pending',clock_timestamp()+interval '7 days',actor.id,case when command_name='create_staff_invitation' then 'staff' else 'manager' end,case when command_name='create_staff_invitation' then 'staff_invitation_v1' else 'manager_invitation_v1' end,staff_value) returning id into resource_uuid;
              if command_name='create_staff_invitation' then insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type) values(org.id,resource_uuid,'staff','organisation');insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) select org.id,resource_uuid,a.site_id from public.staff_site_assignments a where a.organisation_id=org.id and a.staff_id=staff_value and (a.effective_to is null or a.effective_to>=(clock_timestamp() at time zone org.timezone)::date);
              else insert into public.organisation_invitation_roles(organisation_id,invitation_id,role,scope_type,site_id) values(org.id,resource_uuid,raw_status::public.organisation_role,(case when target_site_uuid is null then 'organisation' else 'site' end)::public.membership_scope_type,target_site_uuid);if target_site_uuid is not null then insert into public.organisation_invitation_site_access(organisation_id,invitation_id,site_id) values(org.id,resource_uuid,target_site_uuid);end if;end if;
              resource_id:=resource_uuid::text;success:=true;
            end if;
          end if;
        end if;
      elsif command_name in('start_kiosk_registration','replace_kiosk_device') then
        target_site_uuid:=private.commercial_admin_uuid(payload->>'siteId');permission_name:='kiosk.manage';resource_type:='kiosk_registration';event_name:='kiosk_registration_started';
        if not private.has_site_permission(org.id,target_site_uuid,permission_name) then result:=jsonb_build_object('outcome','permission_denied');
        elsif coalesce(payload->>'secretHash','')!~'^[0-9a-f]{64}$' or length(btrim(payload->>'deviceName')) not between 3 and 100 then result:=jsonb_build_object('outcome','invalid_request');
        elsif command_name='replace_kiosk_device' and not exists(select 1 from public.kiosk_devices d where d.organisation_id=org.id and d.site_id=target_site_uuid and d.id=private.commercial_admin_uuid(payload->>'deviceId') and d.active) then result:=jsonb_build_object('outcome','not_found');
        elsif exists(select 1 from public.commercial_kiosk_registrations r where r.organisation_id=org.id and r.site_id=target_site_uuid and r.status='pending' and r.expires_at>clock_timestamp()) then result:=jsonb_build_object('outcome','conflict','code','registration_already_pending');
        else if command_name='replace_kiosk_device' then update public.kiosk_devices set active=false,revoked_at=clock_timestamp(),revoked_by_membership_id=actor.id,token_hash=sha256(extensions.gen_random_bytes(32)),credential_revision=credential_revision+1,offline_enabled=false,updated_at=clock_timestamp() where organisation_id=org.id and id=private.commercial_admin_uuid(payload->>'deviceId');event_name:='kiosk_device_replacement_started';end if;insert into public.commercial_kiosk_registrations(organisation_id,site_id,requested_by_membership_id,intended_device_name,secret_hash,expires_at,safe_audit_metadata) values(org.id,target_site_uuid,actor.id,btrim(payload->>'deviceName'),decode(payload->>'secretHash','hex'),clock_timestamp()+interval '10 minutes',jsonb_build_object('source','post_live_admin','replacement',command_name='replace_kiosk_device')) returning id into resource_uuid;resource_id:=resource_uuid::text;success:=true;end if;
      elsif command_name in('revoke_kiosk_device','require_kiosk_reprovision') then
        resource_uuid:=private.commercial_admin_uuid(payload->>'deviceId');select * into device from public.kiosk_devices d where d.organisation_id=org.id and d.id=resource_uuid for update;permission_name:='kiosk.manage';resource_type:='kiosk_device';resource_id:=resource_uuid::text;event_name:='kiosk_device_revoked';
        if not found then result:=jsonb_build_object('outcome','not_found');elsif not private.has_site_permission(org.id,device.site_id,permission_name) then result:=jsonb_build_object('outcome','permission_denied');elsif command_name='require_kiosk_reprovision' then update public.kiosk_devices set reprovision_required=true,offline_enabled=false,updated_at=clock_timestamp() where id=device.id;event_name:='kiosk_reprovision_required';success:=true;else update public.kiosk_devices set active=false,revoked_at=clock_timestamp(),revoked_by_membership_id=actor.id,token_hash=sha256(extensions.gen_random_bytes(32)),credential_revision=credential_revision+1,offline_enabled=false,updated_at=clock_timestamp() where id=device.id;success:=true;end if;
      elsif command_name='reset_staff_pin' then
        staff_value:=payload->>'staffId';permission_name:='kiosk.manage';resource_type:='staff_pin';resource_id:=staff_value;event_name:='staff_pin_reset';
        if not private.can_access_staff(org.id,staff_value,'staff.manage') or not exists(select 1 from public.staff_site_assignments a where a.organisation_id=org.id and a.staff_id=staff_value and private.has_site_permission(org.id,a.site_id,permission_name)) then result:=jsonb_build_object('outcome','permission_denied');
        elsif coalesce(payload->>'temporaryPin','')!~'^\d{4,6}$' then result:=jsonb_build_object('outcome','invalid_request');
        else perform public.set_staff_kiosk_pin(staff_value,payload->>'temporaryPin',true);success:=true;end if;
      else result:=jsonb_build_object('outcome','invalid_request','code','unknown_command');end if;
    exception when unique_violation then result:=jsonb_build_object('outcome','conflict','code','duplicate');when check_violation or foreign_key_violation or invalid_text_representation then result:=jsonb_build_object('outcome','invalid_request');when raise_exception then if sqlerrm like '%last active organisation owner%' then result:=jsonb_build_object('outcome','conflict','code','last_active_owner');else result:=jsonb_build_object('outcome','conflict','code','operation_rejected');end if;end;
  end if;
  if success then
    update public.organisations set admin_revision=admin_revision+1,updated_at=clock_timestamp() where id=org.id returning admin_revision into new_revision;
    insert into public.commercial_admin_events(organisation_id,site_id,actor_membership_id,event_type,resource_type,resource_id,organisation_revision,safe_metadata)
    values(org.id,target_site_uuid,actor.id,event_name,resource_type,resource_id,new_revision,jsonb_build_object('command',command_name));
    result:=jsonb_build_object('outcome','success','code',event_name,'resourceId',resource_id,'revision',new_revision);
  elsif result is null then result:=jsonb_build_object('outcome','conflict','code','operation_rejected');end if;
  update public.commercial_admin_command_receipts receipt set status=case when result->>'outcome'='success' then 'succeeded' else 'failed_final' end,result_json=result,completed_at=clock_timestamp() where receipt.organisation_id=org.id and receipt.idempotency_key=key_value;
  return result;
end;$$;

revoke all on function private.protect_commercial_admin_event(),private.protect_commercial_admin_ownership(),private.commercial_admin_uuid(text),private.commercial_admin_date(text),private.commercial_admin_time(text),private.commercial_admin_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_commercial_admin_snapshot(uuid,uuid),public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.get_commercial_admin_snapshot(uuid,uuid),public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) to authenticated;
