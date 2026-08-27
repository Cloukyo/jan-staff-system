-- Commercial Workstream 5: attendance tenancy.
-- Existing Jan attendance stays wholly unowned until the separately approved Jan migration.

alter table public.kiosk_devices
  add column organisation_id uuid,
  add column site_id uuid,
  add column activated_by_membership_id uuid,
  add column revoked_by_membership_id uuid;

alter table public.clock_events add column organisation_id uuid, add column site_id uuid, add column kiosk_device_uuid uuid;
alter table public.clock_event_corrections
  add column organisation_id uuid, add column site_id uuid, add column created_by_membership_id uuid,
  add column requested_target_event_id uuid, add column expected_revision text, add column request_fingerprint text;
alter table public.attendance_day_reviews
  add column organisation_id uuid, add column site_id uuid, add column reviewed_by_membership_id uuid;
alter table public.attendance_correction_requests
  add column organisation_id uuid, add column site_id uuid,
  add column resolved_by_membership_id uuid, add column created_by_membership_id uuid;
alter table public.attendance_operation_requests
  add column organisation_id uuid, add column site_id uuid, add column created_by_membership_id uuid;
alter table public.attendance_action_requests add column organisation_id uuid, add column site_id uuid;
alter table public.attendance_exceptions
  add column organisation_id uuid, add column site_id uuid, add column reviewing_membership_id uuid;
alter table public.attendance_exception_operations
  add column organisation_id uuid, add column site_id uuid, add column created_by_membership_id uuid;

alter table public.clock_event_corrections alter column created_by drop not null;
alter table public.attendance_day_reviews alter column reviewed_by drop not null;
alter table public.attendance_exception_operations alter column created_by drop not null;
alter table public.attendance_correction_requests drop constraint if exists correction_request_resolution;
alter table public.attendance_correction_requests add constraint correction_request_resolution check (
  (status = 'pending' and resolved_by is null and resolved_by_membership_id is null and resolved_at is null)
  or (status <> 'pending' and resolved_at is not null
    and ((organisation_id is null and resolved_by is not null and resolved_by_membership_id is null)
      or (organisation_id is not null and resolved_by is null and resolved_by_membership_id is not null)))
) not valid;
alter table public.attendance_exceptions drop constraint if exists attendance_exception_review_details;
alter table public.attendance_exceptions add constraint attendance_exception_review_details check (
  (status = 'open' and reviewing_manager_id is null and reviewing_membership_id is null and review_started_at is null)
  or (status <> 'open' and review_started_at is not null
    and ((organisation_id is null and reviewing_manager_id is not null and reviewing_membership_id is null)
      or (organisation_id is not null and reviewing_manager_id is null and reviewing_membership_id is not null)))
) not valid;

alter table public.kiosk_devices add constraint kiosk_devices_org_id_key unique (organisation_id, id);
alter table public.clock_events add constraint clock_events_org_id_key unique (organisation_id, id);
alter table public.clock_event_corrections add constraint clock_event_corrections_org_id_key unique (organisation_id, id);
alter table public.attendance_day_reviews add constraint attendance_day_reviews_org_id_key unique (organisation_id, id);
alter table public.attendance_correction_requests add constraint attendance_correction_requests_org_id_key unique (organisation_id, id);
alter table public.attendance_operation_requests add constraint attendance_operation_requests_org_operation_key unique (organisation_id, operation_id);
alter table public.attendance_action_requests add constraint attendance_action_requests_org_key unique (organisation_id, idempotency_key);
alter table public.attendance_exceptions add constraint attendance_exceptions_org_id_key unique (organisation_id, id);
alter table public.attendance_exception_operations add constraint attendance_exception_operations_org_operation_key unique (organisation_id, operation_id);
alter table public.kiosk_devices add constraint kiosk_devices_org_site_id_key unique (organisation_id, site_id, id);
alter table public.clock_events add constraint clock_events_org_site_id_key unique (organisation_id, site_id, id);
alter table public.attendance_exceptions add constraint attendance_exceptions_org_site_id_key unique (organisation_id, site_id, id);
alter table public.clock_event_corrections add constraint clock_event_corrections_org_site_id_key unique (organisation_id, site_id, id);

alter table public.attendance_day_reviews drop constraint if exists attendance_day_reviews_staff_id_review_date_key;
create unique index attendance_day_reviews_legacy_day_key on public.attendance_day_reviews (staff_id, review_date)
  where organisation_id is null;
create unique index attendance_day_reviews_commercial_day_key on public.attendance_day_reviews
  (organisation_id, site_id, staff_id, review_date) where organisation_id is not null;

