-- Workstream 8A: additive commercial rota and leave tenancy.
-- Wholly unowned rows remain the explicit Jan compatibility path. Commercial
-- writes are accepted only through the guarded command functions below.

alter table public.work_areas
  add constraint work_areas_organisation_site_id_key unique (organisation_id, site_id, id);

alter table public.rota_settings
  add column organisation_id uuid references public.organisations(id) on delete restrict,
  add column site_id uuid,
  add column revision bigint not null default 1 check (revision > 0),
  add constraint rota_settings_commercial_ownership check (
    (organisation_id is null and site_id is null)
    or (organisation_id is not null and site_id is not null)
  ),
  add constraint rota_settings_commercial_site_fk foreign key (organisation_id, site_id)
    references public.organisation_sites(organisation_id, id) on delete restrict;

alter table public.rota_weeks
  add column organisation_id uuid references public.organisations(id) on delete restrict,
  add column site_id uuid,
  add column revision bigint not null default 1 check (revision > 0),
  add column created_by_membership_id uuid,
  add column updated_by_membership_id uuid,
  add column published_by_membership_id uuid,
  add column archived_by_membership_id uuid,
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add constraint rota_weeks_commercial_ownership check (
    (organisation_id is null and site_id is null and created_by_membership_id is null and updated_by_membership_id is null)
    or (organisation_id is not null and site_id is not null and created_by_membership_id is not null and updated_by_membership_id is not null)
  ),
  add constraint rota_weeks_commercial_site_fk foreign key (organisation_id, site_id)
    references public.organisation_sites(organisation_id, id) on delete restrict,
  add constraint rota_weeks_created_membership_fk foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_weeks_updated_membership_fk foreign key (organisation_id, updated_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_weeks_published_membership_fk foreign key (organisation_id, published_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_weeks_archived_membership_fk foreign key (organisation_id, archived_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_weeks_organisation_site_id_key unique (organisation_id, site_id, id);

alter table public.rota_weeks
  drop constraint if exists rota_week_publish_audit,
  drop constraint if exists rota_week_archive_audit,
  add constraint rota_week_publish_audit check (
    status <> 'published' or (
      published_at is not null
      and ((organisation_id is null and published_by is not null) or (organisation_id is not null and published_by_membership_id is not null))
    )
  ),
  add constraint rota_week_archive_audit check (
    status <> 'archived' or (
      archived_at is not null
      and ((organisation_id is null and archived_by is not null) or (organisation_id is not null and archived_by_membership_id is not null))
    )
  );

drop index if exists public.rota_weeks_one_active_version_idx;
create unique index rota_weeks_legacy_one_active_version_idx
  on public.rota_weeks (week_start_date)
  where organisation_id is null and site_id is null and status <> 'archived';
create unique index rota_weeks_commercial_one_active_version_idx
  on public.rota_weeks (organisation_id, site_id, week_start_date)
  where organisation_id is not null and site_id is not null and status <> 'archived';

alter table public.rota_shifts
  add column organisation_id uuid references public.organisations(id) on delete restrict,
  add column site_id uuid,
  add column work_area_id uuid,
  add column revision bigint not null default 1 check (revision > 0),
  add column created_by_membership_id uuid,
  add column updated_by_membership_id uuid,
  add column archived_by_membership_id uuid,
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add constraint rota_shifts_commercial_ownership check (
    (organisation_id is null and site_id is null and work_area_id is null and created_by_membership_id is null and updated_by_membership_id is null)
    or (organisation_id is not null and site_id is not null and created_by_membership_id is not null and updated_by_membership_id is not null)
  ),
  add constraint rota_shifts_week_fk foreign key (organisation_id, site_id, rota_week_id)
    references public.rota_weeks(organisation_id, site_id, id) on delete restrict,
  add constraint rota_shifts_staff_fk foreign key (organisation_id, staff_id)
    references public.staff_profiles(organisation_id, id) on delete restrict,
  add constraint rota_shifts_work_area_fk foreign key (organisation_id, site_id, work_area_id)
    references public.work_areas(organisation_id, site_id, id) on delete restrict,
  add constraint rota_shifts_created_membership_fk foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_shifts_updated_membership_fk foreign key (organisation_id, updated_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_shifts_archived_membership_fk foreign key (organisation_id, archived_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_shifts_organisation_site_id_key unique (organisation_id, site_id, id);

alter table public.rota_shifts
  drop constraint if exists rota_shift_archive_audit,
  add constraint rota_shift_archive_audit check (
    (archived_at is null and archived_by is null and archived_by_membership_id is null)
    or (archived_at is not null and (
      (organisation_id is null and archived_by is not null)
      or (organisation_id is not null and archived_by_membership_id is not null)
    ))
  );

create index rota_shifts_commercial_week_idx on public.rota_shifts
  (organisation_id, site_id, rota_week_id, shift_date, start_time)
  where organisation_id is not null and archived_at is null;
create index rota_shifts_commercial_staff_conflict_idx on public.rota_shifts
  (organisation_id, staff_id, shift_date, start_time, end_time)
  where organisation_id is not null and archived_at is null and status <> 'cancelled';

alter table public.rota_templates
  add column organisation_id uuid references public.organisations(id) on delete restrict,
  add column site_id uuid,
  add column revision bigint not null default 1 check (revision > 0),
  add column created_by_membership_id uuid,
  add column updated_by_membership_id uuid,
  add column archived_by_membership_id uuid,
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add constraint rota_templates_commercial_ownership check (
    (organisation_id is null and site_id is null and created_by_membership_id is null and updated_by_membership_id is null)
    or (organisation_id is not null and site_id is not null and created_by_membership_id is not null and updated_by_membership_id is not null)
  ),
  add constraint rota_templates_site_fk foreign key (organisation_id, site_id)
    references public.organisation_sites(organisation_id, id) on delete restrict,
  add constraint rota_templates_created_membership_fk foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_templates_updated_membership_fk foreign key (organisation_id, updated_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_templates_archived_membership_fk foreign key (organisation_id, archived_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_templates_organisation_site_id_key unique (organisation_id, site_id, id);

alter table public.rota_templates
  drop constraint if exists rota_template_archive_audit,
  add constraint rota_template_archive_audit check (
    (status='active' and archived_at is null and archived_by is null and archived_by_membership_id is null)
    or (status='archived' and archived_at is not null and (
      (organisation_id is null and archived_by is not null)
      or (organisation_id is not null and archived_by_membership_id is not null)
    ))
  );

create unique index rota_templates_commercial_active_name_idx on public.rota_templates
  (organisation_id, site_id, lower(name)) where organisation_id is not null and status = 'active';

alter table public.rota_template_shifts
  add column organisation_id uuid references public.organisations(id) on delete restrict,
  add column site_id uuid,
  add column work_area_id uuid,
  add column revision bigint not null default 1 check (revision > 0),
  add column created_by_membership_id uuid,
  add column updated_by_membership_id uuid,
  add column archived_by_membership_id uuid,
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add constraint rota_template_shifts_commercial_ownership check (
    (organisation_id is null and site_id is null and work_area_id is null and created_by_membership_id is null and updated_by_membership_id is null)
    or (organisation_id is not null and site_id is not null and created_by_membership_id is not null and updated_by_membership_id is not null)
  ),
  add constraint rota_template_shifts_template_fk foreign key (organisation_id, site_id, template_id)
    references public.rota_templates(organisation_id, site_id, id) on delete cascade,
  add constraint rota_template_shifts_staff_fk foreign key (organisation_id, staff_id)
    references public.staff_profiles(organisation_id, id) on delete restrict,
  add constraint rota_template_shifts_work_area_fk foreign key (organisation_id, site_id, work_area_id)
    references public.work_areas(organisation_id, site_id, id) on delete restrict,
  add constraint rota_template_shifts_created_membership_fk foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_template_shifts_updated_membership_fk foreign key (organisation_id, updated_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_template_shifts_archived_membership_fk foreign key (organisation_id, archived_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint rota_template_shifts_organisation_site_id_key unique (organisation_id, site_id, id);

alter table public.rota_template_shifts
  drop constraint if exists rota_template_shift_archive_audit,
  add constraint rota_template_shift_archive_audit check (
    (archived_at is null and archived_by is null and archived_by_membership_id is null)
    or (archived_at is not null and (
      (organisation_id is null and archived_by is not null)
      or (organisation_id is not null and archived_by_membership_id is not null)
    ))
  );

alter table public.rota_template_applications
  add column organisation_id uuid references public.organisations(id) on delete restrict,
  add column site_id uuid,
  add column applied_by_membership_id uuid,
  alter column applied_by drop not null,
  add constraint rota_template_applications_commercial_ownership check (
    (organisation_id is null and site_id is null and applied_by_membership_id is null)
    or (organisation_id is not null and site_id is not null and applied_by_membership_id is not null)
  ),
  add constraint rota_template_applications_template_fk foreign key (organisation_id, site_id, template_id)
    references public.rota_templates(organisation_id, site_id, id) on delete restrict,
  add constraint rota_template_applications_week_fk foreign key (organisation_id, site_id, rota_week_id)
    references public.rota_weeks(organisation_id, site_id, id) on delete restrict,
  add constraint rota_template_applications_membership_fk foreign key (organisation_id, applied_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.leave_requests
  add column organisation_id uuid references public.organisations(id) on delete restrict,
  add column source_site_id uuid,
  add column revision bigint not null default 1 check (revision > 0),
  add column requested_by_membership_id uuid,
  add column reviewed_by_membership_id uuid,
  add column cancelled_by_membership_id uuid,
  add constraint leave_requests_commercial_ownership check (
    (organisation_id is null and requested_by_membership_id is null)
    or (organisation_id is not null and requested_by_membership_id is not null)
  ),
  add constraint leave_requests_staff_fk foreign key (organisation_id, staff_id)
    references public.staff_profiles(organisation_id, id) on delete restrict,
  add constraint leave_requests_source_site_fk foreign key (organisation_id, source_site_id)
    references public.organisation_sites(organisation_id, id) on delete restrict,
  add constraint leave_requests_requested_membership_fk foreign key (organisation_id, requested_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint leave_requests_reviewed_membership_fk foreign key (organisation_id, reviewed_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint leave_requests_cancelled_membership_fk foreign key (organisation_id, cancelled_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint leave_requests_organisation_id_key unique (organisation_id, id);

create index leave_requests_commercial_staff_dates_idx on public.leave_requests
  (organisation_id, staff_id, start_date, end_date, status)
  where organisation_id is not null;

create table public.commercial_operation_receipts (
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  idempotency_key uuid not null,
  operation_domain text not null check (operation_domain in ('rota','leave')),
  operation_kind text not null,
  request_hash text not null,
  requested_by_membership_id uuid not null,
  status text not null check (status in ('processing','succeeded','failed_final')),
  safe_result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (organisation_id, idempotency_key),
  foreign key (organisation_id, requested_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  check ((status = 'processing' and completed_at is null) or (status <> 'processing' and completed_at is not null))
);

create table public.commercial_rota_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  site_id uuid not null,
  rota_week_id uuid,
  rota_shift_id uuid,
  event_type text not null,
  actor_membership_id uuid not null,
  revision bigint not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, actor_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict
);

create table public.commercial_leave_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  leave_request_id uuid not null,
  event_type text not null,
  actor_membership_id uuid not null,
  revision bigint not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organisation_id, leave_request_id) references public.leave_requests(organisation_id, id) on delete restrict,
  foreign key (organisation_id, actor_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict
);

create index commercial_rota_events_org_site_idx on public.commercial_rota_events (organisation_id, site_id, created_at desc);
create index commercial_leave_events_org_idx on public.commercial_leave_events (organisation_id, created_at desc);

alter table public.commercial_operation_receipts enable row level security;
alter table public.commercial_rota_events enable row level security;
alter table public.commercial_leave_events enable row level security;

revoke all on public.commercial_operation_receipts, public.commercial_rota_events, public.commercial_leave_events from public, anon, authenticated;
grant select on public.commercial_rota_events, public.commercial_leave_events to authenticated;

create policy commercial_rota_events_read on public.commercial_rota_events for select to authenticated
  using (private.has_site_permission(organisation_id, site_id, 'rota.read'));
create policy commercial_leave_events_read on public.commercial_leave_events for select to authenticated
  using (private.can_access_staff(organisation_id,(select request.staff_id from public.leave_requests request where request.organisation_id=commercial_leave_events.organisation_id and request.id=commercial_leave_events.leave_request_id),'leave.read'));

create or replace function private.prevent_commercial_rota_reparenting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.organisation_id is not null and (
    new.organisation_id is distinct from old.organisation_id
    or (to_jsonb(new)->'site_id') is distinct from (to_jsonb(old)->'site_id')
  ) then
    raise exception 'commercial rota ownership is immutable';
  end if;
  return new;
end
$$;

create or replace function private.prevent_commercial_leave_reparenting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.organisation_id is not null and (
    new.organisation_id is distinct from old.organisation_id
    or new.staff_id is distinct from old.staff_id
  ) then
    raise exception 'commercial leave ownership is immutable';
  end if;
  return new;
end
$$;

create trigger rota_settings_commercial_ownership_immutable before update on public.rota_settings
  for each row execute function private.prevent_commercial_rota_reparenting();
create trigger rota_weeks_commercial_ownership_immutable before update on public.rota_weeks
  for each row execute function private.prevent_commercial_rota_reparenting();
create trigger rota_shifts_commercial_ownership_immutable before update on public.rota_shifts
  for each row execute function private.prevent_commercial_rota_reparenting();
create trigger rota_templates_commercial_ownership_immutable before update on public.rota_templates
  for each row execute function private.prevent_commercial_rota_reparenting();
create trigger rota_template_shifts_commercial_ownership_immutable before update on public.rota_template_shifts
  for each row execute function private.prevent_commercial_rota_reparenting();
create trigger rota_template_applications_commercial_ownership_immutable before update on public.rota_template_applications
  for each row execute function private.prevent_commercial_rota_reparenting();
create trigger leave_requests_commercial_ownership_immutable before update on public.leave_requests
  for each row execute function private.prevent_commercial_leave_reparenting();

create or replace function private.reject_commercial_audit_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'commercial audit evidence is append-only';
end
$$;
create trigger commercial_rota_events_append_only before update or delete on public.commercial_rota_events
  for each row execute function private.reject_commercial_audit_mutation();
create trigger commercial_leave_events_append_only before update or delete on public.commercial_leave_events
  for each row execute function private.reject_commercial_audit_mutation();

create or replace function private.commercial_iso_date(value text)
returns date language plpgsql immutable security definer set search_path='' as $$
declare parsed date;
begin
  if value is null or value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  begin parsed:=value::date; exception when others then return null; end;
  if to_char(parsed,'YYYY-MM-DD')<>value then return null; end if;
  return parsed;
end$$;

create or replace function private.commercial_local_time(value text)
returns time language plpgsql immutable security definer set search_path='' as $$
declare parsed time;
begin
  if value is null or value!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  begin parsed:=value::time; exception when others then return null; end;
  return parsed;
end$$;

create or replace function private.commercial_uuid(value text)
returns uuid language plpgsql immutable security definer set search_path='' as $$
declare parsed uuid;
begin
  if value is null or value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  begin parsed:=value::uuid; exception when others then return null; end;
  return parsed;
end$$;

create or replace function private.commercial_nonnegative_integer(value text)
returns integer language plpgsql immutable security definer set search_path='' as $$
declare parsed integer;
begin
  if value is null or value!~'^[0-9]+$' then return null; end if;
  begin parsed:=value::integer; exception when others then return null; end;
  return parsed;
end$$;

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

create or replace function private.commercial_receipt_begin(
  target_organisation_id uuid, operation_id uuid, domain_name text, command_name text,
  payload jsonb, actor_membership_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.commercial_operation_receipts; calculated_hash text := encode(sha256(convert_to(jsonb_build_object('domain',domain_name,'command',command_name,'payload',payload)::text,'UTF8')),'hex');
begin
  select * into existing from public.commercial_operation_receipts
    where organisation_id=target_organisation_id and idempotency_key=operation_id for update;
  if found then
    if existing.operation_domain<>domain_name or existing.operation_kind<>command_name or existing.request_hash<>calculated_hash then
      return jsonb_build_object('outcome','idempotency_conflict');
    end if;
    if existing.status<>'processing' then return existing.safe_result; end if;
    return jsonb_build_object('outcome','indeterminate');
  end if;
  insert into public.commercial_operation_receipts(
    organisation_id,idempotency_key,operation_domain,operation_kind,request_hash,requested_by_membership_id,status
  ) values (target_organisation_id,operation_id,domain_name,command_name,calculated_hash,actor_membership_id,'processing');
  return null;
end
$$;

create or replace function private.commercial_receipt_complete(
  target_organisation_id uuid, operation_id uuid, result jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.commercial_operation_receipts set
    status=case when result->>'outcome'='success' then 'succeeded' else 'failed_final' end,
    safe_result=result, completed_at=clock_timestamp()
  where organisation_id=target_organisation_id and idempotency_key=operation_id;
  return result;
end
$$;

create or replace function public.execute_commercial_rota_command(
  target_organisation_id uuid,
  target_site_id uuid,
  command_name text,
  payload jsonb,
  idempotency_key uuid,
  expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_membership uuid; replay jsonb; result jsonb; week public.rota_weeks; shift public.rota_shifts;
  validation jsonb; new_id uuid; copied_count integer:=0; skipped_count integer:=0; target_date date;
  source_date date; source_week public.rota_weeks; template public.rota_templates;
  template_shift public.rota_template_shifts; application_id uuid; apply_mode public.rota_template_apply_mode;
  new_week_created boolean:=false;
begin
  actor_membership:=private.current_membership_id(target_organisation_id);
  if actor_membership is null or not private.has_site_permission(target_organisation_id,target_site_id,'rota.manage') then
    return jsonb_build_object('outcome','permission_denied');
  end if;
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then return jsonb_build_object('outcome','mfa_required'); end if;
  if not exists(select 1 from public.organisation_sites site where site.organisation_id=target_organisation_id and site.id=target_site_id and site.active and site.archived_at is null) then
    return jsonb_build_object('outcome','not_found');
  end if;
  replay:=private.commercial_receipt_begin(target_organisation_id,idempotency_key,'rota',command_name,payload,actor_membership);
  if replay is not null then return replay; end if;

  if command_name='create_week' then
    target_date:=private.commercial_iso_date(payload->>'weekStart');
    if target_date is null or extract(isodow from target_date)<>1 then result:=jsonb_build_object('outcome','invalid_request','code','week_start');
    else
      insert into public.rota_weeks(
        organisation_id,site_id,week_start_date,status,title,notes,created_by,updated_by,
        created_by_membership_id,updated_by_membership_id
      ) values (
        target_organisation_id,target_site_id,target_date,'draft',nullif(btrim(payload->>'title'),''),nullif(btrim(payload->>'notes'),''),null,null,
        actor_membership,actor_membership
      ) returning * into week;
      insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,event_type,actor_membership_id,revision)
        values(target_organisation_id,target_site_id,week.id,'week_created',actor_membership,week.revision);
      result:=jsonb_build_object('outcome','success','code','week_created','weekId',week.id,'revision',week.revision);
    end if;
  elsif command_name='save_shift' then
    select * into week from public.rota_weeks where organisation_id=target_organisation_id and site_id=target_site_id
      and id=private.commercial_uuid(payload->>'weekId') and status='draft' for update;
    if not found then result:=jsonb_build_object('outcome','not_found');
    else
      perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||(payload->>'staffId')||':'||(payload->>'shiftDate'),0));
      if payload ? 'shiftId' and nullif(payload->>'shiftId','') is not null then
        select * into shift from public.rota_shifts where organisation_id=target_organisation_id and site_id=target_site_id and id=private.commercial_uuid(payload->>'shiftId') for update;
        if not found then result:=jsonb_build_object('outcome','not_found');
        elsif expected_revision is null or shift.revision<>expected_revision then result:=jsonb_build_object('outcome','workflow_changed','revision',shift.revision);
        end if;
      end if;
      if result is null and (private.commercial_iso_date(payload->>'shiftDate') is null or private.commercial_local_time(payload->>'startTime') is null or private.commercial_local_time(payload->>'endTime') is null) then
        result:=jsonb_build_object('outcome','invalid_request','code','shift_time');
      elsif result is null and private.commercial_iso_date(payload->>'shiftDate') not between week.week_start_date and week.week_start_date+6 then
        result:=jsonb_build_object('outcome','invalid_request','code','week_date_required');
      elsif result is null and payload ? 'breakMinutes' and (private.commercial_nonnegative_integer(payload->>'breakMinutes') is null or private.commercial_nonnegative_integer(payload->>'breakMinutes')>1440) then
        result:=jsonb_build_object('outcome','invalid_request','code','break_minutes');
      elsif result is null and private.commercial_nonnegative_integer(coalesce(payload->>'breakMinutes','0')) > extract(epoch from (private.commercial_local_time(payload->>'endTime')-private.commercial_local_time(payload->>'startTime')))/60 then
        result:=jsonb_build_object('outcome','invalid_request','code','break_minutes');
      elsif result is null and payload ? 'breakUnspecified' and payload->>'breakUnspecified' not in ('true','false') then
        result:=jsonb_build_object('outcome','invalid_request','code','break_minutes');
      elsif result is null and coalesce(payload->>'status','scheduled') not in ('scheduled','cancelled','completed') then
        result:=jsonb_build_object('outcome','invalid_request','code','shift_status');
      elsif result is null and payload ? 'workAreaId' and nullif(payload->>'workAreaId','') is not null and private.commercial_uuid(payload->>'workAreaId') is null then
        result:=jsonb_build_object('outcome','invalid_request','code','work_area');
      end if;
      if result is null then
        validation:=private.validate_commercial_rota_shift(target_organisation_id,target_site_id,payload->>'staffId',private.commercial_iso_date(payload->>'shiftDate'),private.commercial_local_time(payload->>'startTime'),private.commercial_local_time(payload->>'endTime'),private.commercial_uuid(nullif(payload->>'workAreaId','')),shift.id);
        if not (validation->>'ok')::boolean and (
          validation->>'code' not in ('approved_leave_conflict','shift_overlap','cross_site_overlap')
          or nullif(btrim(payload->>'overrideReason'),'') is null
        ) then result:=jsonb_build_object('outcome','conflict','code',validation->>'code');
        elsif shift.id is null then
          insert into public.rota_shifts(
            organisation_id,site_id,rota_week_id,staff_id,shift_date,start_time,end_time,break_minutes,break_unspecified,
            work_area_id,work_area,room_or_area,role_on_shift,notes,status,leave_override_reason,overlap_override_reason,
            created_by,updated_by,created_by_membership_id,updated_by_membership_id
          ) values (
            target_organisation_id,target_site_id,week.id,payload->>'staffId',private.commercial_iso_date(payload->>'shiftDate'),private.commercial_local_time(payload->>'startTime'),private.commercial_local_time(payload->>'endTime'),coalesce(private.commercial_nonnegative_integer(payload->>'breakMinutes'),0),coalesce((payload->>'breakUnspecified')::boolean,false),
            private.commercial_uuid(nullif(payload->>'workAreaId','')),(select area.name from public.work_areas area where area.id=private.commercial_uuid(nullif(payload->>'workAreaId',''))),(select area.name from public.work_areas area where area.id=private.commercial_uuid(nullif(payload->>'workAreaId',''))),nullif(payload->>'roleOnShift',''),nullif(payload->>'notes',''),coalesce(payload->>'status','scheduled')::public.rota_shift_status,
            case when validation->>'code'='approved_leave_conflict' then nullif(btrim(payload->>'overrideReason'),'') end,
            case when validation->>'code' in ('shift_overlap','cross_site_overlap') then nullif(btrim(payload->>'overrideReason'),'') end,
            null,null,actor_membership,actor_membership
          ) returning * into shift;
          result:=jsonb_build_object('outcome','success','code','shift_created','shiftId',shift.id,'revision',shift.revision);
        else
          update public.rota_shifts set start_time=private.commercial_local_time(payload->>'startTime'),end_time=private.commercial_local_time(payload->>'endTime'),
            break_minutes=coalesce(private.commercial_nonnegative_integer(payload->>'breakMinutes'),0),break_unspecified=coalesce((payload->>'breakUnspecified')::boolean,false),work_area_id=private.commercial_uuid(nullif(payload->>'workAreaId','')),
            work_area=(select area.name from public.work_areas area where area.id=private.commercial_uuid(nullif(payload->>'workAreaId',''))),room_or_area=(select area.name from public.work_areas area where area.id=private.commercial_uuid(nullif(payload->>'workAreaId',''))),role_on_shift=nullif(payload->>'roleOnShift',''),status=coalesce(payload->>'status','scheduled')::public.rota_shift_status,
            notes=nullif(payload->>'notes',''),
            leave_override_reason=case when validation->>'code'='approved_leave_conflict' then nullif(btrim(payload->>'overrideReason'),'') else null end,
            overlap_override_reason=case when validation->>'code' in ('shift_overlap','cross_site_overlap') then nullif(btrim(payload->>'overrideReason'),'') else null end,
            updated_by_membership_id=actor_membership,revision=revision+1
          where id=shift.id returning * into shift;
          result:=jsonb_build_object('outcome','success','code','shift_updated','shiftId',shift.id,'revision',shift.revision);
        end if;
        if result->>'outcome'='success' then
          update public.rota_weeks set revision=revision+1,updated_by_membership_id=actor_membership where id=week.id;
          insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,rota_shift_id,event_type,actor_membership_id,revision,safe_metadata)
            values(target_organisation_id,target_site_id,week.id,shift.id,result->>'code',actor_membership,shift.revision,jsonb_build_object('staffId',shift.staff_id,'shiftDate',shift.shift_date));
        end if;
      end if;
    end if;
  elsif command_name='archive_shift' then
    select * into shift from public.rota_shifts where organisation_id=target_organisation_id and site_id=target_site_id and id=private.commercial_uuid(payload->>'shiftId') for update;
    if not found then result:=jsonb_build_object('outcome','not_found');
    elsif expected_revision is null or shift.revision<>expected_revision then result:=jsonb_build_object('outcome','workflow_changed','revision',shift.revision);
    else
      update public.rota_shifts set archived_at=clock_timestamp(),archived_by_membership_id=actor_membership,updated_by_membership_id=actor_membership,revision=revision+1 where id=shift.id returning * into shift;
      update public.rota_weeks set revision=revision+1,updated_by_membership_id=actor_membership where id=shift.rota_week_id;
      insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,rota_shift_id,event_type,actor_membership_id,revision)
        values(target_organisation_id,target_site_id,shift.rota_week_id,shift.id,'shift_archived',actor_membership,shift.revision);
      result:=jsonb_build_object('outcome','success','code','shift_archived','shiftId',shift.id,'revision',shift.revision);
    end if;
  elsif command_name='set_week_status' then
    select * into week from public.rota_weeks where organisation_id=target_organisation_id and site_id=target_site_id and id=private.commercial_uuid(payload->>'weekId') for update;
    if not found then result:=jsonb_build_object('outcome','not_found');
    elsif expected_revision is null or week.revision<>expected_revision then result:=jsonb_build_object('outcome','workflow_changed','revision',week.revision);
    elsif payload->>'status' not in ('draft','published','archived') then result:=jsonb_build_object('outcome','invalid_request');
    else
      update public.rota_weeks set status=(payload->>'status')::public.rota_week_status,
        published_at=case when payload->>'status'='published' then clock_timestamp() else published_at end,
        published_by_membership_id=case when payload->>'status'='published' then actor_membership else published_by_membership_id end,
        archived_at=case when payload->>'status'='archived' then clock_timestamp() else archived_at end,
        archived_by_membership_id=case when payload->>'status'='archived' then actor_membership else archived_by_membership_id end,
        updated_by_membership_id=actor_membership,revision=revision+1 where id=week.id returning * into week;
      insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,event_type,actor_membership_id,revision,safe_metadata)
        values(target_organisation_id,target_site_id,week.id,'week_status_changed',actor_membership,week.revision,jsonb_build_object('status',week.status));
      result:=jsonb_build_object('outcome','success','code','week_status_changed','weekId',week.id,'revision',week.revision);
    end if;
  elsif command_name='copy_previous_week' then
    target_date:=private.commercial_iso_date(payload->>'weekStart');
    if target_date is null then result:=jsonb_build_object('outcome','invalid_request','code','week_start'); return private.commercial_receipt_complete(target_organisation_id,idempotency_key,result); end if;
    select * into source_week from public.rota_weeks where organisation_id=target_organisation_id and site_id=target_site_id and week_start_date=target_date-7 and status<>'archived';
    if not found then result:=jsonb_build_object('outcome','not_found');
    else
      select * into week from public.rota_weeks current_week where current_week.organisation_id=target_organisation_id and current_week.site_id=target_site_id
        and current_week.week_start_date=target_date and current_week.status<>'archived' for update;
      if found and week.status<>'draft' then
        result:=jsonb_build_object('outcome','conflict','code','target_week_not_draft');
      elsif not found then
        insert into public.rota_weeks(organisation_id,site_id,week_start_date,status,title,created_by,updated_by,created_by_membership_id,updated_by_membership_id)
          values(target_organisation_id,target_site_id,target_date,'draft','Copied from previous week',null,null,actor_membership,actor_membership) returning * into week;
        new_week_created:=true;
      end if;
      if result is not null then return private.commercial_receipt_complete(target_organisation_id,idempotency_key,result); end if;
      for shift in select * from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=source_week.id and s.archived_at is null and s.status<>'cancelled' loop
        perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||shift.staff_id||':'||(shift.shift_date+7)::text,0));
        validation:=private.validate_commercial_rota_shift(target_organisation_id,target_site_id,shift.staff_id,shift.shift_date+7,shift.start_time,shift.end_time,shift.work_area_id,null);
        if not (validation->>'ok')::boolean then result:=jsonb_build_object('outcome','conflict','code',validation->>'code'); exit; end if;
      end loop;
      if result is not null and new_week_created then delete from public.rota_weeks where id=week.id; end if;
      if result is null then
        insert into public.rota_shifts(organisation_id,site_id,rota_week_id,staff_id,shift_date,start_time,end_time,break_minutes,break_unspecified,work_area_id,work_area,room_or_area,role_on_shift,notes,status,created_by,updated_by,created_by_membership_id,updated_by_membership_id)
          select target_organisation_id,target_site_id,week.id,s.staff_id,s.shift_date+7,s.start_time,s.end_time,s.break_minutes,s.break_unspecified,s.work_area_id,s.work_area,s.room_or_area,s.role_on_shift,s.notes,'scheduled',null,null,actor_membership,actor_membership
          from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=source_week.id and s.archived_at is null and s.status<>'cancelled'
          on conflict do nothing;
        get diagnostics copied_count=row_count;
        update public.rota_weeks set revision=revision+1,updated_by_membership_id=actor_membership where id=week.id returning * into week;
        insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,event_type,actor_membership_id,revision,safe_metadata)
          values(target_organisation_id,target_site_id,week.id,'week_copied',actor_membership,week.revision,jsonb_build_object('copiedShifts',copied_count));
        result:=jsonb_build_object('outcome','success','code','week_copied','weekId',week.id,'revision',week.revision,'copiedShifts',copied_count);
      end if;
    end if;
  elsif command_name='copy_day' then
    select * into week from public.rota_weeks where organisation_id=target_organisation_id and site_id=target_site_id
      and id=private.commercial_uuid(payload->>'weekId') and status='draft' for update;
    source_date:=private.commercial_iso_date(payload->>'sourceDate');
    target_date:=private.commercial_iso_date(payload->>'targetDate');
    if not found then result:=jsonb_build_object('outcome','not_found');
    elsif expected_revision is null or week.revision<>expected_revision then result:=jsonb_build_object('outcome','workflow_changed','revision',week.revision);
    elsif source_date is null or target_date is null or source_date=target_date or source_date not between week.week_start_date and week.week_start_date+6 or target_date not between week.week_start_date and week.week_start_date+6 then
      result:=jsonb_build_object('outcome','invalid_request','code','week_date_required');
    else
      for shift in select * from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id
        and s.rota_week_id=week.id and s.shift_date=source_date and s.archived_at is null and s.status<>'cancelled'
      loop
        perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||shift.staff_id||':'||target_date::text,0));
        validation:=private.validate_commercial_rota_shift(target_organisation_id,target_site_id,shift.staff_id,target_date,shift.start_time,shift.end_time,shift.work_area_id,null);
        if not (validation->>'ok')::boolean then
          result:=jsonb_build_object('outcome','conflict','code',validation->>'code');
          exit;
        end if;
      end loop;
      if result is null then
        insert into public.rota_shifts(
          organisation_id,site_id,rota_week_id,staff_id,shift_date,start_time,end_time,break_minutes,break_unspecified,
          work_area_id,work_area,room_or_area,role_on_shift,notes,status,created_by_membership_id,updated_by_membership_id
        ) select target_organisation_id,target_site_id,week.id,s.staff_id,target_date,s.start_time,s.end_time,s.break_minutes,s.break_unspecified,
          s.work_area_id,s.work_area,s.room_or_area,s.role_on_shift,s.notes,'scheduled',actor_membership,actor_membership
          from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id
            and s.rota_week_id=week.id and s.shift_date=source_date and s.archived_at is null and s.status<>'cancelled'
          on conflict do nothing;
        get diagnostics copied_count=row_count;
        update public.rota_weeks set revision=revision+1,updated_by_membership_id=actor_membership where id=week.id returning * into week;
        insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,event_type,actor_membership_id,revision,safe_metadata)
          values(target_organisation_id,target_site_id,week.id,'day_copied',actor_membership,week.revision,jsonb_build_object('sourceDate',source_date,'targetDate',target_date,'copiedShifts',copied_count));
        result:=jsonb_build_object('outcome','success','code','day_copied','weekId',week.id,'revision',week.revision,'copiedShifts',copied_count);
      end if;
    end if;
  elsif command_name='save_week_as_template' then
    select * into week from public.rota_weeks where organisation_id=target_organisation_id and site_id=target_site_id and id=private.commercial_uuid(payload->>'weekId');
    if not found then result:=jsonb_build_object('outcome','not_found');
    elsif nullif(btrim(payload->>'name'),'') is null then result:=jsonb_build_object('outcome','invalid_request','code','template_name_required');
    else
      insert into public.rota_templates(organisation_id,site_id,name,description,status,source_type,created_by_membership_id,updated_by_membership_id)
        values(target_organisation_id,target_site_id,btrim(payload->>'name'),nullif(btrim(payload->>'description'),''),'active','saved_from_rota',actor_membership,actor_membership)
        returning * into template;
      insert into public.rota_template_shifts(
        organisation_id,site_id,template_id,staff_id,day_of_week,start_time,end_time,break_minutes,break_unspecified,work_area_id,room_or_area,role_on_shift,notes,sort_order,
        created_by_membership_id,updated_by_membership_id
      ) select target_organisation_id,target_site_id,template.id,s.staff_id,extract(isodow from s.shift_date)::smallint,s.start_time,s.end_time,s.break_minutes,s.break_unspecified,
        s.work_area_id,s.work_area,s.role_on_shift,s.notes,row_number() over(order by s.shift_date,s.start_time,s.staff_id)::integer,actor_membership,actor_membership
        from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=week.id
          and s.archived_at is null and s.status<>'cancelled';
      get diagnostics copied_count=row_count;
      insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,event_type,actor_membership_id,revision,safe_metadata)
        values(target_organisation_id,target_site_id,week.id,'template_saved',actor_membership,week.revision,jsonb_build_object('templateId',template.id,'shiftCount',copied_count));
      result:=jsonb_build_object('outcome','success','code','template_saved','weekId',week.id,'templateId',template.id,'revision',template.revision,'copiedShifts',copied_count);
    end if;
  elsif command_name='apply_template' then
    select * into week from public.rota_weeks where organisation_id=target_organisation_id and site_id=target_site_id
      and id=private.commercial_uuid(payload->>'weekId') and status='draft' for update;
    select * into template from public.rota_templates where organisation_id=target_organisation_id and site_id=target_site_id
      and id=private.commercial_uuid(payload->>'templateId') and status='active';
    if week.id is null or template.id is null then result:=jsonb_build_object('outcome','not_found');
    elsif expected_revision is null or week.revision<>expected_revision then result:=jsonb_build_object('outcome','workflow_changed','revision',week.revision);
    elsif payload->>'mode' not in ('empty_days','replace','alongside') then result:=jsonb_build_object('outcome','invalid_request','code','template_mode');
    else
      apply_mode:=(payload->>'mode')::public.rota_template_apply_mode;
      for template_shift in select * from public.rota_template_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id
        and s.template_id=template.id and s.archived_at is null order by s.day_of_week,s.sort_order,s.id
      loop
        target_date:=week.week_start_date+(template_shift.day_of_week-1);
        if apply_mode='empty_days' and exists(select 1 from public.rota_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.rota_week_id=week.id and s.shift_date=target_date and s.archived_at is null and s.status<>'cancelled') then
          skipped_count:=skipped_count+1;
        else
          perform pg_advisory_xact_lock(hashtextextended(target_organisation_id::text||':'||template_shift.staff_id||':'||target_date::text,0));
          validation:=private.validate_commercial_rota_shift(target_organisation_id,target_site_id,template_shift.staff_id,target_date,template_shift.start_time,template_shift.end_time,template_shift.work_area_id,null,case when apply_mode='replace' then week.id else null end);
          if not (validation->>'ok')::boolean and not (
            validation->>'code'='approved_leave_conflict' and nullif(btrim(payload->>'leaveOverrideReason'),'') is not null
            or validation->>'code' in ('shift_overlap','cross_site_overlap') and nullif(btrim(payload->>'overlapOverrideReason'),'') is not null
          ) then result:=jsonb_build_object('outcome','conflict','code',validation->>'code'); exit; end if;
        end if;
      end loop;
      if result is null then
        if apply_mode='replace' then
          update public.rota_shifts set archived_at=clock_timestamp(),archived_by_membership_id=actor_membership,updated_by_membership_id=actor_membership,revision=revision+1
            where organisation_id=target_organisation_id and site_id=target_site_id and rota_week_id=week.id and archived_at is null;
        end if;
        insert into public.rota_template_applications(organisation_id,site_id,request_key,template_id,rota_week_id,apply_mode,applied_by_membership_id)
          values(target_organisation_id,target_site_id,idempotency_key,template.id,week.id,apply_mode,actor_membership) returning id into application_id;
        insert into public.rota_shifts(
          organisation_id,site_id,rota_week_id,staff_id,shift_date,start_time,end_time,break_minutes,break_unspecified,work_area_id,work_area,room_or_area,role_on_shift,notes,status,
          source_template_shift_id,template_application_id,leave_override_reason,overlap_override_reason,created_by_membership_id,updated_by_membership_id
        ) select target_organisation_id,target_site_id,week.id,s.staff_id,week.week_start_date+(s.day_of_week-1),s.start_time,s.end_time,s.break_minutes,s.break_unspecified,
          s.work_area_id,s.room_or_area,s.room_or_area,s.role_on_shift,s.notes,'scheduled',s.id,application_id,
          nullif(btrim(payload->>'leaveOverrideReason'),''),nullif(btrim(payload->>'overlapOverrideReason'),''),actor_membership,actor_membership
          from public.rota_template_shifts s where s.organisation_id=target_organisation_id and s.site_id=target_site_id and s.template_id=template.id and s.archived_at is null
            and not (apply_mode='empty_days' and exists(select 1 from public.rota_shifts current_shift where current_shift.organisation_id=target_organisation_id and current_shift.site_id=target_site_id and current_shift.rota_week_id=week.id and current_shift.shift_date=week.week_start_date+(s.day_of_week-1) and current_shift.archived_at is null and current_shift.status<>'cancelled'))
          on conflict do nothing;
        get diagnostics copied_count=row_count;
        update public.rota_template_applications set created_shifts=copied_count,skipped_shifts=skipped_count where id=application_id;
        update public.rota_weeks set revision=revision+1,updated_by_membership_id=actor_membership where id=week.id returning * into week;
        insert into public.commercial_rota_events(organisation_id,site_id,rota_week_id,event_type,actor_membership_id,revision,safe_metadata)
          values(target_organisation_id,target_site_id,week.id,'template_applied',actor_membership,week.revision,jsonb_build_object('templateId',template.id,'createdShifts',copied_count,'skippedShifts',skipped_count));
        result:=jsonb_build_object('outcome','success','code','template_applied','weekId',week.id,'revision',week.revision,'copiedShifts',copied_count,'skippedShifts',skipped_count);
      end if;
    end if;
  else result:=jsonb_build_object('outcome','invalid_request','code','unknown_command');
  end if;
  return private.commercial_receipt_complete(target_organisation_id,idempotency_key,result);
exception when unique_violation then
  result:=jsonb_build_object('outcome','conflict','code','duplicate');
  return private.commercial_receipt_complete(target_organisation_id,idempotency_key,result);
end
$$;

create or replace function public.execute_commercial_leave_command(
  target_organisation_id uuid,
  command_name text,
  payload jsonb,
  idempotency_key uuid,
  expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_membership uuid; actor_staff text; replay jsonb; result jsonb; request public.leave_requests; target_staff text; affected integer;
begin
  actor_membership:=private.current_membership_id(target_organisation_id);
  if actor_membership is null then return jsonb_build_object('outcome','permission_denied'); end if;
  select membership.staff_id into actor_staff from public.organisation_memberships membership where membership.organisation_id=target_organisation_id and membership.id=actor_membership and membership.status='active';
  replay:=private.commercial_receipt_begin(target_organisation_id,idempotency_key,'leave',command_name,payload,actor_membership);
  if replay is not null then return replay; end if;
  if command_name='create_leave' then
    target_staff:=coalesce(nullif(payload->>'staffId',''),actor_staff);
    if private.commercial_iso_date(payload->>'startDate') is null or private.commercial_iso_date(payload->>'endDate') is null
      or private.commercial_iso_date(payload->>'startDate')>private.commercial_iso_date(payload->>'endDate') then result:=jsonb_build_object('outcome','invalid_request','code','leave_dates');
    elsif payload->>'leaveType' not in ('annual_leave','sickness','medical_appointment','unpaid_leave','training','other')
      or coalesce(payload->>'dayPart','full_day') not in ('full_day','partial_day') then result:=jsonb_build_object('outcome','invalid_request','code','leave_type');
    elsif private.commercial_nonnegative_integer(payload->>'requestedMinutes') is null or private.commercial_nonnegative_integer(payload->>'requestedMinutes')=0 then result:=jsonb_build_object('outcome','invalid_request','code','requested_minutes');
    elsif payload ? 'sourceSiteId' and nullif(payload->>'sourceSiteId','') is not null and not exists(select 1 from public.organisation_sites site where site.organisation_id=target_organisation_id and site.id=private.commercial_uuid(payload->>'sourceSiteId')) then result:=jsonb_build_object('outcome','invalid_request','code','source_site');
    elsif coalesce(payload->>'dayPart','full_day')='partial_day' and (private.commercial_local_time(payload->>'startTime') is null or private.commercial_local_time(payload->>'endTime') is null or private.commercial_local_time(payload->>'startTime')>=private.commercial_local_time(payload->>'endTime')) then result:=jsonb_build_object('outcome','invalid_request','code','leave_times');
    elsif target_staff is null or not (target_staff=actor_staff or private.can_access_staff(target_organisation_id,target_staff,'leave.manage')) then result:=jsonb_build_object('outcome','permission_denied');
    elsif exists(select 1 from public.leave_requests existing where existing.organisation_id=target_organisation_id and existing.staff_id=target_staff and existing.status in ('pending','approved') and existing.start_date<=private.commercial_iso_date(payload->>'endDate') and existing.end_date>=private.commercial_iso_date(payload->>'startDate')) then result:=jsonb_build_object('outcome','conflict','code','leave_overlap');
    else
      insert into public.leave_requests(
        organisation_id,source_site_id,staff_id,leave_type,start_date,end_date,day_part,start_time,end_time,requested_minutes,staff_note,status,requested_by_membership_id
      ) values (
        target_organisation_id,private.commercial_uuid(nullif(payload->>'sourceSiteId','')),target_staff,(payload->>'leaveType')::public.leave_type,private.commercial_iso_date(payload->>'startDate'),private.commercial_iso_date(payload->>'endDate'),
        coalesce((payload->>'dayPart')::public.leave_day_part,'full_day'),private.commercial_local_time(nullif(payload->>'startTime','')),private.commercial_local_time(nullif(payload->>'endTime','')),
        private.commercial_nonnegative_integer(payload->>'requestedMinutes'),nullif(btrim(payload->>'staffNote'),''),'pending',actor_membership
      ) returning * into request;
      insert into public.commercial_leave_events(organisation_id,leave_request_id,event_type,actor_membership_id,revision,safe_metadata)
        values(target_organisation_id,request.id,'leave_requested',actor_membership,request.revision,jsonb_build_object('staffId',request.staff_id,'startDate',request.start_date,'endDate',request.end_date));
      result:=jsonb_build_object('outcome','success','code','leave_created','leaveRequestId',request.id,'revision',request.revision);
    end if;
  elsif command_name='cancel_leave' then
    select * into request from public.leave_requests where organisation_id=target_organisation_id and id=private.commercial_uuid(payload->>'leaveRequestId') for update;
    if not found then result:=jsonb_build_object('outcome','not_found');
    elsif request.staff_id<>actor_staff and not private.can_access_staff(target_organisation_id,request.staff_id,'leave.manage') then result:=jsonb_build_object('outcome','permission_denied');
    elsif request.status<>'pending' then result:=jsonb_build_object('outcome','conflict','code','not_pending');
    elsif expected_revision is null or request.revision<>expected_revision then result:=jsonb_build_object('outcome','workflow_changed','revision',request.revision);
    else
      update public.leave_requests set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by_membership_id=actor_membership,revision=revision+1 where id=request.id returning * into request;
      insert into public.commercial_leave_events(organisation_id,leave_request_id,event_type,actor_membership_id,revision)
        values(target_organisation_id,request.id,'leave_cancelled',actor_membership,request.revision);
      result:=jsonb_build_object('outcome','success','code','leave_cancelled','leaveRequestId',request.id,'revision',request.revision);
    end if;
  elsif command_name='review_leave' then
    select * into request from public.leave_requests where organisation_id=target_organisation_id and id=private.commercial_uuid(payload->>'leaveRequestId') for update;
    if not found then result:=jsonb_build_object('outcome','not_found');
    elsif coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then result:=jsonb_build_object('outcome','mfa_required');
    elsif not (
      private.has_permission(target_organisation_id,'leave.manage')
      or (
        exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id and assignment.staff_id=request.staff_id and assignment.effective_from<=request.end_date and (assignment.effective_to is null or assignment.effective_to>=request.start_date))
        and not exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id and assignment.staff_id=request.staff_id and assignment.effective_from<=request.end_date and (assignment.effective_to is null or assignment.effective_to>=request.start_date) and not private.has_site_permission(target_organisation_id,assignment.site_id,'leave.manage'))
      )
    ) then result:=jsonb_build_object('outcome','permission_denied');
    elsif request.status<>'pending' then result:=jsonb_build_object('outcome','conflict','code','already_reviewed');
    elsif expected_revision is null or request.revision<>expected_revision then result:=jsonb_build_object('outcome','workflow_changed','revision',request.revision);
    elsif payload->>'status' not in ('approved','rejected') then result:=jsonb_build_object('outcome','invalid_request');
    else
      update public.leave_requests set status=(payload->>'status')::public.leave_status,manager_note=nullif(btrim(payload->>'managerNote'),''),
        reviewed_at=clock_timestamp(),reviewed_by_membership_id=actor_membership,revision=revision+1 where id=request.id returning * into request;
      select count(*) into affected from public.rota_shifts shift where shift.organisation_id=target_organisation_id and shift.staff_id=request.staff_id
        and shift.shift_date between request.start_date and request.end_date and shift.archived_at is null and shift.status<>'cancelled';
      insert into public.commercial_leave_events(organisation_id,leave_request_id,event_type,actor_membership_id,revision,safe_metadata)
        values(target_organisation_id,request.id,'leave_'||request.status::text,actor_membership,request.revision,jsonb_build_object('affectedShiftCount',affected));
      result:=jsonb_build_object('outcome','success','code','leave_'||request.status::text,'leaveRequestId',request.id,'revision',request.revision,'affectedShiftCount',affected);
    end if;
  else result:=jsonb_build_object('outcome','invalid_request','code','unknown_command'); end if;
  return private.commercial_receipt_complete(target_organisation_id,idempotency_key,result);
end
$$;

create or replace function public.get_commercial_planned_shifts(
  target_organisation_id uuid,
  target_site_id uuid,
  range_start date,
  range_end date,
  target_staff_id text default null
)
returns table(
  organisation_id uuid, site_id uuid, shift_id uuid, rota_week_id uuid, staff_id text,
  shift_date date, start_time time, end_time time, break_minutes integer, work_area_id uuid, role_on_shift text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (target_site_id is null and not private.has_permission(target_organisation_id,'rota.read'))
    or (target_site_id is not null and not private.has_site_permission(target_organisation_id,target_site_id,'rota.read')) then
    raise exception 'Rota access denied';
  end if;
  return query select shift.organisation_id,shift.site_id,shift.id,shift.rota_week_id,shift.staff_id,
    shift.shift_date,shift.start_time,shift.end_time,shift.break_minutes,shift.work_area_id,shift.role_on_shift
  from public.rota_shifts shift join public.rota_weeks week
    on week.organisation_id=shift.organisation_id and week.site_id=shift.site_id and week.id=shift.rota_week_id
  where shift.organisation_id=target_organisation_id and (target_site_id is null or shift.site_id=target_site_id) and week.status='published'
    and shift.shift_date between range_start and range_end and shift.archived_at is null and shift.status<>'cancelled'
    and (target_staff_id is null or shift.staff_id=target_staff_id)
  order by shift.shift_date,shift.start_time,shift.id;
end
$$;

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
    'staff',coalesce((select jsonb_agg(jsonb_build_object('id',profile.id,'full_name',profile.full_name,'display_name',profile.display_name,'employment_role',profile.employment_role,'active',profile.active) order by profile.full_name) from public.staff_profiles profile where profile.organisation_id=target_organisation_id and profile.active and exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id and assignment.site_id=target_site_id and assignment.staff_id=profile.id and assignment.effective_from<=target_week_start+6 and (assignment.effective_to is null or assignment.effective_to>=target_week_start))),'[]'::jsonb),
    'leave',coalesce((select jsonb_agg(jsonb_build_object('id',request.id,'staff_id',request.staff_id,'start_date',request.start_date,'end_date',request.end_date,'day_part',request.day_part,'start_time',request.start_time,'end_time',request.end_time,'status',request.status))
      from public.leave_requests request where request.organisation_id=target_organisation_id and request.status in ('pending','approved')
        and request.start_date<=target_week_start+6 and request.end_date>=target_week_start
        and exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id
          and assignment.site_id=target_site_id and assignment.staff_id=request.staff_id and assignment.effective_from<=least(request.end_date,target_week_start+6)
          and (assignment.effective_to is null or assignment.effective_to>=greatest(request.start_date,target_week_start)))),'[]'::jsonb),
    'workAreas',coalesce((select jsonb_agg(jsonb_build_object('id',area.id,'name',area.name,'code',area.code) order by area.name) from public.work_areas area where area.organisation_id=target_organisation_id and area.site_id=target_site_id and area.active and area.archived_at is null),'[]'::jsonb),
    'closures',coalesce((select jsonb_agg(jsonb_build_object('id',closure.id,'startsOn',closure.starts_on,'endsOn',closure.ends_on,'label',closure.label)) from public.site_closures closure where closure.organisation_id=target_organisation_id and closure.site_id=target_site_id and closure.archived_at is null and closure.starts_on<=target_week_start+6 and closure.ends_on>=target_week_start),'[]'::jsonb)
    ,'templates',coalesce((select jsonb_agg(
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

create or replace function public.reset_commercial_attendance_to_planned_hours(
  target_organisation_id uuid,target_site_id uuid,target_staff_id text,target_date date,
  reason text,expected_revision text,operation_id uuid,expected_planned_start time,expected_planned_finish time
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  membership_id uuid; existing_request public.attendance_operation_requests%rowtype; week_id uuid;
  planned_start time; planned_finish time; planned_start_at timestamptz; planned_finish_at timestamptz;
  start_matches integer; finish_matches integer; effective_events jsonb; correction_actions jsonb; fingerprint text;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id,target_site_id,'attendance.correct') then
    raise exception 'attendance correction is not authorised';
  end if;
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'AAL2 is required'; end if;
  if operation_id is null or expected_revision is null or expected_planned_start is null or expected_planned_finish is null
    or length(btrim(coalesce(reason,'')))<5 then raise exception 'attendance reset is invalid'; end if;
  if not exists(select 1 from public.staff_profiles profile where profile.organisation_id=target_organisation_id and profile.id=target_staff_id)
    or not exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id
      and assignment.site_id=target_site_id and assignment.staff_id=target_staff_id and assignment.effective_from<=target_date
      and (assignment.effective_to is null or assignment.effective_to>=target_date)) then
    raise exception 'staff is not assigned to the attendance site';
  end if;
  perform private.lock_attendance_stream(target_organisation_id,target_staff_id);
  fingerprint:=encode(sha256(convert_to(concat_ws('|',target_organisation_id,target_site_id,target_staff_id,target_date,btrim(reason),expected_revision,expected_planned_start,expected_planned_finish),'UTF8')),'hex');
  select * into existing_request from public.attendance_operation_requests request
    where request.organisation_id=target_organisation_id and request.operation_id=reset_commercial_attendance_to_planned_hours.operation_id;
  if found then
    if existing_request.site_id=target_site_id and existing_request.operation_kind='reset' and existing_request.staff_id=target_staff_id
      and existing_request.recorded_date=target_date and existing_request.reason=btrim(reason)
      and existing_request.expected_revision=expected_revision and existing_request.expected_planned_start=expected_planned_start
      and existing_request.expected_planned_finish=expected_planned_finish then return operation_id; end if;
    raise exception 'Operation ID is already used for a different attendance operation';
  end if;
  if private.commercial_attendance_revision(target_organisation_id,target_site_id,target_staff_id,target_date)<>expected_revision then
    raise exception using errcode='40001',message='Attendance changed after this preview';
  end if;
  select week.id into week_id from public.rota_weeks week where week.organisation_id=target_organisation_id and week.site_id=target_site_id
    and target_date between week.week_start_date and week.week_start_date+6 and week.status='published' order by week.week_start_date desc limit 1 for update;
  if week_id is null then raise exception 'No published rota shift exists for this staff date'; end if;
  perform 1 from public.rota_shifts shift where shift.organisation_id=target_organisation_id and shift.site_id=target_site_id
    and shift.rota_week_id=week_id and shift.staff_id=target_staff_id and shift.shift_date=target_date
    and shift.archived_at is null and shift.status<>'cancelled' for update;
  select min(shift.start_time),max(shift.end_time) into planned_start,planned_finish from public.rota_shifts shift
    where shift.organisation_id=target_organisation_id and shift.site_id=target_site_id and shift.rota_week_id=week_id
      and shift.staff_id=target_staff_id and shift.shift_date=target_date and shift.archived_at is null and shift.status<>'cancelled';
  if planned_start is null or planned_finish is null then raise exception 'No published rota shift exists for this staff date'; end if;
  if planned_start is distinct from expected_planned_start or planned_finish is distinct from expected_planned_finish then
    raise exception using errcode='40001',message='Published planned hours changed after this preview';
  end if;
  planned_start_at:=(target_date+planned_start)::timestamp at time zone 'Europe/London';
  planned_finish_at:=(target_date+planned_finish)::timestamp at time zone 'Europe/London';
  select count(*) into start_matches from (values(planned_start_at-interval '1 hour'),(planned_start_at),(planned_start_at+interval '1 hour')) candidate(value)
    where value at time zone 'Europe/London'=(target_date+planned_start)::timestamp;
  select count(*) into finish_matches from (values(planned_finish_at-interval '1 hour'),(planned_finish_at),(planned_finish_at+interval '1 hour')) candidate(value)
    where value at time zone 'Europe/London'=(target_date+planned_finish)::timestamp;
  if start_matches<>1 or finish_matches<>1 then raise exception 'A published rota boundary is affected by a UK clock change'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',gen_random_uuid(),'correction_kind','exclude',
    'original_event_id',case when event.correction_id is null then event.event_id else event.original_event_id end,
    'supersedes_correction_id',event.correction_id,'event_type',null,'event_timestamp',null
  ) order by event.event_timestamp,event.event_order_key,event.event_id),'[]'::jsonb) into effective_events
    from private.get_commercial_effective_clock_events(target_organisation_id,target_site_id,target_date,target_date,target_staff_id) event;
  correction_actions:=effective_events||jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'correction_kind','add','original_event_id',null,'supersedes_correction_id',null,'event_type','clock_in','event_timestamp',planned_start_at),
    jsonb_build_object('id',gen_random_uuid(),'correction_kind','add','original_event_id',null,'supersedes_correction_id',null,'event_type','clock_out','event_timestamp',planned_finish_at)
  );
  membership_id:=private.current_membership_id(target_organisation_id);
  insert into public.attendance_operation_requests(
    organisation_id,site_id,operation_id,operation_kind,staff_id,recorded_date,target_event_id,reason,expected_revision,
    expected_planned_start,expected_planned_finish,created_by_membership_id
  ) values(target_organisation_id,target_site_id,operation_id,'reset',target_staff_id,target_date,null,btrim(reason),expected_revision,
    expected_planned_start,expected_planned_finish,membership_id);
  insert into public.clock_event_corrections(
    id,batch_id,correction_role,organisation_id,site_id,staff_id,correction_kind,original_event_id,supersedes_correction_id,
    event_type,event_timestamp,recorded_date,reason,created_by,created_by_membership_id,expected_revision,request_fingerprint
  ) select (action.item->>'id')::uuid,operation_id,case when action.ordinal=1 then 'primary' else 'consequential' end,
    target_organisation_id,target_site_id,target_staff_id,action.item->>'correction_kind',nullif(action.item->>'original_event_id','')::uuid,
    nullif(action.item->>'supersedes_correction_id','')::uuid,action.item->>'event_type',nullif(action.item->>'event_timestamp','')::timestamptz,
    target_date,btrim(reason),null,membership_id,expected_revision,fingerprint
    from jsonb_array_elements(correction_actions) with ordinality action(item,ordinal) order by action.ordinal;
  return operation_id;
