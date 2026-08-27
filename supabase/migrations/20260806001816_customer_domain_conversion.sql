-- Commercial Workstream 4: customer-owned operational domains except attendance,
-- payroll processing and kiosk devices. Existing unowned Jan rows remain unowned.

create type public.compliance_module_industry as enum ('nursery', 'care_home', 'clinic', 'tuition_centre');
create type public.compliance_requirement_kind as enum ('qualification', 'credential', 'document', 'check');
create type public.staff_import_batch_status as enum ('previewing', 'preview_ready', 'invalid', 'committed');
create type public.staff_import_row_status as enum ('valid', 'invalid', 'committed');

alter table public.staff_profiles drop constraint if exists staff_profiles_email_key;
create unique index staff_profiles_legacy_email_key on public.staff_profiles (email)
  where organisation_id is null and email is not null;
create unique index staff_profiles_commercial_email_key on public.staff_profiles (organisation_id, lower(email))
  where organisation_id is not null and email is not null;

insert into private.role_permissions (role, permission) values
  ('organisation_admin', 'compliance.manage'),
  ('site_manager', 'compliance.read')
on conflict do nothing;

alter table public.staff_qualifications add column organisation_id uuid;
alter table public.staff_certificates add column organisation_id uuid;
alter table public.staff_central_records add column organisation_id uuid;
alter table public.staff_central_record_items add column organisation_id uuid;
alter table public.staff_reference_checks add column organisation_id uuid;
alter table public.staff_import_reviews add column organisation_id uuid;
alter table public.staff_pay_arrangements add column organisation_id uuid;
alter table public.staff_qualifications add column verified_by_membership_id uuid;
alter table public.staff_certificates add column verified_by_membership_id uuid;
alter table public.staff_central_records add column checked_by_membership_id uuid;
alter table public.staff_central_record_items add column checked_by_membership_id uuid;
alter table public.staff_reference_checks add column checked_by_membership_id uuid;

update public.staff_qualifications owned set organisation_id = profile.organisation_id
from public.staff_profiles profile where profile.id = owned.staff_id and profile.organisation_id is not null;
update public.staff_certificates owned set organisation_id = profile.organisation_id
from public.staff_profiles profile where profile.id = owned.staff_id and profile.organisation_id is not null;
update public.staff_central_records owned set organisation_id = profile.organisation_id
from public.staff_profiles profile where profile.id = owned.staff_id and profile.organisation_id is not null;
update public.staff_central_record_items owned set organisation_id = profile.organisation_id
from public.staff_profiles profile where profile.id = owned.staff_id and profile.organisation_id is not null;
update public.staff_reference_checks owned set organisation_id = profile.organisation_id
from public.staff_profiles profile where profile.id = owned.staff_id and profile.organisation_id is not null;
update public.staff_import_reviews owned set organisation_id = profile.organisation_id
from public.staff_profiles profile where profile.id = owned.imported_staff_id and profile.organisation_id is not null;
update public.staff_pay_arrangements owned set organisation_id = profile.organisation_id
from public.staff_profiles profile where profile.id = owned.staff_id and profile.organisation_id is not null;