alter table public.kiosk_devices add constraint kiosk_devices_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.kiosk_devices add constraint kiosk_devices_activator_membership_fk
  foreign key (organisation_id, activated_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;
alter table public.kiosk_devices add constraint kiosk_devices_revoker_membership_fk
  foreign key (organisation_id, revoked_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.clock_events add constraint clock_events_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.clock_events add constraint clock_events_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.clock_events add constraint clock_events_org_site_device_fk
  foreign key (organisation_id,site_id,kiosk_device_uuid)
  references public.kiosk_devices(organisation_id,site_id,id) on delete restrict;

alter table public.clock_event_corrections add constraint clock_event_corrections_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.clock_event_corrections add constraint clock_event_corrections_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.clock_event_corrections add constraint clock_event_corrections_org_event_fk
  foreign key (organisation_id, original_event_id) references public.clock_events(organisation_id, id) on delete restrict;
alter table public.clock_event_corrections add constraint clock_event_corrections_org_site_event_fk
  foreign key (organisation_id, site_id, original_event_id) references public.clock_events(organisation_id, site_id, id) on delete restrict;
alter table public.clock_event_corrections add constraint clock_event_corrections_org_supersedes_fk
  foreign key (organisation_id, supersedes_correction_id) references public.clock_event_corrections(organisation_id, id) on delete restrict;
alter table public.clock_event_corrections add constraint clock_event_corrections_site_supersedes_fk
  foreign key (organisation_id, site_id, supersedes_correction_id)
  references public.clock_event_corrections(organisation_id, site_id, id) on delete restrict;
alter table public.clock_event_corrections add constraint clock_event_corrections_creator_membership_fk
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.attendance_day_reviews add constraint attendance_day_reviews_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.attendance_day_reviews add constraint attendance_day_reviews_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.attendance_day_reviews add constraint attendance_day_reviews_reviewer_membership_fk
  foreign key (organisation_id, reviewed_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.attendance_correction_requests add constraint attendance_correction_requests_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.attendance_correction_requests add constraint attendance_correction_requests_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.attendance_correction_requests add constraint attendance_correction_requests_creator_membership_fk
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;
alter table public.attendance_correction_requests add constraint attendance_correction_requests_resolver_membership_fk
  foreign key (organisation_id, resolved_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.attendance_operation_requests add constraint attendance_operation_requests_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.attendance_operation_requests add constraint attendance_operation_requests_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.attendance_operation_requests add constraint attendance_operation_requests_target_event_fk
  foreign key (organisation_id, target_event_id) references public.clock_events(organisation_id, id) on delete restrict;
alter table public.attendance_operation_requests add constraint attendance_operation_requests_site_event_fk
  foreign key (organisation_id, site_id, target_event_id) references public.clock_events(organisation_id, site_id, id) on delete restrict;
alter table public.attendance_operation_requests add constraint attendance_operation_requests_creator_membership_fk
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.attendance_action_requests add constraint attendance_action_requests_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.attendance_action_requests add constraint attendance_action_requests_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.attendance_action_requests add constraint attendance_action_requests_device_fk
  foreign key (organisation_id, kiosk_device_id) references public.kiosk_devices(organisation_id, id) on delete restrict;
alter table public.attendance_action_requests add constraint attendance_action_requests_site_device_fk
  foreign key (organisation_id, site_id, kiosk_device_id) references public.kiosk_devices(organisation_id, site_id, id) on delete restrict;
alter table public.attendance_action_requests add constraint attendance_action_requests_result_event_fk
  foreign key (organisation_id, resulting_event_id) references public.clock_events(organisation_id, id) on delete restrict;
alter table public.attendance_action_requests add constraint attendance_action_requests_site_result_event_fk
  foreign key (organisation_id, site_id, resulting_event_id) references public.clock_events(organisation_id, site_id, id) on delete restrict;

alter table public.attendance_exceptions add constraint attendance_exceptions_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.attendance_exceptions add constraint attendance_exceptions_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.attendance_exceptions add constraint attendance_exceptions_primary_event_fk
  foreign key (organisation_id, primary_event_id) references public.clock_events(organisation_id, id) on delete restrict;
alter table public.attendance_exceptions add constraint attendance_exceptions_site_primary_event_fk
  foreign key (organisation_id, site_id, primary_event_id) references public.clock_events(organisation_id, site_id, id) on delete restrict;
alter table public.attendance_exceptions add constraint attendance_exceptions_reviewer_membership_fk
  foreign key (organisation_id, reviewing_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;
alter table public.attendance_exceptions add constraint attendance_exceptions_site_device_fk
  foreign key (organisation_id,site_id,kiosk_device_id)
  references public.kiosk_devices(organisation_id,site_id,id) on delete restrict;

alter table public.attendance_exception_operations add constraint attendance_exception_operations_exception_fk
  foreign key (organisation_id, exception_id) references public.attendance_exceptions(organisation_id, id) on delete restrict;
alter table public.attendance_exception_operations add constraint attendance_exception_operations_site_exception_fk
  foreign key (organisation_id, site_id, exception_id) references public.attendance_exceptions(organisation_id, site_id, id) on delete restrict;
alter table public.attendance_exception_operations add constraint attendance_exception_operations_org_site_fk
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict;
alter table public.attendance_exception_operations add constraint attendance_exception_operations_creator_membership_fk
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.kiosk_devices add constraint kiosk_devices_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.kiosk_devices add constraint kiosk_devices_commercial_offline_disabled
  check (organisation_id is null or offline_enabled = false) not valid;
alter table public.clock_events add constraint clock_events_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.clock_event_corrections add constraint clock_event_corrections_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.attendance_day_reviews add constraint attendance_day_reviews_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.attendance_correction_requests add constraint attendance_correction_requests_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.attendance_operation_requests add constraint attendance_operation_requests_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.attendance_action_requests add constraint attendance_action_requests_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.attendance_exceptions add constraint attendance_exceptions_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;
alter table public.attendance_exception_operations add constraint attendance_exception_operations_ownership_pair check ((organisation_id is null) = (site_id is null)) not valid;

create index clock_events_org_site_staff_timestamp_idx on public.clock_events (organisation_id, site_id, staff_id, event_timestamp desc) where organisation_id is not null;
create index clock_event_corrections_org_site_staff_date_idx on public.clock_event_corrections (organisation_id, site_id, staff_id, recorded_date, created_at) where organisation_id is not null;
create index attendance_exceptions_org_site_queue_idx on public.attendance_exceptions (organisation_id, site_id, status, operational_date desc) where organisation_id is not null;
create unique index attendance_exceptions_commercial_fingerprint_idx on public.attendance_exceptions
  (organisation_id, site_id, staff_id, operational_date, exception_type, anomaly_fingerprint)
  where organisation_id is not null and status in ('open', 'under_review');
create index attendance_action_requests_org_site_staff_idx on public.attendance_action_requests (organisation_id, site_id, staff_id, created_at desc) where organisation_id is not null;

create or replace function private.enforce_attendance_staff_ownership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_organisation_id uuid;
begin
  select profile.organisation_id into profile_organisation_id
  from public.staff_profiles profile where profile.id = new.staff_id;
  if not found then raise exception 'attendance staff does not exist'; end if;
  if profile_organisation_id is null then
    if new.organisation_id is not null or new.site_id is not null then
      raise exception 'legacy attendance cannot use commercial ownership';
    end if;
  elsif new.organisation_id is null or new.site_id is null then
    raise exception 'commercial attendance requires organisation and occurrence site';
  elsif new.organisation_id <> profile_organisation_id then
    raise exception 'attendance organisation does not match staff ownership';
  end if;
  if tg_op = 'UPDATE' and (new.organisation_id is distinct from old.organisation_id or new.site_id is distinct from old.site_id) then
    raise exception 'attendance organisation and occurrence site are immutable';
  end if;
  return new;
end
$$;

create or replace function private.prevent_attendance_owner_reparenting()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.organisation_id is distinct from old.organisation_id or new.site_id is distinct from old.site_id then
    raise exception 'attendance organisation and occurrence site are immutable';
  end if;
  return new;
end
$$;

create trigger clock_events_tenant_guard before insert or update on public.clock_events for each row execute function private.enforce_attendance_staff_ownership();
create trigger clock_event_corrections_tenant_guard before insert or update on public.clock_event_corrections for each row execute function private.enforce_attendance_staff_ownership();
create trigger attendance_day_reviews_tenant_guard before insert or update on public.attendance_day_reviews for each row execute function private.enforce_attendance_staff_ownership();
create trigger attendance_correction_requests_tenant_guard before insert or update on public.attendance_correction_requests for each row execute function private.enforce_attendance_staff_ownership();
create trigger attendance_operation_requests_tenant_guard before insert or update on public.attendance_operation_requests for each row execute function private.enforce_attendance_staff_ownership();
create trigger attendance_action_requests_tenant_guard before insert or update on public.attendance_action_requests for each row execute function private.enforce_attendance_staff_ownership();
create trigger attendance_exceptions_tenant_guard before insert or update on public.attendance_exceptions for each row execute function private.enforce_attendance_staff_ownership();
create trigger kiosk_devices_owner_immutable before update on public.kiosk_devices for each row execute function private.prevent_attendance_owner_reparenting();
create trigger attendance_exception_operations_owner_immutable before update on public.attendance_exception_operations for each row execute function private.prevent_attendance_owner_reparenting();

create or replace function private.attendance_row_is_readable(target_organisation_id uuid, target_site_id uuid, target_staff_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    private.has_site_permission(target_organisation_id, target_site_id, 'attendance.read')
    or exists (
      select 1 from public.organisation_memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.auth_user_id = auth.uid()
        and membership.status = 'active'
        and membership.staff_id = target_staff_id
    )
  )
$$;

create or replace function private.lock_attendance_stream(target_organisation_id uuid, target_staff_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_organisation_id is null or nullif(btrim(target_staff_id), '') is null then
    raise exception 'attendance organisation and staff are required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('attendance:' || target_organisation_id::text || ':' || target_staff_id, 0));
end
$$;

revoke all on function private.enforce_attendance_staff_ownership() from public, anon, authenticated, service_role;
revoke all on function private.prevent_attendance_owner_reparenting() from public, anon, authenticated, service_role;
revoke all on function private.attendance_row_is_readable(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.lock_attendance_stream(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.attendance_row_is_readable(uuid, uuid, text) to authenticated;

drop policy if exists "Managers can read clock events" on public.clock_events;
drop policy if exists "Staff can read own clock events" on public.clock_events;
drop policy if exists "Managers can add clock corrections" on public.clock_events;
drop policy if exists "Managers can read clock event corrections" on public.clock_event_corrections;
drop policy if exists "Managers can manage attendance reviews" on public.attendance_day_reviews;
drop policy if exists "Managers can read correction requests" on public.attendance_correction_requests;
drop policy if exists "Managers can resolve correction requests" on public.attendance_correction_requests;
drop policy if exists "Staff can read own correction requests" on public.attendance_correction_requests;
drop policy if exists "Staff can create own correction requests" on public.attendance_correction_requests;
drop policy if exists "Managers can read attendance exceptions" on public.attendance_exceptions;

create policy "Commercial attendance events are tenant readable" on public.clock_events for select to authenticated
  using (organisation_id is not null and (select private.attendance_row_is_readable(organisation_id, site_id, staff_id)));
create policy "Legacy clock events remain explicitly readable" on public.clock_events for select to authenticated
  using (organisation_id is null and site_id is null and (public.current_staff_role() = 'manager' or staff_id = public.current_staff_profile_id()));
create policy "Commercial corrections are tenant readable" on public.clock_event_corrections for select to authenticated
  using (organisation_id is not null and (select private.attendance_row_is_readable(organisation_id, site_id, staff_id)));
create policy "Legacy corrections remain manager readable" on public.clock_event_corrections for select to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role() = 'manager');
create policy "Commercial attendance reviews are tenant readable" on public.attendance_day_reviews for select to authenticated
  using (organisation_id is not null and (select private.attendance_row_is_readable(organisation_id, site_id, staff_id)));
create policy "Legacy attendance reviews remain manager manageable" on public.attendance_day_reviews for all to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role() = 'manager');
create policy "Commercial correction requests are tenant readable" on public.attendance_correction_requests for select to authenticated
  using (organisation_id is not null and (select private.attendance_row_is_readable(organisation_id, site_id, staff_id)));
create policy "Legacy correction requests remain manager readable" on public.attendance_correction_requests for select to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role() = 'manager');
create policy "Legacy correction requests remain manager resolvable" on public.attendance_correction_requests for update to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role() = 'manager');
create policy "Legacy correction requests remain self readable" on public.attendance_correction_requests for select to authenticated
  using (organisation_id is null and site_id is null and staff_id = public.current_staff_profile_id());
create policy "Legacy correction requests remain self creatable" on public.attendance_correction_requests for insert to authenticated
  with check (organisation_id is null and site_id is null and staff_id = public.current_staff_profile_id());
create policy "Commercial exceptions are tenant readable" on public.attendance_exceptions for select to authenticated
  using (organisation_id is not null and (select private.attendance_row_is_readable(organisation_id, site_id, staff_id)));
create policy "Legacy exceptions remain manager readable" on public.attendance_exceptions for select to authenticated
  using (organisation_id is null and site_id is null and public.current_staff_role() = 'manager');

revoke insert, update, delete on public.clock_events, public.clock_event_corrections,
  public.attendance_operation_requests,
  public.attendance_action_requests, public.attendance_exceptions,
  public.attendance_exception_operations from authenticated;

create or replace function private.get_commercial_effective_clock_events(
  target_organisation_id uuid, target_site_id uuid, range_start date, range_end date, target_staff_id text default null
)
returns table (
  organisation_id uuid, site_id uuid, event_id uuid, event_order_key text,
  original_event_id uuid, correction_id uuid, staff_id text, event_type text,
  event_timestamp timestamptz, recorded_date date, source text
)
language sql stable security definer set search_path = '' as $$
  with recursive correction_ancestry as (
    select candidate.id leaf_correction_id, candidate.id correction_id,
      candidate.supersedes_correction_id, candidate.original_event_id, 0 depth,
      array[candidate.id] visited
    from public.clock_event_corrections candidate
    where candidate.organisation_id = target_organisation_id
      and candidate.site_id = target_site_id
      and candidate.recorded_date between range_start and range_end
      and (target_staff_id is null or candidate.staff_id = target_staff_id)
      and not exists (
        select 1 from public.clock_event_corrections child
        where child.organisation_id = candidate.organisation_id
          and child.supersedes_correction_id = candidate.id
      )
    union all
    select ancestry.leaf_correction_id, parent.id, parent.supersedes_correction_id,
      parent.original_event_id, ancestry.depth + 1, ancestry.visited || parent.id
    from correction_ancestry ancestry
    join public.clock_event_corrections parent
      on parent.organisation_id = target_organisation_id
      and parent.id = ancestry.supersedes_correction_id
    where not parent.id = any(ancestry.visited)
  ), leaf_context as (
    select ancestry.leaf_correction_id,
      (array_agg(ancestry.original_event_id order by ancestry.depth)
        filter (where ancestry.original_event_id is not null))[1] original_event_id,
      (array_agg(ancestry.correction_id order by ancestry.depth desc))[1] root_correction_id
    from correction_ancestry ancestry group by ancestry.leaf_correction_id
  ), ranked_leaves as (
    select correction.*, context.original_event_id lineage_original_event_id,
      context.root_correction_id,
      row_number() over (
        partition by case when context.original_event_id is not null
          then 'original:' || context.original_event_id::text
          else 'correction:' || context.root_correction_id::text end
        order by correction.created_at desc, correction.id desc
      ) lineage_rank
    from leaf_context context
    join public.clock_event_corrections correction on correction.id = context.leaf_correction_id
  ), active_leaves as (
    select * from ranked_leaves where lineage_rank = 1
  ), effective as (
    select original.organisation_id, original.site_id, original.id event_id,
      original.id::text || ':original' event_order_key,
      null::uuid original_event_id, null::uuid correction_id, original.staff_id,
      original.event_type, original.event_timestamp, original.recorded_date,
      case when original.event_source = 'manager' then 'legacy_manager' else 'kiosk' end source
    from public.clock_events original
    where original.organisation_id = target_organisation_id
      and original.site_id = target_site_id
      and original.recorded_date between range_start and range_end
      and (target_staff_id is null or original.staff_id = target_staff_id)
      and not exists (
        select 1 from active_leaves active
        where active.lineage_original_event_id = original.id
          and active.correction_kind in ('replace', 'exclude')
      )
    union all
    select active.organisation_id, active.site_id, active.id,
      case when active.lineage_original_event_id is not null
        then active.lineage_original_event_id::text || ':original'
        else active.root_correction_id::text || ':correction' end,
      active.lineage_original_event_id, active.id, active.staff_id,
      active.event_type, active.event_timestamp, active.recorded_date, 'manager_correction'
    from active_leaves active where active.correction_kind in ('add', 'replace')
  )
  select * from effective order by event_timestamp, event_order_key, event_id
$$;

create or replace function public.get_commercial_effective_clock_events(
  target_organisation_id uuid, target_site_id uuid, range_start date, range_end date, target_staff_id text default null
)
returns table (
  organisation_id uuid, site_id uuid, event_id uuid, event_order_key text,
  original_event_id uuid, correction_id uuid, staff_id text, event_type text,
  event_timestamp timestamptz, recorded_date date, source text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'attendance.read') then
    if target_staff_id is null or not private.attendance_row_is_readable(target_organisation_id, target_site_id, target_staff_id) then
      raise exception 'attendance access is not authorised';
    end if;
  end if;
  return query select * from private.get_commercial_effective_clock_events(
    target_organisation_id, target_site_id, range_start, range_end, target_staff_id
  );
end
$$;

create or replace function private.commercial_attendance_revision(
  target_organisation_id uuid, target_site_id uuid, target_staff_id text, target_date date
)
returns text language sql stable security definer set search_path = '' as $$
  select 'events:' || coalesce((
    select string_agg(event.id::text, ',' order by event.id) from public.clock_events event
    where event.organisation_id = target_organisation_id and event.site_id = target_site_id
      and event.staff_id = target_staff_id and event.recorded_date = target_date
  ), '') || '|corrections:' || coalesce((
    select string_agg(correction.id::text, ',' order by correction.id) from public.clock_event_corrections correction
    where correction.organisation_id = target_organisation_id and correction.site_id = target_site_id
      and correction.staff_id = target_staff_id and correction.recorded_date = target_date
  ), '')
$$;

create or replace function private.get_commercial_attendance_state(
  target_organisation_id uuid, target_site_id uuid, target_staff_id text, evaluated_at timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  operational_day date := (evaluated_at at time zone 'Europe/London')::date;
  today_events record;
  today_count integer := 0;
  latest_type text;
  first_type text;
  latest_event jsonb;
  prior_type text;
  has_consecutive boolean := false;
  has_stale_open boolean := false;
  derived_state text;
  allowed jsonb;
  revision_value text;
  unresolved jsonb;
  warning_values jsonb := '[]'::jsonb;
begin
  select count(*)::integer,
    (array_agg(event.event_type order by event.event_timestamp desc, event.event_order_key desc))[1],
    (array_agg(jsonb_build_object(
      'organisationId', event.organisation_id, 'siteId', event.site_id,
      'eventId', event.event_id, 'eventOrderKey', event.event_order_key,
      'originalEventId', event.original_event_id, 'correctionId', event.correction_id,
      'staffId', event.staff_id, 'eventType', event.event_type,
      'eventTimestamp', event.event_timestamp, 'source', event.source
    ) order by event.event_timestamp desc, event.event_order_key desc))[1],
    (array_agg(event.event_type order by event.event_timestamp desc, event.event_order_key desc))[2],
    (array_agg(event.event_type order by event.event_timestamp, event.event_order_key))[1]
  into today_count, latest_type, latest_event, prior_type, first_type
  from private.get_commercial_effective_clock_events(
    target_organisation_id, target_site_id, operational_day, operational_day, target_staff_id
  ) event;

  select exists (
    select 1 from (
      select event.recorded_date,
        (array_agg(event.event_type order by event.event_timestamp desc, event.event_order_key desc))[1] last_type
      from private.get_commercial_effective_clock_events(
        target_organisation_id, target_site_id, operational_day - 366, operational_day - 1, target_staff_id
      ) event group by event.recorded_date
    ) day_state where day_state.last_type = 'clock_in'
  ) into has_stale_open;

  select coalesce(bool_or(sequence.event_type=sequence.previous_type),false) into has_consecutive
  from (
    select event.event_type,lag(event.event_type) over (order by event.event_timestamp,event.event_order_key) previous_type
    from private.get_commercial_effective_clock_events(
      target_organisation_id,target_site_id,operational_day,operational_day,target_staff_id
    ) event
  ) sequence;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type',case when sequence.previous_type=sequence.event_type and sequence.event_type='clock_in'
      then 'consecutive_clock_in' else 'unmatched_clock_out' end,
    'operationalDate',operational_day,'eventIds',jsonb_build_array(sequence.event_id)
  ) order by sequence.event_timestamp,sequence.event_order_key),'[]'::jsonb) into warning_values
  from (
    select event.*,lag(event.event_type) over(order by event.event_timestamp,event.event_order_key) previous_type,
      row_number() over(order by event.event_timestamp,event.event_order_key) event_number
    from private.get_commercial_effective_clock_events(
      target_organisation_id,target_site_id,operational_day,operational_day,target_staff_id
    ) event
  ) sequence where sequence.event_type=sequence.previous_type
    or (sequence.event_number=1 and sequence.event_type='clock_out');

  if has_consecutive or (today_count>1 and first_type='clock_out') then
    derived_state := 'awaiting_manager_review'; allowed := '[]'::jsonb;
  elsif latest_type = 'clock_in' then
    derived_state := 'clocked_in'; allowed := '["clock_out"]'::jsonb;
  elsif today_count = 1 and latest_type = 'clock_out' then
    derived_state := 'missing_clock_in'; allowed := '[]'::jsonb;
  elsif has_stale_open then
    derived_state := 'missing_clock_out'; allowed := '["start_new_shift"]'::jsonb;
  else
    derived_state := 'clocked_out'; allowed := '["clock_in"]'::jsonb;
  end if;

  revision_value := private.commercial_attendance_revision(
    target_organisation_id, target_site_id, target_staff_id, operational_day
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', issue.id, 'organisationId', issue.organisation_id, 'siteId', issue.site_id,
    'staffId', issue.staff_id, 'operationalDate', issue.operational_date,
    'type', issue.exception_type, 'status', issue.status
  ) order by issue.operational_date, issue.id), '[]'::jsonb)
  into unresolved from public.attendance_exceptions issue
  where issue.organisation_id = target_organisation_id and issue.site_id = target_site_id
    and issue.staff_id = target_staff_id and issue.status in ('open', 'under_review');

  return jsonb_build_object(
    'organisationId', target_organisation_id, 'siteId', target_site_id,
    'staffId', target_staff_id, 'state', derived_state,
    'operationalDate', operational_day, 'currentEvent', latest_event,
    'unresolvedExceptions', unresolved, 'allowedActions', allowed,
    'warnings', warning_values, 'revision', revision_value, 'evaluatedAt', evaluated_at
  );