end$$;

create or replace function public.use_commercial_planned_hours(
  target_organisation_id uuid,target_site_id uuid,target_staff_id text,target_date date,reason text,expected_revision text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  membership_id uuid; batch_id uuid:=gen_random_uuid(); planned_start time; planned_finish time;
  planned_start_at timestamptz; planned_finish_at timestamptz; event_count integer; left_count integer; middle_count integer; right_count integer;
  effective_events jsonb; actions jsonb:='[]'::jsonb; boundary record; middle record;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id,target_site_id,'attendance.correct') then raise exception 'attendance correction is not authorised'; end if;
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'AAL2 is required'; end if;
  if expected_revision is null or length(btrim(coalesce(reason,'')))<5 then raise exception 'planned-hours correction is invalid'; end if;
  perform private.lock_attendance_stream(target_organisation_id,target_staff_id);
  if private.commercial_attendance_revision(target_organisation_id,target_site_id,target_staff_id,target_date)<>expected_revision then
    raise exception using errcode='40001',message='Attendance changed after this preview';
  end if;
  perform 1 from public.rota_shifts shift join public.rota_weeks week on week.organisation_id=shift.organisation_id and week.site_id=shift.site_id and week.id=shift.rota_week_id
    where shift.organisation_id=target_organisation_id and shift.site_id=target_site_id and shift.staff_id=target_staff_id and shift.shift_date=target_date
      and shift.archived_at is null and shift.status<>'cancelled' and week.status='published' for update of shift,week;
  select min(shift.start_time),max(shift.end_time) into planned_start,planned_finish from public.rota_shifts shift
    join public.rota_weeks week on week.organisation_id=shift.organisation_id and week.site_id=shift.site_id and week.id=shift.rota_week_id
    where shift.organisation_id=target_organisation_id and shift.site_id=target_site_id and shift.staff_id=target_staff_id and shift.shift_date=target_date
      and shift.archived_at is null and shift.status<>'cancelled' and week.status='published';
  if planned_start is null or planned_finish is null then raise exception 'No published rota shift exists for this staff date'; end if;
  planned_start_at:=(target_date+planned_start)::timestamp at time zone 'Europe/London';
  planned_finish_at:=(target_date+planned_finish)::timestamp at time zone 'Europe/London';
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',event.event_id,'event_order_key',event.event_order_key,'original_event_id',event.original_event_id,
    'correction_id',event.correction_id,'event_type',event.event_type,'event_timestamp',event.event_timestamp
  ) order by event.event_timestamp,event.event_order_key,event.event_id),'[]'::jsonb) into effective_events
    from private.get_commercial_effective_clock_events(target_organisation_id,target_site_id,target_date,target_date,target_staff_id) event;
  event_count:=jsonb_array_length(effective_events);
  select count(*) filter(where snapshot.event_timestamp<=planned_start_at),count(*) filter(where snapshot.event_timestamp>planned_start_at and snapshot.event_timestamp<planned_finish_at),
    count(*) filter(where snapshot.event_timestamp>=planned_finish_at) into left_count,middle_count,right_count
    from jsonb_to_recordset(effective_events) snapshot(event_id uuid,event_order_key text,original_event_id uuid,correction_id uuid,event_type text,event_timestamp timestamptz);
  if left_count+middle_count+right_count<>event_count then raise exception 'Attendance event snapshot could not be classified safely'; end if;
  if left_count>1 or right_count>1 then raise exception 'Multiple clock events fall outside the planned boundaries'; end if;
  if middle_count%2=1 then raise exception 'An odd number of intermediate clock events requires manual correction'; end if;
  if left_count=0 then actions:=actions||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'correction_kind','add','original_event_id',null,'supersedes_correction_id',null,'event_type','clock_in','event_timestamp',planned_start_at));
  else
    select * into boundary from jsonb_to_recordset(effective_events) snapshot(event_id uuid,event_order_key text,original_event_id uuid,correction_id uuid,event_type text,event_timestamp timestamptz) where snapshot.event_timestamp<=planned_start_at;
    if boundary.event_type<>'clock_in' or boundary.event_timestamp<>planned_start_at then actions:=actions||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'correction_kind','replace','original_event_id',case when boundary.correction_id is null then boundary.event_id else null end,
      'supersedes_correction_id',boundary.correction_id,'event_type','clock_in','event_timestamp',planned_start_at)); end if;
  end if;
  for middle in select snapshot.*,row_number() over(order by snapshot.event_timestamp,snapshot.event_order_key,snapshot.event_id) position
    from jsonb_to_recordset(effective_events) snapshot(event_id uuid,event_order_key text,original_event_id uuid,correction_id uuid,event_type text,event_timestamp timestamptz)
    where snapshot.event_timestamp>planned_start_at and snapshot.event_timestamp<planned_finish_at
  loop
    if middle.event_type<>(case when middle.position::integer%2=1 then 'clock_out' else 'clock_in' end) then
      actions:=actions||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'correction_kind','replace',
        'original_event_id',case when middle.correction_id is null then middle.event_id else null end,'supersedes_correction_id',middle.correction_id,
        'event_type',case when middle.position::integer%2=1 then 'clock_out' else 'clock_in' end,'event_timestamp',middle.event_timestamp));
    end if;
  end loop;
  if right_count=0 then actions:=actions||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'correction_kind','add','original_event_id',null,'supersedes_correction_id',null,'event_type','clock_out','event_timestamp',planned_finish_at));
  else
    select * into boundary from jsonb_to_recordset(effective_events) snapshot(event_id uuid,event_order_key text,original_event_id uuid,correction_id uuid,event_type text,event_timestamp timestamptz) where snapshot.event_timestamp>=planned_finish_at;
    if boundary.event_type<>'clock_out' or boundary.event_timestamp<>planned_finish_at then actions:=actions||jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'correction_kind','replace','original_event_id',case when boundary.correction_id is null then boundary.event_id else null end,
      'supersedes_correction_id',boundary.correction_id,'event_type','clock_out','event_timestamp',planned_finish_at)); end if;
  end if;
  if jsonb_array_length(actions)=0 then return null; end if;
  membership_id:=private.current_membership_id(target_organisation_id);
  insert into public.clock_event_corrections(
    id,batch_id,correction_role,organisation_id,site_id,staff_id,correction_kind,original_event_id,supersedes_correction_id,event_type,event_timestamp,
    recorded_date,reason,created_by,created_by_membership_id,expected_revision,request_fingerprint
  ) select (action.item->>'id')::uuid,batch_id,case when action.ordinal=1 then 'primary' else 'consequential' end,target_organisation_id,target_site_id,target_staff_id,
    action.item->>'correction_kind',nullif(action.item->>'original_event_id','')::uuid,nullif(action.item->>'supersedes_correction_id','')::uuid,
    action.item->>'event_type',(action.item->>'event_timestamp')::timestamptz,target_date,btrim(reason),null,membership_id,expected_revision,
    encode(sha256(convert_to(concat_ws('|',target_organisation_id,target_site_id,target_staff_id,target_date,btrim(reason),expected_revision,batch_id),'UTF8')),'hex')
    from jsonb_array_elements(actions) with ordinality action(item,ordinal) order by action.ordinal;
  return batch_id;