alter table public.staff_qualifications add constraint staff_qualifications_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.staff_certificates add constraint staff_certificates_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.staff_central_records add constraint staff_central_records_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.staff_central_record_items add constraint staff_central_record_items_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.staff_reference_checks add constraint staff_reference_checks_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.staff_import_reviews add constraint staff_import_reviews_org_staff_fk
  foreign key (organisation_id, imported_staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.staff_pay_arrangements add constraint staff_pay_arrangements_org_staff_fk
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict;
alter table public.staff_qualifications add constraint staff_qualifications_verifier_membership_fk
  foreign key (organisation_id, verified_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;
alter table public.staff_certificates add constraint staff_certificates_verifier_membership_fk
  foreign key (organisation_id, verified_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;
alter table public.staff_central_records add constraint staff_central_records_checker_membership_fk
  foreign key (organisation_id, checked_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;
alter table public.staff_central_record_items add constraint staff_central_record_items_checker_membership_fk
  foreign key (organisation_id, checked_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;
alter table public.staff_reference_checks add constraint staff_reference_checks_checker_membership_fk
  foreign key (organisation_id, checked_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict;

create index staff_qualifications_org_staff_idx on public.staff_qualifications (organisation_id, staff_id) where organisation_id is not null;
create index staff_certificates_org_staff_idx on public.staff_certificates (organisation_id, staff_id) where organisation_id is not null;
create index staff_central_records_org_staff_idx on public.staff_central_records (organisation_id, staff_id) where organisation_id is not null;
create index staff_central_record_items_org_staff_idx on public.staff_central_record_items (organisation_id, staff_id) where organisation_id is not null;
create index staff_reference_checks_org_staff_idx on public.staff_reference_checks (organisation_id, staff_id) where organisation_id is not null;
create index staff_import_reviews_org_idx on public.staff_import_reviews (organisation_id) where organisation_id is not null;
create index staff_pay_arrangements_org_staff_idx on public.staff_pay_arrangements (organisation_id, staff_id, effective_from) where organisation_id is not null;
create index staff_qualifications_verifier_membership_idx on public.staff_qualifications (organisation_id, verified_by_membership_id) where verified_by_membership_id is not null;
create index staff_certificates_verifier_membership_idx on public.staff_certificates (organisation_id, verified_by_membership_id) where verified_by_membership_id is not null;
create index staff_central_records_checker_membership_idx on public.staff_central_records (organisation_id, checked_by_membership_id) where checked_by_membership_id is not null;
create index staff_central_record_items_checker_membership_idx on public.staff_central_record_items (organisation_id, checked_by_membership_id) where checked_by_membership_id is not null;
create index staff_reference_checks_checker_membership_idx on public.staff_reference_checks (organisation_id, checked_by_membership_id) where checked_by_membership_id is not null;

create or replace function private.derive_staff_owned_organisation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_staff_id text;
  staff_organisation_id uuid;
begin
  target_staff_id := to_jsonb(new) ->> tg_argv[0];
  if target_staff_id is null then
    return new;
  end if;

  select profile.organisation_id into staff_organisation_id
  from public.staff_profiles profile where profile.id = target_staff_id;
  if not found then
    raise exception 'staff profile does not exist';
  end if;

  if staff_organisation_id is null then
    if new.organisation_id is not null then
      raise exception 'legacy staff records cannot be assigned commercial organisation ownership';
    end if;
  elsif new.organisation_id is not null and new.organisation_id <> staff_organisation_id then
    raise exception 'staff record organisation does not match the staff profile organisation';
  else
    new.organisation_id := staff_organisation_id;
  end if;
  return new;
end
$$;

revoke all on function private.derive_staff_owned_organisation() from public, anon, authenticated, service_role;

create or replace function private.prevent_customer_record_reparenting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  argument_index integer;
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'customer record organisation ownership is immutable';
  end if;
  if tg_nargs > 0 then
    for argument_index in 0..tg_nargs - 1 loop
      if (to_jsonb(old) -> tg_argv[argument_index]) is distinct from (to_jsonb(new) -> tg_argv[argument_index]) then
        raise exception 'customer record parent ownership is immutable';
      end if;
    end loop;
  end if;
  return new;
end
$$;

revoke all on function private.prevent_customer_record_reparenting() from public, anon, authenticated, service_role;

create trigger staff_qualifications_derive_organisation before insert or update of organisation_id, staff_id
on public.staff_qualifications for each row execute function private.derive_staff_owned_organisation('staff_id');
create trigger staff_certificates_derive_organisation before insert or update of organisation_id, staff_id
on public.staff_certificates for each row execute function private.derive_staff_owned_organisation('staff_id');
create trigger staff_central_records_derive_organisation before insert or update of organisation_id, staff_id
on public.staff_central_records for each row execute function private.derive_staff_owned_organisation('staff_id');
create trigger staff_central_record_items_derive_organisation before insert or update of organisation_id, staff_id
on public.staff_central_record_items for each row execute function private.derive_staff_owned_organisation('staff_id');
create trigger staff_reference_checks_derive_organisation before insert or update of organisation_id, staff_id
on public.staff_reference_checks for each row execute function private.derive_staff_owned_organisation('staff_id');
create trigger staff_import_reviews_derive_organisation before insert or update of organisation_id, imported_staff_id
on public.staff_import_reviews for each row execute function private.derive_staff_owned_organisation('imported_staff_id');
create trigger staff_pay_arrangements_derive_organisation before insert or update of organisation_id, staff_id
on public.staff_pay_arrangements for each row execute function private.derive_staff_owned_organisation('staff_id');

create trigger staff_profiles_prevent_reparenting before update on public.staff_profiles
for each row execute function private.prevent_customer_record_reparenting();
create trigger staff_qualifications_prevent_reparenting before update on public.staff_qualifications
for each row execute function private.prevent_customer_record_reparenting('staff_id');
create trigger staff_certificates_prevent_reparenting before update on public.staff_certificates
for each row execute function private.prevent_customer_record_reparenting('staff_id');
create trigger staff_central_records_prevent_reparenting before update on public.staff_central_records
for each row execute function private.prevent_customer_record_reparenting('staff_id');
create trigger staff_central_record_items_prevent_reparenting before update on public.staff_central_record_items
for each row execute function private.prevent_customer_record_reparenting('staff_id');
create trigger staff_reference_checks_prevent_reparenting before update on public.staff_reference_checks
for each row execute function private.prevent_customer_record_reparenting('staff_id');
create trigger staff_import_reviews_prevent_reparenting before update on public.staff_import_reviews
for each row execute function private.prevent_customer_record_reparenting();
create trigger staff_pay_arrangements_prevent_reparenting before update on public.staff_pay_arrangements
for each row execute function private.prevent_customer_record_reparenting('staff_id');
create trigger staff_site_assignments_prevent_reparenting before update on public.staff_site_assignments
for each row execute function private.prevent_customer_record_reparenting('staff_id', 'site_id');
create trigger organisation_settings_prevent_reparenting before update on public.organisation_settings
for each row execute function private.prevent_customer_record_reparenting();
create trigger site_settings_prevent_reparenting before update on public.site_settings
for each row execute function private.prevent_customer_record_reparenting('site_id');

create or replace function private.can_access_staff(
  target_organisation_id uuid, target_staff_id text, requested_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    private.has_permission(target_organisation_id, requested_permission)
    or exists (
      select 1 from public.staff_site_assignments assignment
      join public.organisation_sites site
        on site.organisation_id = assignment.organisation_id and site.id = assignment.site_id
      where assignment.organisation_id = target_organisation_id
        and assignment.staff_id = target_staff_id
        and assignment.effective_from <= (now() at time zone site.timezone)::date
        and (assignment.effective_to is null or assignment.effective_to >= (now() at time zone site.timezone)::date)
        and private.has_site_permission(target_organisation_id, assignment.site_id, requested_permission)
    )
  )
$$;

create or replace function private.is_linked_staff(target_organisation_id uuid, target_staff_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.organisation_memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.auth_user_id = auth.uid()
      and membership.staff_id = target_staff_id
      and membership.status = 'active'
  )
$$;

revoke all on function private.can_access_staff(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.is_linked_staff(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.can_access_staff(uuid, text, text) to authenticated;
grant execute on function private.is_linked_staff(uuid, text) to authenticated;

drop policy if exists "Managers can manage staff profiles" on public.staff_profiles;
drop policy if exists "Staff can read own basic profile" on public.staff_profiles;
create policy staff_profiles_legacy_manage on public.staff_profiles for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and public.current_staff_role() = 'manager');
create policy staff_profiles_legacy_self_read on public.staff_profiles for select to authenticated
  using (organisation_id is null and id = public.current_staff_profile_id() and active = true);
create policy staff_profiles_commercial_read on public.staff_profiles for select to authenticated
  using (organisation_id is not null and (private.can_access_staff(organisation_id, id, 'staff.read') or private.is_linked_staff(organisation_id, id)));
create policy staff_profiles_commercial_update on public.staff_profiles for update to authenticated
  using (organisation_id is not null and private.can_access_staff(organisation_id, id, 'staff.manage'))
  with check (organisation_id is not null and private.can_access_staff(organisation_id, id, 'staff.manage'));

drop policy if exists "Managers can manage qualifications" on public.staff_qualifications;
drop policy if exists "Staff can read own qualifications" on public.staff_qualifications;
drop policy if exists "Managers can manage certificates" on public.staff_certificates;
drop policy if exists "Staff can read own certificates" on public.staff_certificates;
drop policy if exists "Managers can manage central records" on public.staff_central_records;
drop policy if exists "Managers can manage central record items" on public.staff_central_record_items;
drop policy if exists "Managers can manage reference checks" on public.staff_reference_checks;
drop policy if exists "Managers can manage import reviews" on public.staff_import_reviews;
drop policy if exists "Managers can manage pay arrangements" on public.staff_pay_arrangements;

create policy staff_qualifications_legacy_manage on public.staff_qualifications for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and public.current_staff_role() = 'manager');
create policy staff_qualifications_legacy_self_read on public.staff_qualifications for select to authenticated
  using (organisation_id is null and staff_id = public.current_staff_profile_id() and archived_at is null);
create policy staff_qualifications_commercial_read on public.staff_qualifications for select to authenticated
  using (organisation_id is not null and (private.can_access_staff(organisation_id, staff_id, 'compliance.read') or private.is_linked_staff(organisation_id, staff_id)));
create policy staff_qualifications_commercial_write on public.staff_qualifications for all to authenticated
  using (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'))
  with check (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'));

create policy staff_certificates_legacy_manage on public.staff_certificates for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and public.current_staff_role() = 'manager');
create policy staff_certificates_legacy_self_read on public.staff_certificates for select to authenticated
  using (organisation_id is null and staff_id = public.current_staff_profile_id() and archived_at is null);
create policy staff_certificates_commercial_read on public.staff_certificates for select to authenticated
  using (organisation_id is not null and (private.can_access_staff(organisation_id, staff_id, 'compliance.read') or private.is_linked_staff(organisation_id, staff_id)));
create policy staff_certificates_commercial_write on public.staff_certificates for all to authenticated
  using (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'))
  with check (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'));

create policy staff_central_records_legacy_manage on public.staff_central_records for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and public.current_staff_role() = 'manager');
create policy staff_central_records_commercial_access on public.staff_central_records for all to authenticated
  using (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'))
  with check (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'));
create policy staff_central_record_items_legacy_manage on public.staff_central_record_items for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and public.current_staff_role() = 'manager');
create policy staff_central_record_items_commercial_access on public.staff_central_record_items for all to authenticated
  using (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'))
  with check (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'));
create policy staff_reference_checks_legacy_manage on public.staff_reference_checks for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and public.current_staff_role() = 'manager');
create policy staff_reference_checks_commercial_access on public.staff_reference_checks for all to authenticated
  using (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'))
  with check (organisation_id is not null and private.can_access_staff(organisation_id, staff_id, 'compliance.manage'));
create policy staff_import_reviews_legacy_manage on public.staff_import_reviews for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and public.current_staff_role() = 'manager');
create policy staff_import_reviews_commercial_access on public.staff_import_reviews for all to authenticated
  using (organisation_id is not null and private.has_permission(organisation_id, 'staff.manage'))
  with check (organisation_id is not null and private.has_permission(organisation_id, 'staff.manage'));
create policy staff_pay_arrangements_legacy_manage on public.staff_pay_arrangements for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (
    organisation_id is null
    and public.current_staff_role() = 'manager'
    and created_by is not null
    and updated_by = (public.current_staff_account()).id
  );
create policy staff_pay_arrangements_commercial_read on public.staff_pay_arrangements for select to authenticated
  using (organisation_id is not null and private.has_permission(organisation_id, 'payroll.read'));
create policy staff_pay_arrangements_commercial_write on public.staff_pay_arrangements for all to authenticated
  using (organisation_id is not null and private.has_permission(organisation_id, 'payroll.prepare'))
  with check (organisation_id is not null and private.has_permission(organisation_id, 'payroll.prepare'));

create table public.compliance_modules (
  id text primary key,
  industry public.compliance_module_industry not null,
  display_name text not null check (length(btrim(display_name)) > 0),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.compliance_modules (id, industry, display_name) values
  ('early_years_uk', 'nursery', 'Early Years UK'),
  ('care_uk', 'care_home', 'Care UK'),
  ('clinical_uk', 'clinic', 'Clinical UK'),
  ('education_safeguarding_uk', 'tuition_centre', 'Education Safeguarding UK');

create table public.organisation_compliance_modules (
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  module_id text not null references public.compliance_modules(id) on delete restrict,
  enabled boolean not null default true,
  enabled_by_membership_id uuid not null,
  enabled_at timestamptz not null default now(),
  primary key (organisation_id, module_id),
  foreign key (organisation_id, enabled_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict
);

create table public.compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  site_id uuid,
  module_id text references public.compliance_modules(id) on delete restrict,
  requirement_key text not null,
  display_name text not null check (length(btrim(display_name)) > 0),
  kind public.compliance_requirement_kind not null,
  renewal_months integer check (renewal_months is null or renewal_months > 0),
  required boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, site_id, requirement_key),
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict
);

create table public.staff_credentials (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  staff_id text not null,
  requirement_id uuid,
  credential_type text not null,
  title text not null,
  issued_on date,
  expires_on date,
  evidence_status public.evidence_status not null default 'awaiting',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict,
  foreign key (organisation_id, requirement_id) references public.compliance_requirements(organisation_id, id) on delete restrict,
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create table public.staff_compliance_documents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  staff_id text not null,
  requirement_id uuid,
  document_type text not null,
  display_name text not null,
  private_storage_path text not null check (private_storage_path !~ '^https?://'),
  uploaded_by_membership_id uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict,
  foreign key (organisation_id, requirement_id) references public.compliance_requirements(organisation_id, id) on delete restrict,
  foreign key (organisation_id, uploaded_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict
);

create table public.work_areas (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  site_id uuid not null,
  name text not null check (length(btrim(name)) > 0),
  code text not null check (code = lower(code) and code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  active boolean not null default true,
  operational_settings jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, site_id, code),
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict
);

create table public.site_closures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  site_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  label text not null check (length(btrim(label)) > 0),
  notes text,
  created_by_membership_id uuid not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (ends_on >= starts_on)
);

alter table public.organisation_settings
  add column operating_defaults jsonb not null default '{}'::jsonb,
  add column staffing_defaults jsonb not null default '{}'::jsonb;
alter table public.site_settings
  add column timezone_override text,
  add column work_week_starts_override smallint check (work_week_starts_override between 1 and 7),
  add column operating_overrides jsonb not null default '{}'::jsonb,
  add column staffing_overrides jsonb not null default '{}'::jsonb;

create or replace function public.effective_site_operating_settings(
  target_organisation_id uuid, target_site_id uuid
)
returns table (opening_time text, closing_time text)
language sql stable security invoker set search_path = '' as $$
  select
    coalesce(site.operating_overrides ->> 'openingTime', organisation.operating_defaults ->> 'openingTime', site.opening_time::text),
    coalesce(site.operating_overrides ->> 'closingTime', organisation.operating_defaults ->> 'closingTime', site.closing_time::text)
  from public.organisation_settings organisation
  join public.site_settings site on site.organisation_id = organisation.organisation_id
  where organisation.organisation_id = target_organisation_id and site.site_id = target_site_id
$$;

create table public.staff_import_batches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  site_id uuid not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  request_hash text not null check (length(request_hash) = 32),
  status public.staff_import_batch_status not null default 'previewing',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  created_by_membership_id uuid not null,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, idempotency_key),
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict
);

create table public.staff_import_rows (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  batch_id uuid not null,
  site_id uuid not null,
  source_row text not null,
  external_key text not null,
  proposed_staff_id text not null,
  status public.staff_import_row_status not null,
  input_data jsonb not null,
  normalised_data jsonb not null,
  validation_errors jsonb not null default '[]'::jsonb,
  imported_staff_id text,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, batch_id, external_key),
  foreign key (organisation_id, batch_id) references public.staff_import_batches(organisation_id, id) on delete restrict,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, imported_staff_id) references public.staff_profiles(organisation_id, id) on delete restrict
);

create index compliance_requirements_org_site_idx on public.compliance_requirements (organisation_id, site_id) where archived_at is null;
create unique index compliance_requirements_org_default_key on public.compliance_requirements (organisation_id, requirement_key)
  where site_id is null;
create index staff_credentials_org_staff_idx on public.staff_credentials (organisation_id, staff_id) where archived_at is null;
create index staff_compliance_documents_org_staff_idx on public.staff_compliance_documents (organisation_id, staff_id) where archived_at is null;
create index work_areas_org_site_idx on public.work_areas (organisation_id, site_id) where archived_at is null;
create index site_closures_org_site_dates_idx on public.site_closures (organisation_id, site_id, starts_on, ends_on) where archived_at is null;
create index staff_import_batches_org_site_idx on public.staff_import_batches (organisation_id, site_id, created_at desc);
create index staff_import_rows_batch_idx on public.staff_import_rows (organisation_id, batch_id, status);

create trigger compliance_requirements_touch_updated_at before update on public.compliance_requirements
for each row execute function private.touch_updated_at();
create trigger staff_credentials_touch_updated_at before update on public.staff_credentials
for each row execute function private.touch_updated_at();
create trigger work_areas_touch_updated_at before update on public.work_areas
for each row execute function private.touch_updated_at();
create trigger site_closures_touch_updated_at before update on public.site_closures
for each row execute function private.touch_updated_at();
create trigger staff_import_batches_touch_updated_at before update on public.staff_import_batches
for each row execute function private.touch_updated_at();

create trigger organisation_compliance_modules_prevent_reparenting before update on public.organisation_compliance_modules
for each row execute function private.prevent_customer_record_reparenting('module_id');
create trigger compliance_requirements_prevent_reparenting before update on public.compliance_requirements
for each row execute function private.prevent_customer_record_reparenting('site_id', 'module_id');
create trigger staff_credentials_prevent_reparenting before update on public.staff_credentials
for each row execute function private.prevent_customer_record_reparenting('staff_id', 'requirement_id');
create trigger staff_compliance_documents_prevent_reparenting before update on public.staff_compliance_documents
for each row execute function private.prevent_customer_record_reparenting('staff_id', 'requirement_id');
create trigger work_areas_prevent_reparenting before update on public.work_areas
for each row execute function private.prevent_customer_record_reparenting('site_id');
create trigger site_closures_prevent_reparenting before update on public.site_closures
for each row execute function private.prevent_customer_record_reparenting('site_id');
create trigger staff_import_batches_prevent_reparenting before update on public.staff_import_batches
for each row execute function private.prevent_customer_record_reparenting('site_id', 'idempotency_key', 'request_hash');
create trigger staff_import_rows_prevent_reparenting before update on public.staff_import_rows
for each row execute function private.prevent_customer_record_reparenting('batch_id', 'site_id', 'external_key', 'proposed_staff_id');

alter table public.compliance_modules enable row level security;
alter table public.organisation_compliance_modules enable row level security;
alter table public.compliance_requirements enable row level security;
alter table public.staff_credentials enable row level security;
alter table public.staff_compliance_documents enable row level security;
alter table public.work_areas enable row level security;
alter table public.site_closures enable row level security;
alter table public.staff_import_batches enable row level security;
alter table public.staff_import_rows enable row level security;

revoke all on public.compliance_modules, public.organisation_compliance_modules,
  public.compliance_requirements, public.staff_credentials, public.staff_compliance_documents,
  public.work_areas, public.site_closures, public.staff_import_batches, public.staff_import_rows from anon, authenticated;
grant select on public.compliance_modules to authenticated;
grant select, insert, update on public.organisation_compliance_modules, public.compliance_requirements,
  public.staff_credentials, public.staff_compliance_documents, public.work_areas, public.site_closures,
  public.staff_import_batches, public.staff_import_rows to authenticated;
revoke insert, update, delete on public.staff_import_batches, public.staff_import_rows from authenticated;
grant select, insert, update, delete on public.compliance_modules, public.organisation_compliance_modules,
  public.compliance_requirements, public.staff_credentials, public.staff_compliance_documents,
  public.work_areas, public.site_closures, public.staff_import_batches, public.staff_import_rows to service_role;

create policy compliance_modules_read on public.compliance_modules for select to authenticated using (true);
create policy organisation_compliance_modules_read on public.organisation_compliance_modules for select to authenticated
  using (private.has_permission(organisation_id, 'compliance.read'));
create policy organisation_compliance_modules_write on public.organisation_compliance_modules for all to authenticated
  using (private.has_permission(organisation_id, 'compliance.manage'))
  with check (private.has_permission(organisation_id, 'compliance.manage'));
create policy compliance_requirements_read on public.compliance_requirements for select to authenticated
  using ((site_id is null and private.has_permission(organisation_id, 'compliance.read'))
    or (site_id is not null and private.has_site_permission(organisation_id, site_id, 'compliance.read')));
create policy compliance_requirements_write on public.compliance_requirements for all to authenticated
  using ((site_id is null and private.has_permission(organisation_id, 'compliance.manage'))
    or (site_id is not null and private.has_site_permission(organisation_id, site_id, 'compliance.manage')))
  with check ((site_id is null and private.has_permission(organisation_id, 'compliance.manage'))
    or (site_id is not null and private.has_site_permission(organisation_id, site_id, 'compliance.manage')));
create policy staff_credentials_read on public.staff_credentials for select to authenticated
  using (private.can_access_staff(organisation_id, staff_id, 'compliance.read') or private.is_linked_staff(organisation_id, staff_id));
create policy staff_credentials_write on public.staff_credentials for all to authenticated
  using (private.can_access_staff(organisation_id, staff_id, 'compliance.manage'))
  with check (private.can_access_staff(organisation_id, staff_id, 'compliance.manage'));
create policy staff_compliance_documents_access on public.staff_compliance_documents for all to authenticated
  using (private.can_access_staff(organisation_id, staff_id, 'compliance.manage'))
  with check (private.can_access_staff(organisation_id, staff_id, 'compliance.manage'));
create policy work_areas_read on public.work_areas for select to authenticated
  using (private.has_site_permission(organisation_id, site_id, 'site.read'));
create policy work_areas_write on public.work_areas for all to authenticated
  using (private.has_site_permission(organisation_id, site_id, 'site.manage'))
  with check (private.has_site_permission(organisation_id, site_id, 'site.manage'));
create policy site_closures_read on public.site_closures for select to authenticated
  using (private.has_site_permission(organisation_id, site_id, 'site.read'));
create policy site_closures_write on public.site_closures for all to authenticated
  using (private.has_site_permission(organisation_id, site_id, 'site.manage'))
  with check (private.has_site_permission(organisation_id, site_id, 'site.manage'));
create policy staff_import_batches_read on public.staff_import_batches for select to authenticated
  using (private.has_site_permission(organisation_id, site_id, 'staff.manage'));
create policy staff_import_rows_read on public.staff_import_rows for select to authenticated
  using (private.has_site_permission(organisation_id, site_id, 'staff.manage'));

create or replace function public.create_commercial_staff_profile(
  target_organisation_id uuid,
  target_site_id uuid,
  target_full_name text,
  target_display_name text,
  target_employment_role text,
  target_effective_from date,
  target_primary_site boolean default true
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  created_staff_id text := 'staff-' || gen_random_uuid()::text;
  membership_id uuid;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'staff.manage') then
    raise exception 'staff creation is not authorised';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if btrim(target_full_name) = '' or btrim(target_display_name) = '' or btrim(target_employment_role) = '' then
    raise exception 'staff identity fields are required';
  end if;
  membership_id := private.current_membership_id(target_organisation_id);

  insert into public.staff_profiles (id, organisation_id, full_name, display_name, employment_role, active)
  values (created_staff_id, target_organisation_id, btrim(target_full_name), btrim(target_display_name), btrim(target_employment_role), true);
  insert into public.staff_site_assignments (
    organisation_id, staff_id, site_id, effective_from, is_primary, employment_role, created_by_membership_id
  ) values (
    target_organisation_id, created_staff_id, target_site_id, target_effective_from,
    target_primary_site, btrim(target_employment_role), membership_id
  );
  return created_staff_id;
end
$$;

create or replace function public.preview_staff_import_batch(
  target_organisation_id uuid,
  target_site_id uuid,
  target_idempotency_key text,
  input_rows jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  created_batch_id uuid;
  existing_site_id uuid;
  existing_request_hash text;
  submitted_request_hash text := md5(input_rows::text);
  membership_id uuid;
  input_row jsonb;
  row_errors jsonb;
  external_key text;
  proposed_staff_id text;
  declared_site_id text;
  normalised_email text;
  effective_from_text text;
  primary_site boolean;
begin
  if auth.uid() is null or not private.has_site_permission(target_organisation_id, target_site_id, 'staff.manage') then
    raise exception 'staff import is not authorised';
  end if;
  if jsonb_typeof(input_rows) <> 'array' or jsonb_array_length(input_rows) = 0 then
    raise exception 'staff import requires at least one row';
  end if;

  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception 'staff import requires an idempotency key';
  end if;

  membership_id := private.current_membership_id(target_organisation_id);
  insert into public.staff_import_batches (organisation_id, site_id, idempotency_key, request_hash, created_by_membership_id)
  values (target_organisation_id, target_site_id, btrim(target_idempotency_key), submitted_request_hash, membership_id)
  on conflict (organisation_id, idempotency_key) do nothing
  returning id into created_batch_id;

  if created_batch_id is null then
    select existing.id, existing.site_id, existing.request_hash
      into created_batch_id, existing_site_id, existing_request_hash
    from public.staff_import_batches existing
    where existing.organisation_id = target_organisation_id and existing.idempotency_key = btrim(target_idempotency_key);
    if existing_site_id <> target_site_id then raise exception 'staff import idempotency key belongs to another site'; end if;
    if existing_request_hash <> submitted_request_hash then raise exception 'staff import idempotency key belongs to another payload'; end if;
    return created_batch_id;
  end if;

  for input_row in select value from jsonb_array_elements(input_rows)
  loop
    external_key := btrim(coalesce(input_row ->> 'externalKey', ''));
    proposed_staff_id := 'import-' || substr(md5(target_organisation_id::text || ':' || lower(external_key)), 1, 24);
    declared_site_id := btrim(coalesce(input_row ->> 'siteId', ''));
    normalised_email := lower(nullif(btrim(coalesce(input_row ->> 'email', '')), ''));
    row_errors := '[]'::jsonb;
    if external_key = '' then row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'externalKey', 'code', 'missing_required_value')); end if;
    if external_key <> '' and exists (
      select 1 from public.staff_profiles profile
      where profile.organisation_id = target_organisation_id and profile.id = proposed_staff_id
    ) then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'externalKey', 'code', 'duplicate_staff'));
    end if;
    if btrim(coalesce(input_row ->> 'fullName', '')) = '' then row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'fullName', 'code', 'missing_required_value')); end if;
    if btrim(coalesce(input_row ->> 'employmentRole', '')) = '' then row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'employmentRole', 'code', 'missing_required_value')); end if;
    if declared_site_id = '' then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'siteId', 'code', 'missing_required_value'));
    elsif declared_site_id <> target_site_id::text then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'siteId', 'code', 'site_not_permitted'));
    end if;
    if normalised_email is not null and normalised_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'email', 'code', 'invalid_email'));
    elsif normalised_email is not null and exists (
      select 1 from public.staff_profiles profile
      where profile.organisation_id = target_organisation_id and lower(profile.email) = normalised_email
    ) then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'email', 'code', 'duplicate_email'));
    elsif normalised_email is not null and exists (
      select 1 from public.staff_import_rows prior_row
      where prior_row.organisation_id = target_organisation_id
        and prior_row.batch_id = created_batch_id
        and lower(prior_row.normalised_data ->> 'email') = normalised_email
    ) then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'email', 'code', 'duplicate_email'));
    end if;
    effective_from_text := input_row ->> 'effectiveFrom';
    if effective_from_text is null or effective_from_text !~ '^\d{4}-\d{2}-\d{2}$' then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'effectiveFrom', 'code', 'invalid_date'));
    else
      begin
        perform effective_from_text::date;
      exception when others then
        row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'effectiveFrom', 'code', 'invalid_date'));
      end;
    end if;
    primary_site := false;
    if input_row ? 'primarySite' and jsonb_typeof(input_row -> 'primarySite') not in ('boolean', 'null') then
      row_errors := row_errors || jsonb_build_array(jsonb_build_object('field', 'primarySite', 'code', 'invalid_boolean'));
    elsif jsonb_typeof(input_row -> 'primarySite') = 'boolean' then
      primary_site := (input_row ->> 'primarySite')::boolean;
    end if;

    insert into public.staff_import_rows (
      organisation_id, batch_id, site_id, source_row, external_key, proposed_staff_id,
      status, input_data, normalised_data, validation_errors
    ) values (
      target_organisation_id, created_batch_id, target_site_id, coalesce(input_row ->> 'sourceRow', ''), external_key,
      proposed_staff_id, case when jsonb_array_length(row_errors) = 0 then 'valid'::public.staff_import_row_status else 'invalid'::public.staff_import_row_status end,
      input_row,
      jsonb_build_object(
        'fullName', btrim(coalesce(input_row ->> 'fullName', '')),
        'displayName', coalesce(nullif(btrim(input_row ->> 'displayName'), ''), split_part(btrim(coalesce(input_row ->> 'fullName', '')), ' ', 1)),
        'employmentRole', btrim(coalesce(input_row ->> 'employmentRole', '')),
        'siteId', declared_site_id,
        'email', normalised_email,
        'effectiveFrom', input_row ->> 'effectiveFrom',
        'primarySite', primary_site
      ),
      row_errors
    );
  end loop;

  update public.staff_import_batches batch set
    total_rows = counts.total_rows,
    valid_rows = counts.valid_rows,
    invalid_rows = counts.invalid_rows,
    status = case when counts.invalid_rows = 0 then 'preview_ready'::public.staff_import_batch_status else 'invalid'::public.staff_import_batch_status end
  from (
    select count(*)::integer total_rows,
      count(*) filter (where status = 'valid')::integer valid_rows,
      count(*) filter (where status = 'invalid')::integer invalid_rows
    from public.staff_import_rows where organisation_id = target_organisation_id and staff_import_rows.batch_id = created_batch_id
  ) counts where batch.id = created_batch_id;
  return created_batch_id;