end
$$;

create or replace function public.get_commercial_attendance_state(
  target_organisation_id uuid, target_site_id uuid, target_staff_id text, evaluated_at timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.attendance_row_is_readable(target_organisation_id, target_site_id, target_staff_id) then
    raise exception 'attendance access is not authorised';
  end if;
  return private.get_commercial_attendance_state(target_organisation_id, target_site_id, target_staff_id, evaluated_at);
end
$$;

revoke all on function private.get_commercial_effective_clock_events(uuid, uuid, date, date, text) from public, anon, authenticated, service_role;
revoke all on function private.commercial_attendance_revision(uuid, uuid, text, date) from public, anon, authenticated, service_role;
revoke all on function private.get_commercial_attendance_state(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_commercial_effective_clock_events(uuid, uuid, date, date, text) from public, anon;
revoke all on function public.get_commercial_attendance_state(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.get_commercial_effective_clock_events(uuid, uuid, date, date, text) to authenticated;
grant execute on function public.get_commercial_attendance_state(uuid, uuid, text, timestamptz) to authenticated;

create or replace function public.perform_commercial_kiosk_attendance_action(
  device_token text, target_staff_id text, candidate_pin text,
  requested_action text, expected_revision text, idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  device public.kiosk_devices%rowtype;
  settings public.staff_kiosk_settings%rowtype;
  operational_day date := (clock_timestamp() at time zone 'Europe/London')::date;
  state_value jsonb;
  response_value jsonb;
  created_event_id uuid;
  created_event_at timestamptz;
  inserted_request uuid;
  existing_request public.attendance_action_requests%rowtype;
begin
  if device_token is null or length(device_token) < 32 or idempotency_key is null then
    raise exception 'kiosk attendance request is invalid';
  end if;
  if requested_action not in ('clock_in', 'clock_out', 'start_new_shift') then
    raise exception 'kiosk attendance action is invalid';
  end if;

  select registered.* into device from public.kiosk_devices registered
  where registered.token_hash = extensions.digest(device_token, 'sha256')
    and registered.active and registered.expires_at > clock_timestamp();
  if not found or device.organisation_id is null or device.site_id is null then
    raise exception 'commercial kiosk device access required';
  end if;
  update public.kiosk_devices set last_used_at = clock_timestamp() where id = device.id;

  if not exists (
    select 1 from public.staff_profiles profile
    where profile.organisation_id = device.organisation_id and profile.id = target_staff_id and profile.active
  ) then raise exception 'staff member is not available at this organisation'; end if;
  if not exists (
    select 1 from public.staff_site_assignments assignment
    where assignment.organisation_id = device.organisation_id
      and assignment.site_id = device.site_id and assignment.staff_id = target_staff_id
      and assignment.effective_from <= operational_day
      and (assignment.effective_to is null or assignment.effective_to >= operational_day)
  ) then raise exception 'staff member is not eligible at this kiosk site'; end if;

  select kiosk.* into settings from public.staff_kiosk_settings kiosk where kiosk.staff_id = target_staff_id;
  if not found or not settings.kiosk_enabled or settings.pin_hash is null
    or settings.pin_reset_required or extensions.crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    return jsonb_build_object('ok', false, 'code', 'invalid_pin');
  end if;

  perform private.lock_attendance_stream(device.organisation_id, target_staff_id);
  insert into public.attendance_action_requests (
    idempotency_key, organisation_id, site_id, staff_id, kiosk_device_id,
    action, expected_revision, received_at_server
  ) values (
    idempotency_key, device.organisation_id, device.site_id, target_staff_id,
    device.id, requested_action, expected_revision, clock_timestamp()
  ) on conflict on constraint attendance_action_requests_pkey do nothing
    returning attendance_action_requests.idempotency_key into inserted_request;

  if inserted_request is null then
    select request.* into existing_request from public.attendance_action_requests request
    where request.idempotency_key = perform_commercial_kiosk_attendance_action.idempotency_key;
    if existing_request.organisation_id is distinct from device.organisation_id
      or existing_request.site_id is distinct from device.site_id
      or existing_request.kiosk_device_id <> device.id
      or existing_request.staff_id <> target_staff_id
      or existing_request.action <> requested_action
      or existing_request.expected_revision <> expected_revision then
      raise exception 'attendance idempotency key belongs to another request';
    end if;
    if existing_request.completed_at is null then raise exception 'attendance request is still being processed'; end if;
    return existing_request.safe_response;
  end if;

  state_value := private.get_commercial_attendance_state(
    device.organisation_id, device.site_id, target_staff_id, clock_timestamp()
  );
  if state_value ->> 'revision' <> expected_revision then
    response_value := jsonb_build_object('ok', false, 'code', 'state_conflict',
      'state', state_value ->> 'state', 'attendanceState', state_value);
  elsif not (state_value -> 'allowedActions' ? requested_action) then
    response_value := jsonb_build_object('ok', false, 'code', 'invalid_transition',
      'state', state_value ->> 'state', 'attendanceState', state_value);
  else
    if requested_action = 'start_new_shift' then
      insert into public.attendance_exceptions (
        organisation_id, site_id, staff_id, operational_date, exception_type,
        anomaly_fingerprint, detection_revision, source
      )
      select device.organisation_id, device.site_id, target_staff_id, event.recorded_date,
        'missing_clock_out', md5(device.organisation_id::text || ':' || device.site_id::text || ':' || event.event_id::text),
        state_value ->> 'revision', 'kiosk'
      from private.get_commercial_effective_clock_events(
        device.organisation_id, device.site_id, operational_day - 366, operational_day - 1, target_staff_id
      ) event where event.event_type = 'clock_in'
      order by event.recorded_date desc, event.event_timestamp desc limit 1
      on conflict do nothing;
    end if;
    insert into public.clock_events (
      organisation_id, site_id, staff_id, event_type, event_timestamp,
      kiosk_device_id, kiosk_device_uuid, event_source, manager_correction
    ) values (
      device.organisation_id, device.site_id, target_staff_id,
      case when requested_action in ('clock_in', 'start_new_shift') then 'clock_in' else 'clock_out' end,
      clock_timestamp(), device.id::text, device.id, 'kiosk', false
    ) returning id, event_timestamp into created_event_id, created_event_at;
    state_value := private.get_commercial_attendance_state(
      device.organisation_id, device.site_id, target_staff_id, clock_timestamp()
    );
    response_value := jsonb_build_object('ok', true, 'code', 'recorded',
      'state', state_value ->> 'state', 'recordedAt', created_event_at,
      'attendanceState', state_value);
  end if;

  update public.attendance_action_requests set completed_at = clock_timestamp(),
    result_code = response_value ->> 'code', resulting_state = response_value ->> 'state',
    resulting_event_id = created_event_id, safe_response = response_value
  where attendance_action_requests.idempotency_key = perform_commercial_kiosk_attendance_action.idempotency_key;
  return response_value;
end
$$;

create or replace function public.verify_commercial_device_kiosk_pin(
  device_token text, target_staff_id text, candidate_pin text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare device public.kiosk_devices%rowtype; settings public.staff_kiosk_settings%rowtype; state_value jsonb;
begin
  select registered.* into device from public.kiosk_devices registered
  where registered.token_hash = extensions.digest(device_token, 'sha256')
    and registered.active and registered.expires_at > clock_timestamp()
    and registered.organisation_id is not null and registered.site_id is not null;
  if not found then raise exception 'commercial kiosk device access required'; end if;
  if not exists (
    select 1 from public.staff_site_assignments assignment
    where assignment.organisation_id = device.organisation_id and assignment.site_id = device.site_id
      and assignment.staff_id = target_staff_id
      and assignment.effective_from <= (clock_timestamp() at time zone 'Europe/London')::date
      and (assignment.effective_to is null or assignment.effective_to >= (clock_timestamp() at time zone 'Europe/London')::date)
  ) then raise exception 'staff member is not eligible at this kiosk site'; end if;
  select kiosk.* into settings from public.staff_kiosk_settings kiosk where kiosk.staff_id = target_staff_id;
  if not found or not settings.kiosk_enabled or settings.pin_hash is null
    or settings.pin_reset_required or extensions.crypt(candidate_pin, settings.pin_hash) <> settings.pin_hash then
    return jsonb_build_object('ok', false, 'code', 'invalid_pin');
  end if;
  state_value := private.get_commercial_attendance_state(device.organisation_id, device.site_id, target_staff_id, clock_timestamp());
  return jsonb_build_object('ok', true, 'code', 'verified', 'state', state_value ->> 'state', 'attendanceState', state_value);
end
$$;

create or replace function public.save_commercial_clock_event_correction(
  target_organisation_id uuid, target_site_id uuid, target_staff_id text,
  target_date date, target_event_id uuid, primary_correction_id uuid,
  requested_event_type text, requested_event_timestamp timestamptz,
  reason text, expected_revision text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare membership_id uuid; correction_kind text; existing public.clock_event_corrections%rowtype;
  resolved_original_event_id uuid; superseded_correction_id uuid;
  fingerprint text;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'attendance.correct') then
    raise exception 'attendance correction is not authorised';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if reason is null or length(btrim(reason)) < 5 or primary_correction_id is null
    or requested_event_type not in ('clock_in', 'clock_out')
    or (requested_event_timestamp at time zone 'Europe/London')::date <> target_date then
    raise exception 'attendance correction is invalid';
  end if;
  if not exists (select 1 from public.staff_profiles profile
    where profile.organisation_id = target_organisation_id and profile.id = target_staff_id) then
    raise exception 'attendance staff does not belong to the organisation';
  end if;
  if target_event_id is null and not exists (
    select 1 from public.staff_site_assignments assignment
    where assignment.organisation_id=target_organisation_id and assignment.site_id=target_site_id
      and assignment.staff_id=target_staff_id and assignment.effective_from<=target_date
      and (assignment.effective_to is null or assignment.effective_to>=target_date)
  ) then raise exception 'staff is not assigned to the attendance site'; end if;
  if target_event_id is not null then
    select event.id into resolved_original_event_id from public.clock_events event
    where event.organisation_id=target_organisation_id and event.site_id=target_site_id
      and event.staff_id=target_staff_id and event.recorded_date=target_date and event.id=target_event_id;
    if not found then
      select correction.original_event_id, correction.id into resolved_original_event_id, superseded_correction_id
      from public.clock_event_corrections correction
      where correction.organisation_id=target_organisation_id and correction.site_id=target_site_id
        and correction.staff_id=target_staff_id and correction.recorded_date=target_date and correction.id=target_event_id;
      if not found then raise exception 'attendance evidence is outside the authorised site'; end if;
    end if;
  end if;

  fingerprint:=md5(concat_ws('|',target_organisation_id,target_site_id,target_staff_id,target_date,
    target_event_id,requested_event_type,requested_event_timestamp,btrim(reason),expected_revision));
  select correction.* into existing from public.clock_event_corrections correction where correction.id = primary_correction_id;
  if found then
    if existing.request_fingerprint=fingerprint then return existing.batch_id; end if;
    raise exception 'correction operation ID belongs to another request';
  end if;
  perform private.lock_attendance_stream(target_organisation_id, target_staff_id);
  if private.commercial_attendance_revision(target_organisation_id, target_site_id, target_staff_id, target_date) <> expected_revision then
    raise exception using errcode = '40001', message = 'Attendance changed after this preview';
  end if;
  membership_id := private.current_membership_id(target_organisation_id);
  correction_kind := case when target_event_id is null then 'add' else 'replace' end;
  insert into public.clock_event_corrections (
    id, batch_id, correction_role, organisation_id, site_id, staff_id,
    correction_kind, original_event_id, supersedes_correction_id, event_type, event_timestamp,
    recorded_date, reason, created_by, created_by_membership_id,requested_target_event_id,expected_revision,request_fingerprint
  ) values (
    primary_correction_id, primary_correction_id, 'primary', target_organisation_id,
    target_site_id, target_staff_id, correction_kind, resolved_original_event_id, superseded_correction_id,
    requested_event_type, requested_event_timestamp, target_date, btrim(reason), null, membership_id,
    target_event_id,expected_revision,fingerprint
  );
  return primary_correction_id;
end
$$;

revoke all on function public.perform_commercial_kiosk_attendance_action(text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.verify_commercial_device_kiosk_pin(text, text, text) from public, anon, authenticated;
revoke all on function public.save_commercial_clock_event_correction(uuid, uuid, text, date, uuid, uuid, text, timestamptz, text, text) from public, anon;
grant execute on function public.perform_commercial_kiosk_attendance_action(text, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.verify_commercial_device_kiosk_pin(text, text, text) to anon, authenticated;
grant execute on function public.save_commercial_clock_event_correction(uuid, uuid, text, date, uuid, uuid, text, timestamptz, text, text) to authenticated;

create or replace function public.remove_commercial_clock_event_from_hours(
  target_organisation_id uuid,target_site_id uuid,target_staff_id text,target_date date,
  target_event_id uuid,reason text,expected_revision text,operation_id uuid
)
returns uuid language plpgsql security definer set search_path='' as $$
declare membership_id uuid; original_id uuid; superseded_id uuid; existing public.clock_event_corrections%rowtype;fingerprint text;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id,target_site_id,'attendance.correct') then
    raise exception 'attendance correction is not authorised';
  end if;
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'AAL2 is required'; end if;
  if target_event_id is null or operation_id is null or length(btrim(coalesce(reason,'')))<5 then
    raise exception 'attendance removal is invalid';
  end if;
  fingerprint:=md5(concat_ws('|',target_organisation_id,target_site_id,target_staff_id,target_date,
    target_event_id,'exclude',btrim(reason),expected_revision));
  select correction.* into existing from public.clock_event_corrections correction where correction.id=operation_id;
  if found then
    if existing.request_fingerprint=fingerprint then return existing.batch_id; end if;
    raise exception 'correction operation ID belongs to another request';
  end if;
  select event.id into original_id from public.clock_events event where event.organisation_id=target_organisation_id
    and event.site_id=target_site_id and event.staff_id=target_staff_id and event.recorded_date=target_date and event.id=target_event_id;
  if not found then
    select correction.original_event_id,correction.id into original_id,superseded_id
    from public.clock_event_corrections correction where correction.organisation_id=target_organisation_id
      and correction.site_id=target_site_id and correction.staff_id=target_staff_id
      and correction.recorded_date=target_date and correction.id=target_event_id;
    if not found then raise exception 'attendance evidence is outside the authorised site'; end if;
  end if;
  perform private.lock_attendance_stream(target_organisation_id,target_staff_id);
  if private.commercial_attendance_revision(target_organisation_id,target_site_id,target_staff_id,target_date)<>expected_revision then
    raise exception using errcode='40001',message='Attendance changed after this preview';
  end if;
  membership_id:=private.current_membership_id(target_organisation_id);
  insert into public.clock_event_corrections (
    id,batch_id,correction_role,organisation_id,site_id,staff_id,correction_kind,
    original_event_id,supersedes_correction_id,event_type,event_timestamp,recorded_date,
    reason,created_by,created_by_membership_id,requested_target_event_id,expected_revision,request_fingerprint
  ) values (
    operation_id,operation_id,'primary',target_organisation_id,target_site_id,target_staff_id,'exclude',
    original_id,superseded_id,null,null,target_date,btrim(reason),null,membership_id,
    target_event_id,expected_revision,fingerprint
  );
  return operation_id;
end
$$;

revoke all on function public.remove_commercial_clock_event_from_hours(uuid,uuid,text,date,uuid,text,text,uuid) from public,anon;
grant execute on function public.remove_commercial_clock_event_from_hours(uuid,uuid,text,date,uuid,text,text,uuid) to authenticated;

create or replace function public.reconcile_commercial_attendance_exceptions(
  target_organisation_id uuid, target_site_id uuid, target_staff_id text, target_date date
)
returns integer language plpgsql security definer set search_path = '' as $$
declare first_event record; last_event record; inserted_count integer := 0; created_count integer := 0;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'attendance.review') then
    raise exception 'attendance reconciliation is not authorised';
  end if;
  perform private.lock_attendance_stream(target_organisation_id, target_staff_id);
  select event.* into first_event from private.get_commercial_effective_clock_events(
    target_organisation_id, target_site_id, target_date, target_date, target_staff_id
  ) event order by event.event_timestamp, event.event_order_key limit 1;
  select event.* into last_event from private.get_commercial_effective_clock_events(
    target_organisation_id, target_site_id, target_date, target_date, target_staff_id
  ) event order by event.event_timestamp desc, event.event_order_key desc limit 1;
  if first_event.event_type = 'clock_out' then
    insert into public.attendance_exceptions (
      organisation_id, site_id, staff_id, operational_date, exception_type,
      primary_event_id, anomaly_fingerprint, detection_revision, source
    ) values (
      target_organisation_id, target_site_id, target_staff_id, target_date,
      'unmatched_clock_out', first_event.event_id,
      md5('unmatched:' || first_event.event_id::text),
      private.commercial_attendance_revision(target_organisation_id, target_site_id, target_staff_id, target_date),
      'reconciliation'
    ) on conflict do nothing;
    get diagnostics created_count = row_count;
  end if;
  if last_event.event_type = 'clock_in' and target_date < (now() at time zone 'Europe/London')::date then
    insert into public.attendance_exceptions (
      organisation_id, site_id, staff_id, operational_date, exception_type,
      primary_event_id, anomaly_fingerprint, detection_revision, source
    ) values (
      target_organisation_id, target_site_id, target_staff_id, target_date,
      'missing_clock_out', last_event.event_id,
      md5('missing-out:' || last_event.event_id::text),
      private.commercial_attendance_revision(target_organisation_id, target_site_id, target_staff_id, target_date),
      'reconciliation'
    ) on conflict do nothing;
    if found then created_count := created_count + 1; end if;
  end if;
  insert into public.attendance_exceptions (
      organisation_id, site_id, staff_id, operational_date, exception_type,
      primary_event_id, anomaly_fingerprint, detection_revision, source
    ) select
      target_organisation_id, target_site_id, target_staff_id, target_date,
      case when sequence.event_type = 'clock_in' then 'consecutive_clock_in' else 'unmatched_clock_out' end,
      sequence.event_id, md5('sequence:' || sequence.event_id::text),
      private.commercial_attendance_revision(target_organisation_id, target_site_id, target_staff_id, target_date),
      'reconciliation'
    from (
      select event.*,lag(event.event_type) over (order by event.event_timestamp,event.event_order_key) previous_type
      from private.get_commercial_effective_clock_events(
        target_organisation_id,target_site_id,target_date,target_date,target_staff_id
      ) event
    ) sequence where sequence.event_type=sequence.previous_type
    on conflict do nothing;
  get diagnostics inserted_count = row_count;
  created_count := created_count + inserted_count;
  return created_count;
end
$$;

create or replace function public.dismiss_commercial_attendance_exception(
  target_organisation_id uuid, target_site_id uuid, target_exception_id uuid,
  reason text, expected_revision text, operation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare issue public.attendance_exceptions%rowtype; membership_id uuid; existing public.attendance_exception_operations%rowtype; response_value jsonb;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'attendance.review') then
    raise exception 'attendance exception decision is not authorised';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if reason is null or length(btrim(reason)) < 5 then raise exception 'Enter a dismissal reason of at least five characters'; end if;
  select operation.* into existing from public.attendance_exception_operations operation where operation.operation_id = dismiss_commercial_attendance_exception.operation_id;
  if found then
    if existing.organisation_id = target_organisation_id and existing.site_id = target_site_id
      and existing.exception_id = target_exception_id and existing.operation_kind = 'dismiss'
      and existing.expected_revision = dismiss_commercial_attendance_exception.expected_revision
      and existing.reason = btrim(reason) and existing.completed_at is not null then return existing.safe_response; end if;
    raise exception 'attendance operation ID belongs to another request';
  end if;
  select exception.* into issue from public.attendance_exceptions exception
  where exception.organisation_id = target_organisation_id and exception.site_id = target_site_id
    and exception.id = target_exception_id for update;
  if not found or issue.status not in ('open', 'under_review') then raise exception 'attendance exception is not available'; end if;
  perform private.lock_attendance_stream(target_organisation_id, issue.staff_id);
  if private.commercial_attendance_revision(target_organisation_id, target_site_id, issue.staff_id, issue.operational_date) <> expected_revision then
    raise exception using errcode = '40001', message = 'Attendance changed after this review opened';
  end if;
  membership_id := private.current_membership_id(target_organisation_id);
  response_value := jsonb_build_object('ok', true, 'code', 'dismissed', 'exceptionId', target_exception_id, 'status', 'dismissed');
  insert into public.attendance_exception_operations (
    operation_id, organisation_id, site_id, exception_id, operation_kind,
    expected_revision, reason, request_fingerprint, created_by, created_by_membership_id,
    safe_response, completed_at
  ) values (
    operation_id, target_organisation_id, target_site_id, target_exception_id, 'dismiss',
    expected_revision, btrim(reason), md5(concat_ws('|','dismiss',target_exception_id,expected_revision,btrim(reason))),
    null, membership_id, response_value, clock_timestamp()
  );
  update public.attendance_exceptions set status = 'dismissed', reviewing_manager_id = null,
    reviewing_membership_id = membership_id, review_started_at = coalesce(review_started_at, clock_timestamp()),
    dismissal_reason = btrim(reason), dismissed_at = clock_timestamp(), updated_at = clock_timestamp()
  where organisation_id = target_organisation_id and site_id = target_site_id and id = target_exception_id;
  return response_value;
end
$$;

create or replace function public.resolve_commercial_attendance_exception(
  target_organisation_id uuid, target_site_id uuid, target_exception_id uuid,
  correction_plan jsonb, reason text, expected_revision text, operation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare issue public.attendance_exceptions%rowtype; membership_id uuid; batch_id uuid; response_value jsonb; primary_plan jsonb;
  existing public.attendance_exception_operations%rowtype;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'attendance.correct') then
    raise exception 'attendance exception resolution is not authorised';
  end if;
  if correction_plan is null or reason is null or length(btrim(reason)) < 5 then
    raise exception 'attendance resolution requires a correction and reason';
  end if;
  select operation.* into existing from public.attendance_exception_operations operation
  where operation.operation_id = resolve_commercial_attendance_exception.operation_id;
  if found then
    if existing.organisation_id=target_organisation_id and existing.site_id=target_site_id
      and existing.exception_id=target_exception_id and existing.operation_kind='resolve'
      and existing.expected_revision=resolve_commercial_attendance_exception.expected_revision
      and existing.reason=btrim(reason)
      and existing.request_fingerprint=md5(concat_ws('|','resolve',target_exception_id,expected_revision,btrim(reason),correction_plan::text))
      and existing.completed_at is not null then return existing.safe_response; end if;
    raise exception 'attendance operation ID belongs to another request';
  end if;
  select exception.* into issue from public.attendance_exceptions exception
  where exception.organisation_id = target_organisation_id and exception.site_id = target_site_id
    and exception.id = target_exception_id for update;
  if not found or issue.status not in ('open','under_review') then raise exception 'attendance exception is not available'; end if;
  primary_plan := correction_plan -> 'primary';
  batch_id := public.save_commercial_clock_event_correction(
    target_organisation_id, target_site_id, issue.staff_id, issue.operational_date,
    nullif(primary_plan ->> 'original_event_id','')::uuid,
    operation_id, primary_plan ->> 'event_type',
    nullif(primary_plan ->> 'event_timestamp','')::timestamptz,
    btrim(reason), expected_revision
  );
  membership_id := private.current_membership_id(target_organisation_id);
  response_value := jsonb_build_object('ok',true,'code','resolved','exceptionId',target_exception_id,'status','resolved','correctionBatchId',batch_id);
  insert into public.attendance_exception_operations (
    operation_id, organisation_id, site_id, exception_id, operation_kind,
    expected_revision, reason, request_fingerprint, created_by, created_by_membership_id,
    correction_batch_id, safe_response, completed_at
  ) values (
    operation_id, target_organisation_id, target_site_id, target_exception_id, 'resolve',
    expected_revision, btrim(reason), md5(concat_ws('|','resolve',target_exception_id,expected_revision,btrim(reason),correction_plan::text)),
    null, membership_id, batch_id, response_value, clock_timestamp()
  );
  update public.attendance_exceptions set status='resolved', reviewing_manager_id=null,
    reviewing_membership_id=membership_id, review_started_at=coalesce(review_started_at,clock_timestamp()),
    resolution_correction_batch_id=batch_id, resolution_reason=btrim(reason),
    resolved_at=clock_timestamp(), updated_at=clock_timestamp()
  where organisation_id=target_organisation_id and site_id=target_site_id and id=target_exception_id;
  return response_value;
end
$$;

revoke all on function public.reconcile_commercial_attendance_exceptions(uuid, uuid, text, date) from public, anon;
revoke all on function public.dismiss_commercial_attendance_exception(uuid, uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.resolve_commercial_attendance_exception(uuid, uuid, uuid, jsonb, text, text, uuid) from public, anon;
grant execute on function public.reconcile_commercial_attendance_exceptions(uuid, uuid, text, date) to authenticated;
grant execute on function public.dismiss_commercial_attendance_exception(uuid, uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.resolve_commercial_attendance_exception(uuid, uuid, uuid, jsonb, text, text, uuid) to authenticated;

-- Compatibility dispatchers are the only kiosk entry points used by the application.
-- The device record, never a client-supplied tenant identifier, selects the path.
create or replace function public.verify_tenant_aware_device_kiosk_pin(
  device_token text, target_staff_id text, candidate_pin text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare device_organisation_id uuid;
begin
  select device.organisation_id into device_organisation_id
  from public.kiosk_devices device
  where device.token_hash = extensions.digest(device_token, 'sha256')
    and device.active = true and (device.expires_at is null or device.expires_at > now());
  if not found then return jsonb_build_object('ok',false,'code','device_required'); end if;
  if device_organisation_id is null then
    return public.verify_device_kiosk_pin(device_token, target_staff_id, candidate_pin);
  end if;
  return public.verify_commercial_device_kiosk_pin(device_token, target_staff_id, candidate_pin);
end
$$;

create or replace function public.perform_tenant_aware_kiosk_attendance_action(
  device_token text, target_staff_id text, candidate_pin text, requested_action text,
  expected_revision text, idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare device_organisation_id uuid;
begin
  select device.organisation_id into device_organisation_id
  from public.kiosk_devices device
  where device.token_hash = extensions.digest(device_token, 'sha256')
    and device.active = true and (device.expires_at is null or device.expires_at > now());
  if not found then return jsonb_build_object('ok',false,'code','device_required'); end if;
  if device_organisation_id is null then
    return public.perform_device_kiosk_attendance_action(
      device_token, target_staff_id, candidate_pin, requested_action, expected_revision, idempotency_key
    );
  end if;
  return public.perform_commercial_kiosk_attendance_action(
    device_token, target_staff_id, candidate_pin, requested_action, expected_revision, idempotency_key
  );
end
$$;

revoke all on function public.verify_tenant_aware_device_kiosk_pin(text, text, text) from public, anon, authenticated;
revoke all on function public.perform_tenant_aware_kiosk_attendance_action(text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.verify_tenant_aware_device_kiosk_pin(text, text, text) to anon, authenticated;
grant execute on function public.perform_tenant_aware_kiosk_attendance_action(text, text, text, text, text, uuid) to anon, authenticated;

create or replace function public.save_commercial_attendance_day_review(
  target_organisation_id uuid, target_site_id uuid, target_staff_id text,
  target_date date, requested_status public.attendance_review_status, reason text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare membership_id uuid; review_id uuid;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'attendance.review') then
    raise exception 'attendance review is not authorised';
  end if;
  if requested_status <> 'approved' and length(btrim(coalesce(reason,''))) < 5 then
    raise exception 'attendance review reason is required';
  end if;
  if not exists (select 1 from public.staff_profiles profile where profile.organisation_id=target_organisation_id and profile.id=target_staff_id) then
    raise exception 'attendance staff does not belong to the organisation';
  end if;
  membership_id := private.current_membership_id(target_organisation_id);
  select review.id into review_id from public.attendance_day_reviews review
  where review.organisation_id=target_organisation_id and review.site_id=target_site_id
    and review.staff_id=target_staff_id and review.review_date=target_date for update;
  if found then
    update public.attendance_day_reviews set status=requested_status, reason=nullif(btrim(reason),''),
      reviewed_by=null, reviewed_by_membership_id=membership_id, reviewed_at=clock_timestamp(), updated_at=clock_timestamp()
    where id=review_id;
  else
    insert into public.attendance_day_reviews (
      organisation_id,site_id,staff_id,review_date,status,reason,reviewed_by,reviewed_by_membership_id,reviewed_at
    ) values (
      target_organisation_id,target_site_id,target_staff_id,target_date,requested_status,nullif(btrim(reason),''),null,membership_id,clock_timestamp()
    ) returning id into review_id;
  end if;
  return review_id;
end
$$;

create or replace function public.submit_commercial_attendance_correction_request(
  target_organisation_id uuid, target_site_id uuid, target_date date, issue_type text, staff_note text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare membership_id uuid; linked_staff_id text; request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'attendance request is not authorised';
  end if;
  membership_id := private.current_membership_id(target_organisation_id);
  select membership.staff_id into linked_staff_id from public.organisation_memberships membership
  where membership.organisation_id=target_organisation_id and membership.id=membership_id
    and membership.status='active' and membership.revoked_at is null;
  if linked_staff_id is null then raise exception 'a linked staff profile is required'; end if;
  if not exists (select 1 from public.organisation_sites site where site.organisation_id=target_organisation_id
    and site.id=target_site_id and site.active=true and site.archived_at is null) then raise exception 'attendance site is unavailable'; end if;
  if length(btrim(coalesce(staff_note,''))) < 5 then raise exception 'attendance request note is required'; end if;
  if issue_type not in ('forgot_clock_in','forgot_clock_out','incorrect_time','other') then raise exception 'invalid attendance issue type'; end if;
  if not exists (
    select 1 from public.staff_site_assignments assignment where assignment.organisation_id=target_organisation_id
      and assignment.site_id=target_site_id and assignment.staff_id=linked_staff_id
      and assignment.effective_from <= target_date and (assignment.effective_to is null or assignment.effective_to >= target_date)
  ) then raise exception 'staff is not assigned to the attendance site'; end if;
  insert into public.attendance_correction_requests (
    organisation_id,site_id,staff_id,attendance_date,issue_type,staff_note,created_by_membership_id
  ) values (target_organisation_id,target_site_id,linked_staff_id,target_date,issue_type,btrim(staff_note),membership_id)
  returning id into request_id;
  return request_id;
end
$$;

create or replace function public.resolve_commercial_attendance_correction_request(
  target_organisation_id uuid, target_site_id uuid, target_request_id uuid,
  requested_status public.attendance_correction_request_status, manager_note text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare membership_id uuid; changed integer;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id,target_site_id,'attendance.review') then
    raise exception 'attendance request resolution is not authorised';
  end if;
  if requested_status not in ('resolved','rejected') or length(btrim(coalesce(manager_note,''))) < 5 then
    raise exception 'attendance request decision and note are required';
  end if;
  membership_id := private.current_membership_id(target_organisation_id);
  update public.attendance_correction_requests set status=requested_status, manager_note=btrim(manager_note),
    resolved_by=null, resolved_by_membership_id=membership_id, resolved_at=clock_timestamp(), updated_at=clock_timestamp()
  where organisation_id=target_organisation_id and site_id=target_site_id and id=target_request_id and status='pending';
  get diagnostics changed = row_count;
  return changed=1;
end
$$;

revoke all on function public.save_commercial_attendance_day_review(uuid,uuid,text,date,public.attendance_review_status,text) from public,anon;
revoke all on function public.submit_commercial_attendance_correction_request(uuid,uuid,date,text,text) from public,anon;
revoke all on function public.resolve_commercial_attendance_correction_request(uuid,uuid,uuid,public.attendance_correction_request_status,text) from public,anon;
grant execute on function public.save_commercial_attendance_day_review(uuid,uuid,text,date,public.attendance_review_status,text) to authenticated;
grant execute on function public.submit_commercial_attendance_correction_request(uuid,uuid,date,text,text) to authenticated;
grant execute on function public.resolve_commercial_attendance_correction_request(uuid,uuid,uuid,public.attendance_correction_request_status,text) to authenticated;

create or replace function public.get_commercial_attendance_exceptions(
  target_organisation_id uuid, target_site_id uuid, range_start date, range_end date,
  requested_status text default null, requested_type text default null, requested_staff_id text default null
)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id,target_site_id,'attendance.review') then
    raise exception 'attendance exception access is not authorised';
  end if;
  if range_start is null or range_end is null or range_start>range_end or range_end-range_start>366 then
    raise exception 'Choose a valid attendance issue date range';
  end if;
  return query select jsonb_build_object(
    'organisation_id',issue.organisation_id,'site_id',issue.site_id,'id',issue.id,
    'staff_id',issue.staff_id,'full_name',staff.full_name,'operational_date',issue.operational_date,
    'exception_type',issue.exception_type,'status',issue.status,'source',issue.source,
    'created_at',issue.created_at,'updated_at',issue.updated_at,
    'state_revision',private.commercial_attendance_revision(issue.organisation_id,issue.site_id,issue.staff_id,issue.operational_date),
    'suggested_resolution_at',issue.suggested_resolution_at,
    'payroll_may_be_affected',issue.status in ('open','under_review'),
    'original_events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',event.id,'event_type',event.event_type,'event_timestamp',event.event_timestamp,
      'kiosk_device_id',event.kiosk_device_id,'event_source',event.event_source,'created_at',event.created_at
    ) order by event.event_timestamp,event.id) from public.clock_events event
      where event.organisation_id=issue.organisation_id and event.site_id=issue.site_id
        and event.staff_id=issue.staff_id and event.recorded_date=issue.operational_date),'[]'::jsonb),
    'effective_events',coalesce((select jsonb_agg(jsonb_build_object(
      'organisation_id',event.organisation_id,'site_id',event.site_id,'event_id',event.event_id,
      'event_order_key',event.event_order_key,'original_event_id',event.original_event_id,
      'correction_id',event.correction_id,'event_type',event.event_type,
      'event_timestamp',event.event_timestamp,'source',event.source
    ) order by event.event_timestamp,event.event_order_key) from private.get_commercial_effective_clock_events(
      issue.organisation_id,issue.site_id,issue.operational_date,issue.operational_date,issue.staff_id
    ) event),'[]'::jsonb),
    'corrections',coalesce((select jsonb_agg(to_jsonb(correction) order by correction.created_at,correction.id)
      from public.clock_event_corrections correction where correction.organisation_id=issue.organisation_id
        and correction.site_id=issue.site_id and correction.staff_id=issue.staff_id
        and correction.recorded_date=issue.operational_date),'[]'::jsonb),
    'scheduled_shifts','[]'::jsonb,'leave_context','[]'::jsonb,
    'operation_history',coalesce((select jsonb_agg(to_jsonb(operation) order by operation.created_at,operation.operation_id)
      from public.attendance_exception_operations operation where operation.organisation_id=issue.organisation_id
        and operation.site_id=issue.site_id and operation.exception_id=issue.id),'[]'::jsonb),
    'resolution_reason',issue.resolution_reason,'dismissal_reason',issue.dismissal_reason,
    'resolved_at',issue.resolved_at,'dismissed_at',issue.dismissed_at,'reviewing_manager_name',null
  ) from public.attendance_exceptions issue join public.staff_profiles staff
    on staff.organisation_id=issue.organisation_id and staff.id=issue.staff_id
  where issue.organisation_id=target_organisation_id and issue.site_id=target_site_id
    and issue.operational_date between range_start and range_end
    and (requested_status is null or issue.status=requested_status)
    and (requested_type is null or issue.exception_type=requested_type)
    and (requested_staff_id is null or issue.staff_id=requested_staff_id)
  order by issue.operational_date desc,issue.created_at desc,issue.id;
end
$$;

revoke all on function public.get_commercial_attendance_exceptions(uuid,uuid,date,date,text,text,text) from public,anon;
grant execute on function public.get_commercial_attendance_exceptions(uuid,uuid,date,date,text,text,text) to authenticated;

create or replace function public.get_commercial_own_attendance_records(
  target_organisation_id uuid, target_site_id uuid, range_start date, range_end date
)
returns table (
  organisation_id uuid, site_id uuid, record_kind text, id uuid, event_type text,
  event_timestamp timestamptz, recorded_date date, event_source text,
  manager_correction boolean, correction_kind text, original_event_id uuid,
  supersedes_correction_id uuid, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare membership_id uuid; linked_staff_id text;
begin
  if auth.uid() is null then
    raise exception 'attendance self-service access is not authorised';
  end if;
  membership_id := private.current_membership_id(target_organisation_id);
  select membership.staff_id into linked_staff_id from public.organisation_memberships membership
  where membership.organisation_id=target_organisation_id and membership.id=membership_id
    and membership.status='active' and membership.revoked_at is null;
  if linked_staff_id is null then raise exception 'a linked staff profile is required'; end if;
  if not exists (select 1 from public.staff_site_assignments assignment
    where assignment.organisation_id=target_organisation_id and assignment.site_id=target_site_id
      and assignment.staff_id=linked_staff_id and assignment.effective_from<=range_end
      and (assignment.effective_to is null or assignment.effective_to>=range_start)) then
    raise exception 'staff is not eligible for the attendance site';
  end if;
  if range_start is null or range_end is null or range_start>range_end or range_end-range_start>93 then
    raise exception 'Choose a valid attendance date range';
  end if;
  return query
  select event.organisation_id,event.site_id,'original'::text,event.id,event.event_type,event.event_timestamp,
    event.recorded_date,event.event_source,event.manager_correction,null::text,null::uuid,null::uuid,event.created_at
  from public.clock_events event where event.organisation_id=target_organisation_id and event.site_id=target_site_id
    and event.staff_id=linked_staff_id and event.recorded_date between range_start and range_end
  union all
  select correction.organisation_id,correction.site_id,'correction'::text,correction.id,correction.event_type,
    correction.event_timestamp,correction.recorded_date,'manager_correction'::text,true,
    correction.correction_kind,correction.original_event_id,correction.supersedes_correction_id,correction.created_at
  from public.clock_event_corrections correction where correction.organisation_id=target_organisation_id
    and correction.site_id=target_site_id and correction.staff_id=linked_staff_id
    and correction.recorded_date between range_start and range_end;
end
$$;

revoke all on function public.get_commercial_own_attendance_records(uuid,uuid,date,date) from public,anon;
grant execute on function public.get_commercial_own_attendance_records(uuid,uuid,date,date) to authenticated;

create or replace function public.get_tenant_aware_device_kiosk_roster(device_token text)
returns table (
  staff_id text, display_name text, full_name text, employment_role text,
  current_status text, pin_ready boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare device_record public.kiosk_devices%rowtype;
begin
  select device.* into device_record from public.kiosk_devices device
  where device.token_hash=extensions.digest(device_token,'sha256') and device.active=true
    and (device.expires_at is null or device.expires_at>now());
  if not found then raise exception 'Kiosk device access required'; end if;
  if device_record.organisation_id is null then
    return query select legacy.staff_id,legacy.display_name,legacy.full_name,legacy.employment_role,
      legacy.current_status,legacy.pin_ready
    from public.get_device_kiosk_roster(device_token) legacy
    join public.staff_profiles profile on profile.id=legacy.staff_id and profile.organisation_id is null;
    return;
  end if;
  return query select profile.id,profile.display_name,profile.full_name,profile.employment_role,
    case when state.value->>'state'='clocked_in' then 'clocked_in' else 'clocked_out' end,
    settings.pin_hash is not null and settings.pin_reset_required=false
  from public.staff_profiles profile
  join public.staff_site_assignments assignment on assignment.organisation_id=device_record.organisation_id
    and assignment.site_id=device_record.site_id and assignment.staff_id=profile.id
    and assignment.effective_from<=(now() at time zone 'Europe/London')::date
    and (assignment.effective_to is null or assignment.effective_to>=(now() at time zone 'Europe/London')::date)
  join public.staff_kiosk_settings settings on settings.staff_id=profile.id and settings.kiosk_enabled=true
  cross join lateral (select private.get_commercial_attendance_state(
    device_record.organisation_id,device_record.site_id,profile.id,now()
  ) value) state
  where profile.organisation_id=device_record.organisation_id and profile.active=true
  order by profile.full_name,profile.id;
end
$$;

revoke all on function public.get_tenant_aware_device_kiosk_roster(text) from public,anon,authenticated;
grant execute on function public.get_tenant_aware_device_kiosk_roster(text) to anon,authenticated;

create or replace function public.change_tenant_aware_device_kiosk_pin(
  device_token text,target_staff_id text,temporary_pin text,new_pin text
)
returns table (
  ok boolean,code text,current_status text,work_week_start_date date,work_week_end_date date,
  completed_minutes integer,open_shift_in_progress boolean
)
language plpgsql security definer set search_path='' as $$
declare device_record public.kiosk_devices%rowtype;legacy_result record;state_value jsonb;
  week_start date;week_end date;site_minutes integer:=0;
begin
  select device.* into device_record from public.kiosk_devices device
  where device.token_hash=extensions.digest(device_token,'sha256') and device.active=true
    and (device.expires_at is null or device.expires_at>now());
  if not found then raise exception 'Kiosk device access required'; end if;
  if device_record.organisation_id is null then
    return query select * from public.change_device_kiosk_pin(device_token,target_staff_id,temporary_pin,new_pin);
    return;
  else
    if not exists (select 1 from public.staff_profiles profile where profile.organisation_id=device_record.organisation_id
      and profile.id=target_staff_id and profile.active=true) then raise exception 'staff is outside the kiosk organisation'; end if;
    if not exists (select 1 from public.staff_site_assignments assignment
      where assignment.organisation_id=device_record.organisation_id and assignment.site_id=device_record.site_id
        and assignment.staff_id=target_staff_id and assignment.effective_from<=(now() at time zone 'Europe/London')::date
        and (assignment.effective_to is null or assignment.effective_to>=(now() at time zone 'Europe/London')::date)) then
      raise exception 'staff is not eligible for this kiosk site';
    end if;
  end if;
  select * into legacy_result from public.change_device_kiosk_pin(device_token,target_staff_id,temporary_pin,new_pin);
  if not coalesce(legacy_result.ok,false) then
    return query select legacy_result.ok,legacy_result.code,null::text,null::date,null::date,0,false;
    return;
  end if;
  state_value:=private.get_commercial_attendance_state(
    device_record.organisation_id,device_record.site_id,target_staff_id,now()
  );
  week_start:=(now() at time zone 'Europe/London')::date-(extract(isodow from (now() at time zone 'Europe/London')::date)::integer-1);
  week_end:=week_start+6;
  select coalesce(sum(case when sequence.event_type='clock_in' and sequence.next_type='clock_out'
    then greatest(0,floor(extract(epoch from (sequence.next_timestamp-sequence.event_timestamp))/60)::integer) else 0 end),0)::integer
  into site_minutes from (
    select event.*,lead(event.event_type) over(partition by event.recorded_date order by event.event_timestamp,event.event_order_key) next_type,
      lead(event.event_timestamp) over(partition by event.recorded_date order by event.event_timestamp,event.event_order_key) next_timestamp
    from private.get_commercial_effective_clock_events(
      device_record.organisation_id,device_record.site_id,week_start,week_end,target_staff_id
    ) event
  ) sequence;
  return query select true,legacy_result.code,
    case when state_value->>'state'='clocked_in' then 'clocked_in' else 'clocked_out' end,
    week_start,week_end,site_minutes,(state_value->>'state'='clocked_in');
end
$$;

revoke all on function public.change_tenant_aware_device_kiosk_pin(text,text,text,text) from public,anon,authenticated;
grant execute on function public.change_tenant_aware_device_kiosk_pin(text,text,text,text) to anon,authenticated;

-- Legacy attendance definers remain callable only through explicitly unowned results.
create or replace function public.get_manager_kiosk_statuses(reference_date date default null)
returns table (staff_id text,current_status text)
language plpgsql stable security definer set search_path='' as $$
declare manager_account public.staff_accounts;evaluated_at timestamptz;
begin
  manager_account:=public.current_staff_account();
  if manager_account.id is null or manager_account.role<>'manager' then raise exception 'Manager access required'; end if;
  evaluated_at:=case when reference_date is null or reference_date=(now() at time zone 'Europe/London')::date
    then now() else (reference_date+time '12:00') at time zone 'Europe/London' end;
  return query select profile.id,case when state.value->>'state'='clocked_in' then 'clocked_in' else 'clocked_out' end
  from public.staff_profiles profile cross join lateral (
    select public.get_attendance_state(profile.id,evaluated_at) value
  ) state where profile.organisation_id is null and profile.active=true order by profile.full_name,profile.id;
end
$$;

create or replace function public.get_legacy_manager_attendance_exceptions(
  range_start date,range_end date,requested_status text default null,requested_type text default null,requested_staff_id text default null
)
returns setof jsonb language sql stable security definer set search_path='' as $$
  select issue from public.get_manager_attendance_exceptions(
    range_start,range_end,requested_status,requested_type,requested_staff_id
  ) issue join public.staff_profiles profile on profile.id=issue->>'staff_id'
  where profile.organisation_id is null
$$;

create or replace function public.get_manager_attendance_dashboard(reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager_account public.staff_accounts;result_value jsonb;
begin
  manager_account:=public.current_staff_account();
  if manager_account.id is null or manager_account.role<>'manager' then raise exception 'Manager access required'; end if;
  if reference_date is null then raise exception 'A reference date is required'; end if;
  with effective as (
    select event.*,row_number() over (partition by event.staff_id order by event.event_timestamp desc,event.event_order_key desc,event.event_id desc) latest_rank
    from public.get_effective_clock_events(reference_date,reference_date,null) event
    join public.staff_profiles profile on profile.id=event.staff_id and profile.organisation_id is null
  ),clocked_in as (
    select * from effective where latest_rank=1 and event_type='clock_in'
  ),issue_counts as (
    select count(*) filter(where issue.status in ('open','under_review'))::integer unresolved_count,
      count(*) filter(where issue.status in ('open','under_review') and issue.exception_type='missing_clock_out')::integer missing_count,
      count(*) filter(where issue.status in ('open','under_review') and issue.exception_type='unusually_long_shift')::integer long_count
    from public.attendance_exceptions issue where issue.organisation_id is null and issue.operational_date<=reference_date
  ),correction_requests as (
    select count(*)::integer pending_count from public.attendance_correction_requests request
    where request.organisation_id is null and request.status='pending'
  ) select jsonb_build_object(
    'unresolved_attendance_issues',issue_counts.unresolved_count,'missing_clock_outs',issue_counts.missing_count,
    'long_running_shifts',issue_counts.long_count,'pending_corrections',correction_requests.pending_count,
    'currently_clocked_in',(select count(*) from clocked_in),
    'clocked_in_staff',coalesce((select jsonb_agg(jsonb_build_object(
      'staff_id',clocked.staff_id,'display_name',coalesce(nullif(trim(profile.display_name),''),profile.full_name),
      'clocked_in_at',clocked.event_timestamp,'scheduled_end',null
    ) order by profile.full_name) from clocked_in clocked join public.staff_profiles profile on profile.id=clocked.staff_id),'[]'::jsonb),
    'attendance_warnings',coalesce((select jsonb_agg(jsonb_build_object(
      'staff_id',issue.staff_id,'display_name',coalesce(nullif(trim(profile.display_name),''),profile.full_name),
      'warning',replace(issue.exception_type,'_',' '),'warning_date',issue.operational_date,'exception_type',issue.exception_type
    ) order by issue.operational_date desc,profile.full_name) from public.attendance_exceptions issue
      join public.staff_profiles profile on profile.id=issue.staff_id where issue.organisation_id is null
      and issue.status in ('open','under_review') and issue.operational_date<=reference_date),'[]'::jsonb)
  ) into result_value from issue_counts cross join correction_requests;
  return result_value;
end
$$;

revoke all on function public.get_manager_kiosk_statuses(date) from public,anon;
revoke all on function public.get_legacy_manager_attendance_exceptions(date,date,text,text,text) from public,anon;
revoke all on function public.get_manager_attendance_dashboard(date) from public,anon;
grant execute on function public.get_manager_kiosk_statuses(date) to authenticated;
grant execute on function public.get_legacy_manager_attendance_exceptions(date,date,text,text,text) to authenticated;
grant execute on function public.get_manager_attendance_dashboard(date) to authenticated;

create or replace function public.get_commercial_attendance_dashboard(
  target_organisation_id uuid,target_site_id uuid,reference_date date
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_value jsonb;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id,target_site_id,'attendance.read') then
    raise exception 'attendance dashboard access is not authorised';
  end if;
  with eligible as (
    select distinct assignment.staff_id from public.staff_site_assignments assignment
    where assignment.organisation_id=target_organisation_id and assignment.site_id=target_site_id
      and assignment.effective_from<=reference_date and (assignment.effective_to is null or assignment.effective_to>=reference_date)
  ),effective as (
    select event.*,row_number() over(partition by event.staff_id order by event.event_timestamp desc,event.event_order_key desc) latest_rank
    from private.get_commercial_effective_clock_events(
      target_organisation_id,target_site_id,reference_date,reference_date,null
    ) event
  ),clocked as (select * from effective where latest_rank=1 and event_type='clock_in'),issues as (
    select count(*) filter(where status in ('open','under_review'))::integer unresolved,
      count(*) filter(where status in ('open','under_review') and exception_type='missing_clock_out')::integer missing,
      count(*) filter(where status in ('open','under_review') and exception_type='unusually_long_shift')::integer long_running
    from public.attendance_exceptions where organisation_id=target_organisation_id and site_id=target_site_id
      and operational_date<=reference_date
  ) select jsonb_build_object(
    'reference_date',reference_date,'week_start_date',reference_date-(extract(isodow from reference_date)::integer-1),
    'active_staff',(select count(*) from eligible),'currently_clocked_in',(select count(*) from clocked),
    'today_scheduled_shifts',0,'today_attendance_exceptions',(select count(*) from public.attendance_exceptions
      where organisation_id=target_organisation_id and site_id=target_site_id and operational_date=reference_date
        and status in ('open','under_review')),
    'unresolved_attendance_issues',issues.unresolved,'missing_clock_outs',issues.missing,
    'long_running_shifts',issues.long_running,'pending_corrections',(select count(*) from public.attendance_correction_requests
      where organisation_id=target_organisation_id and site_id=target_site_id and status='pending'),
    'pending_leave_requests',0,'approved_leave_rota_conflicts',0,'expired_certificates',0,
    'certificates_expiring_30_days',0,'incomplete_central_records',0,'staff_missing_kiosk_pin',0,
    'staff_missing_pay_arrangement',0,'current_rota',null,
    'clocked_in_staff',coalesce((select jsonb_agg(jsonb_build_object(
      'staff_id',clocked.staff_id,'display_name',coalesce(nullif(trim(profile.display_name),''),profile.full_name),
      'clocked_in_at',clocked.event_timestamp,'scheduled_end',null
    ) order by profile.full_name) from clocked join public.staff_profiles profile
      on profile.organisation_id=target_organisation_id and profile.id=clocked.staff_id),'[]'::jsonb),
    'attendance_warnings',coalesce((select jsonb_agg(jsonb_build_object(
      'staff_id',issue.staff_id,'display_name',coalesce(nullif(trim(profile.display_name),''),profile.full_name),
      'warning',replace(issue.exception_type,'_',' '),'warning_date',issue.operational_date
    ) order by issue.operational_date desc,profile.full_name) from public.attendance_exceptions issue
      join public.staff_profiles profile on profile.organisation_id=issue.organisation_id and profile.id=issue.staff_id
      where issue.organisation_id=target_organisation_id and issue.site_id=target_site_id
        and issue.status in ('open','under_review') and issue.operational_date<=reference_date),'[]'::jsonb),
    'upcoming_shifts','[]'::jsonb
  ) into result_value from issues;
  return result_value;
end
$$;

revoke all on function public.get_commercial_attendance_dashboard(uuid,uuid,date) from public,anon;
grant execute on function public.get_commercial_attendance_dashboard(uuid,uuid,date) to authenticated;

revoke all on function public.get_device_kiosk_roster(text) from public,anon,authenticated;
revoke all on function public.verify_device_kiosk_pin(text,text,text) from public,anon,authenticated;
revoke all on function public.perform_device_kiosk_attendance_action(text,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.record_device_kiosk_clock_event(text,text,text,text) from public,anon,authenticated;
revoke all on function public.change_device_kiosk_pin(text,text,text,text) from public,anon,authenticated;
revoke all on function public.get_manager_attendance_exceptions(date,date,text,text,text) from public,anon,authenticated;