end$$;

create or replace function public.get_commercial_leave_snapshot(target_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_staff text; result jsonb;
begin
  select membership.staff_id into actor_staff from public.organisation_memberships membership where membership.organisation_id=target_organisation_id and membership.auth_user_id=auth.uid() and membership.status='active';
  if actor_staff is null and not private.has_permission(target_organisation_id,'leave.read') and not exists(select 1 from public.organisation_sites site where site.organisation_id=target_organisation_id and private.has_site_permission(target_organisation_id,site.id,'leave.read')) then raise exception 'Leave access denied'; end if;
  select jsonb_build_object(
    'organisationId',target_organisation_id,
    'requests',coalesce(jsonb_agg(to_jsonb(request)-'manager_note' order by request.created_at desc) filter(where request.id is not null),'[]'::jsonb)
  ) into result from public.leave_requests request where request.organisation_id=target_organisation_id and (
    request.staff_id=actor_staff or private.has_permission(target_organisation_id,'leave.read')
    or exists(select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id and assignment.staff_id=request.staff_id and private.has_site_permission(target_organisation_id,assignment.site_id,'leave.read'))
  );
  return result;
end
$$;

-- Replace inherited global policies with explicit Jan compatibility and commercial read policies.
drop policy if exists "Managers can manage rota settings" on public.rota_settings;
drop policy if exists "Managers can manage rota weeks" on public.rota_weeks;
drop policy if exists "Staff can read published rota weeks" on public.rota_weeks;
drop policy if exists "Managers can manage rota shifts" on public.rota_shifts;
drop policy if exists "Staff can read own published shifts" on public.rota_shifts;
drop policy if exists "Managers can manage rota templates" on public.rota_templates;
drop policy if exists "Managers can manage rota template shifts" on public.rota_template_shifts;
drop policy if exists "Managers can read rota template applications" on public.rota_template_applications;
drop policy if exists "Managers can read all leave" on public.leave_requests;
drop policy if exists "Staff can read own leave" on public.leave_requests;
drop policy if exists "Staff can create own leave" on public.leave_requests;
drop policy if exists "Managers can create leave" on public.leave_requests;
drop policy if exists "Staff can cancel own pending leave" on public.leave_requests;
drop policy if exists "Managers can review leave" on public.leave_requests;

create policy rota_settings_legacy_manage on public.rota_settings for all to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role()='manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role()='manager');
create policy rota_weeks_legacy_manage on public.rota_weeks for all to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role()='manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role()='manager');
create policy rota_weeks_legacy_staff_read on public.rota_weeks for select to authenticated
  using (organisation_id is null and site_id is null and status='published' and public.current_staff_role()='staff');
create policy rota_weeks_commercial_read on public.rota_weeks for select to authenticated
  using (organisation_id is not null and site_id is not null and private.has_site_permission(organisation_id,site_id,'rota.read'));
create policy rota_shifts_legacy_manage on public.rota_shifts for all to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role()='manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role()='manager');
create policy rota_shifts_legacy_staff_read on public.rota_shifts for select to authenticated
  using (organisation_id is null and site_id is null and staff_id=(public.current_staff_account()).staff_id and archived_at is null and exists(select 1 from public.rota_weeks week where week.id=rota_week_id and week.status='published'));
create policy rota_shifts_commercial_read on public.rota_shifts for select to authenticated
  using (organisation_id is not null and site_id is not null and (private.has_site_permission(organisation_id,site_id,'rota.read') or (private.is_linked_staff(organisation_id,staff_id) and exists(select 1 from public.rota_weeks week where week.id=rota_week_id and week.status='published'))));
create policy rota_templates_legacy_manage on public.rota_templates for all to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role()='manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role()='manager');
create policy rota_templates_commercial_read on public.rota_templates for select to authenticated
  using (organisation_id is not null and site_id is not null and private.has_site_permission(organisation_id,site_id,'rota.read'));
create policy rota_template_shifts_legacy_manage on public.rota_template_shifts for all to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role()='manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role()='manager');
create policy rota_template_shifts_commercial_read on public.rota_template_shifts for select to authenticated
  using (organisation_id is not null and site_id is not null and private.has_site_permission(organisation_id,site_id,'rota.read'));
create policy rota_template_applications_legacy_read on public.rota_template_applications for select to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role()='manager');
create policy rota_template_applications_commercial_read on public.rota_template_applications for select to authenticated
  using (organisation_id is not null and site_id is not null and private.has_site_permission(organisation_id,site_id,'rota.read'));