exception when unique_violation then
  raise exception 'staff import contains duplicate external keys';
end
$$;

create or replace function public.commit_staff_import_batch(target_batch_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  batch public.staff_import_batches%rowtype;
  import_row public.staff_import_rows%rowtype;
  committed_count integer := 0;
begin
  select * into batch from public.staff_import_batches where id = target_batch_id for update;
  if not found then raise exception 'staff import batch does not exist'; end if;
  if auth.uid() is null or not private.has_site_permission(batch.organisation_id, batch.site_id, 'staff.manage') then
    raise exception 'staff import is not authorised';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if batch.status = 'committed' then return batch.valid_rows; end if;
  if batch.status <> 'preview_ready' or batch.invalid_rows <> 0 then raise exception 'staff import batch is not ready'; end if;

  for import_row in select * from public.staff_import_rows
    where organisation_id = batch.organisation_id and batch_id = batch.id order by source_row, id
  loop
    insert into public.staff_profiles (
      id, organisation_id, full_name, display_name, employment_role, email, active
    ) values (
      import_row.proposed_staff_id,
      batch.organisation_id,
      import_row.normalised_data ->> 'fullName',
      import_row.normalised_data ->> 'displayName',
      import_row.normalised_data ->> 'employmentRole',
      import_row.normalised_data ->> 'email',
      true
    );
    insert into public.staff_site_assignments (
      organisation_id, staff_id, site_id, effective_from, is_primary, employment_role, created_by_membership_id
    ) values (
      batch.organisation_id, import_row.proposed_staff_id, batch.site_id,
      (import_row.normalised_data ->> 'effectiveFrom')::date,
      coalesce((import_row.normalised_data ->> 'primarySite')::boolean, false),
      import_row.normalised_data ->> 'employmentRole', batch.created_by_membership_id
    );
    update public.staff_import_rows set status = 'committed', imported_staff_id = proposed_staff_id
      where organisation_id = import_row.organisation_id and id = import_row.id;
    committed_count := committed_count + 1;
  end loop;
  update public.staff_import_batches set status = 'committed', committed_at = now() where id = batch.id;
  return committed_count;
end
$$;

revoke all on function public.preview_staff_import_batch(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.commit_staff_import_batch(uuid) from public, anon;
revoke all on function public.create_commercial_staff_profile(uuid, uuid, text, text, text, date, boolean) from public, anon;
revoke all on function public.effective_site_operating_settings(uuid, uuid) from public, anon;
grant execute on function public.preview_staff_import_batch(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.commit_staff_import_batch(uuid) to authenticated;
grant execute on function public.create_commercial_staff_profile(uuid, uuid, text, text, text, date, boolean) to authenticated;
grant execute on function public.effective_site_operating_settings(uuid, uuid) to authenticated;