create policy leave_requests_legacy_manage on public.leave_requests for all to authenticated
  using (organisation_id is null and public.current_staff_role()='manager')
  with check (organisation_id is null and public.current_staff_role()='manager');
create policy leave_requests_legacy_self_read on public.leave_requests for select to authenticated
  using (organisation_id is null and staff_id=(public.current_staff_account()).staff_id);
create policy leave_requests_legacy_self_create on public.leave_requests for insert to authenticated
  with check (organisation_id is null and staff_id=(public.current_staff_account()).staff_id and status='pending');
create policy leave_requests_legacy_self_cancel on public.leave_requests for update to authenticated
  using (organisation_id is null and staff_id=(public.current_staff_account()).staff_id and status='pending')
  with check (organisation_id is null and staff_id=(public.current_staff_account()).staff_id and status='cancelled');
create policy leave_requests_commercial_read on public.leave_requests for select to authenticated
  using (organisation_id is not null and (private.is_linked_staff(organisation_id,staff_id) or private.can_access_staff(organisation_id,staff_id,'leave.read')));

revoke all on function private.prevent_commercial_rota_reparenting(), private.prevent_commercial_leave_reparenting(),
  private.reject_commercial_audit_mutation(), private.commercial_iso_date(text), private.commercial_local_time(text), private.commercial_uuid(text), private.commercial_nonnegative_integer(text), private.validate_commercial_rota_shift(uuid,uuid,text,date,time,time,uuid,uuid,uuid),
  private.commercial_receipt_begin(uuid,uuid,text,text,jsonb,uuid), private.commercial_receipt_complete(uuid,uuid,jsonb)
from public, anon, authenticated;

revoke all on function public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint) from public, anon, authenticated;
grant execute on function public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint) to authenticated;
revoke all on function public.execute_commercial_leave_command(uuid,text,jsonb,uuid,bigint) from public, anon, authenticated;
grant execute on function public.execute_commercial_leave_command(uuid,text,jsonb,uuid,bigint) to authenticated;
revoke all on function public.get_commercial_planned_shifts(uuid,uuid,date,date,text) from public, anon, authenticated;
grant execute on function public.get_commercial_planned_shifts(uuid,uuid,date,date,text) to authenticated;
revoke all on function public.get_commercial_rota_snapshot(uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.get_commercial_rota_snapshot(uuid,uuid,date) to authenticated;
revoke all on function public.get_commercial_leave_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_commercial_leave_snapshot(uuid) to authenticated;
revoke all on function public.reset_commercial_attendance_to_planned_hours(uuid,uuid,text,date,text,text,uuid,time,time) from public, anon, authenticated;
grant execute on function public.reset_commercial_attendance_to_planned_hours(uuid,uuid,text,date,text,text,uuid,time,time) to authenticated;
revoke all on function public.use_commercial_planned_hours(uuid,uuid,text,date,text,text) from public, anon, authenticated;
grant execute on function public.use_commercial_planned_hours(uuid,uuid,text,date,text,text) to authenticated;
