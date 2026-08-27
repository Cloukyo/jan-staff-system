-- Commercial Workstream 2: additive tenant primitives only.
create type public.organisation_status as enum ('trial', 'active', 'past_due', 'suspended', 'offboarding', 'closed');
create type public.organisation_membership_status as enum ('invited', 'active', 'suspended', 'revoked');
create type public.organisation_role as enum ('organisation_owner', 'organisation_admin', 'hr_admin', 'payroll_admin', 'site_manager', 'scheduler', 'staff');
create type public.membership_scope_type as enum ('organisation', 'site');
create type public.organisation_invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create schema if not exists private;
revoke all on schema private from public;

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(btrim(legal_name)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status public.organisation_status not null default 'trial',
  country_code text not null default 'GB' check (country_code ~ '^[A-Z]{2}$'),
  timezone text not null default 'Europe/London',
  billing_email text check (billing_email is null or billing_email = lower(billing_email)),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisation_sites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'Europe/London',
  active boolean not null default true,
  address_line_1 text,
  address_line_2 text,
  locality text,
  postcode text,
  phone text,
  email text check (email is null or email = lower(email)),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, slug)
);

alter table public.staff_profiles
  add column organisation_id uuid references public.organisations(id) on delete restrict;
alter table public.staff_profiles
  add constraint staff_profiles_organisation_id_id_key unique (organisation_id, id);

create table public.organisation_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  staff_id text,
  status public.organisation_membership_status not null default 'invited',
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, auth_user_id),
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict,
  check ((status = 'active' and joined_at is not null) or status <> 'active'),
  check ((status = 'suspended' and suspended_at is not null) or status <> 'suspended'),
  check ((status = 'revoked' and revoked_at is not null) or status <> 'revoked')
);
alter table public.organisation_memberships
  add constraint organisation_memberships_creator_fk foreign key (organisation_id, created_by_membership_id)
  references public.organisation_memberships(organisation_id, id) on delete restrict deferrable initially deferred;

create table public.membership_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  membership_id uuid not null,
  role public.organisation_role not null,
  scope_type public.membership_scope_type not null,
  site_id uuid,
  granted_by_membership_id uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organisation_id, id),
  foreign key (organisation_id, membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, granted_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  check ((scope_type = 'organisation' and site_id is null) or (scope_type = 'site' and site_id is not null))
);

create table public.membership_site_access (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  membership_id uuid not null,
  site_id uuid not null,
  granted_by_membership_id uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organisation_id, id),
  foreign key (organisation_id, membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, granted_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict
);

create table public.staff_site_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  staff_id text not null,
  site_id uuid not null,
  effective_from date not null,
  effective_to date,
  is_primary boolean not null default false,
  employment_role text,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from)
);

create table public.organisation_settings (
  organisation_id uuid primary key references public.organisations(id) on delete restrict,
  work_week_starts smallint not null default 1 check (work_week_starts between 1 and 7),
  default_timezone text not null default 'Europe/London',
  branding jsonb not null default '{}'::jsonb,
  compliance_policy jsonb not null default '{}'::jsonb,
  pay_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.site_settings (
  organisation_id uuid not null,
  site_id uuid not null,
  opening_time time,
  closing_time time,
  closure_dates date[] not null default '{}',
  rota_policy jsonb not null default '{}'::jsonb,
  kiosk_policy jsonb not null default '{}'::jsonb,
  local_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organisation_id, site_id),
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict
);

create table public.organisation_invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  invited_email text not null check (invited_email = lower(invited_email)),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status public.organisation_invitation_status not null default 'pending',
  expires_at timestamptz not null,
  invited_by_membership_id uuid not null,
  accepted_by_membership_id uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  terms_version text,
  privacy_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, invited_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  foreign key (organisation_id, accepted_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (expires_at > created_at)
);

create table public.organisation_invitation_roles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  invitation_id uuid not null,
  role public.organisation_role not null,
  scope_type public.membership_scope_type not null,
  site_id uuid,
  foreign key (organisation_id, invitation_id) references public.organisation_invitations(organisation_id, id) on delete cascade,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  unique (organisation_id, invitation_id, role, scope_type, site_id),
  check ((scope_type = 'organisation' and site_id is null) or (scope_type = 'site' and site_id is not null))
);

create table public.organisation_invitation_site_access (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  invitation_id uuid not null,
  site_id uuid not null,
  foreign key (organisation_id, invitation_id) references public.organisation_invitations(organisation_id, id) on delete cascade,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  unique (organisation_id, invitation_id, site_id)
);

create unique index membership_role_assignments_active_key on public.membership_role_assignments
  (organisation_id, membership_id, role, scope_type, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) where revoked_at is null;
create unique index membership_site_access_active_key on public.membership_site_access (organisation_id, membership_id, site_id) where revoked_at is null;
create unique index organisation_invitations_pending_email_key on public.organisation_invitations (organisation_id, invited_email) where status = 'pending';
create index organisation_memberships_auth_active_idx on public.organisation_memberships (auth_user_id, organisation_id) where status = 'active';
create index membership_role_assignments_lookup_idx on public.membership_role_assignments (organisation_id, membership_id, role, scope_type, site_id) where revoked_at is null;
create index membership_site_access_lookup_idx on public.membership_site_access (organisation_id, membership_id, site_id) where revoked_at is null;
create index staff_profiles_organisation_idx on public.staff_profiles (organisation_id, id) where organisation_id is not null;
create index staff_site_assignments_staff_idx on public.staff_site_assignments (organisation_id, staff_id, effective_from, effective_to);
create index staff_site_assignments_site_idx on public.staff_site_assignments (organisation_id, site_id, effective_from, effective_to);
create index organisation_invitation_roles_org_idx on public.organisation_invitation_roles (organisation_id, invitation_id);
create unique index organisation_invitation_roles_unique_scope_idx on public.organisation_invitation_roles
  (organisation_id, invitation_id, role, scope_type, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index organisation_invitation_site_access_org_idx on public.organisation_invitation_site_access (organisation_id, invitation_id, site_id);

create table private.role_permissions (
  role public.organisation_role not null,
  permission text not null,
  primary key (role, permission)
);
revoke all on private.role_permissions from public, anon, authenticated;

insert into private.role_permissions (role, permission)
select 'organisation_owner'::public.organisation_role, permission
from unnest(array[
  'organisation.manage','organisation.audit.read','billing.manage','membership.read','membership.manage',
  'site.read','site.manage','staff.read','staff.manage','compliance.read','compliance.manage','leave.read',
  'leave.manage','rota.read','rota.manage','attendance.read','attendance.review','attendance.correct',
  'payroll.read','payroll.prepare','payroll.export','kiosk.read','kiosk.manage','settings.manage'
]) as permission;

insert into private.role_permissions (role, permission) values
  ('organisation_admin','organisation.audit.read'), ('organisation_admin','membership.read'),
  ('organisation_admin','membership.manage'), ('organisation_admin','site.read'), ('organisation_admin','site.manage'),
  ('organisation_admin','staff.read'), ('organisation_admin','staff.manage'), ('organisation_admin','compliance.read'),
  ('organisation_admin','leave.read'), ('organisation_admin','leave.manage'), ('organisation_admin','rota.read'),
  ('organisation_admin','rota.manage'), ('organisation_admin','attendance.read'), ('organisation_admin','attendance.review'),
  ('organisation_admin','attendance.correct'), ('organisation_admin','payroll.read'), ('organisation_admin','kiosk.read'),
  ('organisation_admin','kiosk.manage'), ('organisation_admin','settings.manage'),
  ('hr_admin','site.read'), ('hr_admin','staff.read'), ('hr_admin','staff.manage'),
  ('hr_admin','compliance.read'), ('hr_admin','compliance.manage'), ('hr_admin','leave.read'), ('hr_admin','leave.manage'),
  ('payroll_admin','site.read'), ('payroll_admin','staff.read'), ('payroll_admin','attendance.read'),
  ('payroll_admin','attendance.review'), ('payroll_admin','payroll.read'), ('payroll_admin','payroll.prepare'),
  ('payroll_admin','payroll.export'),
  ('site_manager','site.read'), ('site_manager','site.manage'), ('site_manager','staff.read'),
  ('site_manager','staff.manage'), ('site_manager','leave.read'), ('site_manager','leave.manage'),
  ('site_manager','rota.read'), ('site_manager','rota.manage'), ('site_manager','attendance.read'),
  ('site_manager','attendance.review'), ('site_manager','attendance.correct'), ('site_manager','kiosk.read'),
  ('site_manager','kiosk.manage'), ('site_manager','settings.manage'),
  ('scheduler','site.read'), ('scheduler','staff.read'), ('scheduler','leave.read'),
  ('scheduler','rota.read'), ('scheduler','rota.manage');

create or replace function private.current_membership_id(target_organisation_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id
  from public.organisation_memberships m
  where auth.uid() is not null
    and m.organisation_id = target_organisation_id
    and m.auth_user_id = auth.uid()
    and m.status = 'active'
  limit 1
$$;

create or replace function private.current_membership(target_organisation_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select private.current_membership_id(target_organisation_id)
$$;

create or replace function private.is_active_member(target_organisation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_membership_id(target_organisation_id) is not null
$$;

create or replace function private.has_permission(target_organisation_id uuid, requested_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1
    from public.organisation_memberships m
    join public.membership_role_assignments a
      on a.organisation_id = m.organisation_id and a.membership_id = m.id
    join private.role_permissions p on p.role = a.role and p.permission = requested_permission
    where m.organisation_id = target_organisation_id and m.auth_user_id = auth.uid()
      and m.status = 'active' and a.revoked_at is null
      and a.scope_type = 'organisation' and a.site_id is null
  )
$$;

create or replace function private.has_site_permission(
  target_organisation_id uuid, target_site_id uuid, requested_permission text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.organisation_sites s
      where s.organisation_id = target_organisation_id and s.id = target_site_id
        and s.active and s.archived_at is null
    )
    and exists (
      select 1
      from public.organisation_memberships m
      join public.membership_role_assignments a
        on a.organisation_id = m.organisation_id and a.membership_id = m.id
      join private.role_permissions p on p.role = a.role and p.permission = requested_permission
      where m.organisation_id = target_organisation_id and m.auth_user_id = auth.uid()
        and m.status = 'active' and a.revoked_at is null
        and (
          (a.scope_type = 'organisation' and a.site_id is null)
          or (
            a.scope_type = 'site' and a.site_id = target_site_id
            and exists (
              select 1 from public.membership_site_access access
              where access.organisation_id = m.organisation_id and access.membership_id = m.id
                and access.site_id = target_site_id and access.revoked_at is null
            )
          )
        )
    )
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function private.prevent_primary_site_overlap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_primary and exists (
    select 1 from public.staff_site_assignments existing
    where existing.organisation_id = new.organisation_id and existing.staff_id = new.staff_id
      and existing.is_primary and existing.id <> new.id
      and daterange(existing.effective_from, coalesce(existing.effective_to + 1, 'infinity'::date), '[)')
          && daterange(new.effective_from, coalesce(new.effective_to + 1, 'infinity'::date), '[)')
  ) then
    raise exception 'primary site assignment overlaps an existing assignment';
  end if;
  return new;
end
$$;

create or replace function private.protect_last_organisation_owner_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'active' and new.status <> 'active' and exists (
    select 1 from public.membership_role_assignments a
    where a.organisation_id = old.organisation_id and a.membership_id = old.id
      and a.role = 'organisation_owner' and a.scope_type = 'organisation' and a.revoked_at is null
  ) and not exists (
    select 1 from public.organisation_memberships m
    join public.membership_role_assignments a
      on a.organisation_id = m.organisation_id and a.membership_id = m.id
    where m.organisation_id = old.organisation_id and m.id <> old.id and m.status = 'active'
      and a.role = 'organisation_owner' and a.scope_type = 'organisation' and a.revoked_at is null
  ) then
    raise exception 'last active organisation owner cannot be suspended or revoked';
  end if;
  return new;
end
$$;

create or replace function private.protect_last_organisation_owner_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'organisation_owner' and old.scope_type = 'organisation' and old.revoked_at is null
     and (tg_op = 'DELETE' or new.role <> 'organisation_owner' or new.scope_type <> 'organisation' or new.revoked_at is not null)
     and exists (select 1 from public.organisation_memberships m where m.organisation_id = old.organisation_id and m.id = old.membership_id and m.status = 'active')
     and not exists (
       select 1 from public.membership_role_assignments a
       join public.organisation_memberships m on m.organisation_id = a.organisation_id and m.id = a.membership_id
       where a.organisation_id = old.organisation_id and a.id <> old.id and a.role = 'organisation_owner'
         and a.scope_type = 'organisation' and a.revoked_at is null and m.status = 'active'
     ) then
    raise exception 'last active organisation owner role cannot be removed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger staff_site_assignments_prevent_primary_overlap before insert or update on public.staff_site_assignments
for each row execute function private.prevent_primary_site_overlap();
create trigger organisation_memberships_protect_last_owner before update of status on public.organisation_memberships
for each row execute function private.protect_last_organisation_owner_membership();
create trigger membership_roles_protect_last_owner before update or delete on public.membership_role_assignments
for each row execute function private.protect_last_organisation_owner_role();

create trigger organisations_touch_updated_at before update on public.organisations for each row execute function private.touch_updated_at();
create trigger organisation_sites_touch_updated_at before update on public.organisation_sites for each row execute function private.touch_updated_at();
create trigger organisation_memberships_touch_updated_at before update on public.organisation_memberships for each row execute function private.touch_updated_at();
create trigger staff_site_assignments_touch_updated_at before update on public.staff_site_assignments for each row execute function private.touch_updated_at();
create trigger organisation_settings_touch_updated_at before update on public.organisation_settings for each row execute function private.touch_updated_at();
create trigger site_settings_touch_updated_at before update on public.site_settings for each row execute function private.touch_updated_at();
create trigger organisation_invitations_touch_updated_at before update on public.organisation_invitations for each row execute function private.touch_updated_at();

revoke execute on function private.current_membership_id(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.current_membership(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.is_active_member(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.has_permission(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.has_site_permission(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function private.touch_updated_at() from public, anon, authenticated, service_role;
revoke execute on function private.prevent_primary_site_overlap() from public, anon, authenticated, service_role;
revoke execute on function private.protect_last_organisation_owner_membership() from public, anon, authenticated, service_role;
revoke execute on function private.protect_last_organisation_owner_role() from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.current_membership_id(uuid), private.current_membership(uuid), private.is_active_member(uuid),
  private.has_permission(uuid, text), private.has_site_permission(uuid, uuid, text) to authenticated;

alter table public.organisations enable row level security;
alter table public.organisation_sites enable row level security;
alter table public.organisation_memberships enable row level security;
alter table public.membership_role_assignments enable row level security;
alter table public.membership_site_access enable row level security;
alter table public.staff_site_assignments enable row level security;
alter table public.organisation_settings enable row level security;
alter table public.site_settings enable row level security;
alter table public.organisation_invitations enable row level security;
alter table public.organisation_invitation_roles enable row level security;
alter table public.organisation_invitation_site_access enable row level security;

revoke all on public.organisations, public.organisation_sites, public.organisation_memberships,
  public.membership_role_assignments, public.membership_site_access, public.staff_site_assignments,
  public.organisation_settings, public.site_settings, public.organisation_invitations,
  public.organisation_invitation_roles, public.organisation_invitation_site_access from anon, authenticated;
grant select on public.organisations, public.organisation_sites, public.organisation_memberships,
  public.membership_role_assignments, public.membership_site_access, public.staff_site_assignments,
  public.organisation_settings, public.site_settings, public.organisation_invitations,
  public.organisation_invitation_roles, public.organisation_invitation_site_access to authenticated;
grant insert, update on public.organisation_sites, public.organisation_memberships,
  public.membership_role_assignments, public.membership_site_access, public.staff_site_assignments,
  public.organisation_settings, public.site_settings, public.organisation_invitations,
  public.organisation_invitation_roles, public.organisation_invitation_site_access to authenticated;
grant update on public.organisations to authenticated;

create policy organisations_select on public.organisations for select to authenticated
using ((select private.is_active_member(id)));
create policy organisations_update on public.organisations for update to authenticated
using ((select private.has_permission(id, 'organisation.manage')))
with check ((select private.has_permission(id, 'organisation.manage')));

create policy organisation_sites_select on public.organisation_sites for select to authenticated
using ((select private.has_site_permission(organisation_id, id, 'site.read')));
create policy organisation_sites_insert on public.organisation_sites for insert to authenticated
with check ((select private.has_permission(organisation_id, 'site.manage')));
create policy organisation_sites_update on public.organisation_sites for update to authenticated
using ((select private.has_site_permission(organisation_id, id, 'site.manage')))
with check ((select private.has_site_permission(organisation_id, id, 'site.manage')));

create policy organisation_memberships_select on public.organisation_memberships for select to authenticated
using (auth_user_id = (select auth.uid()) or (select private.has_permission(organisation_id, 'membership.read')));
create policy organisation_memberships_insert on public.organisation_memberships for insert to authenticated
with check ((select private.has_permission(organisation_id, 'membership.manage')));
create policy organisation_memberships_update on public.organisation_memberships for update to authenticated
using ((select private.has_permission(organisation_id, 'membership.manage')))
with check ((select private.has_permission(organisation_id, 'membership.manage')));

create policy membership_role_assignments_select on public.membership_role_assignments for select to authenticated
using (membership_id = (select private.current_membership_id(organisation_id)) or (select private.has_permission(organisation_id, 'membership.read')));
create policy membership_role_assignments_insert on public.membership_role_assignments for insert to authenticated
with check ((select private.has_permission(organisation_id, 'membership.manage'))
  and (role <> 'organisation_owner' or (select private.has_permission(organisation_id, 'billing.manage'))));
create policy membership_role_assignments_update on public.membership_role_assignments for update to authenticated
using ((select private.has_permission(organisation_id, 'membership.manage')))
with check ((select private.has_permission(organisation_id, 'membership.manage'))
  and (role <> 'organisation_owner' or (select private.has_permission(organisation_id, 'billing.manage'))));

create policy membership_site_access_select on public.membership_site_access for select to authenticated
using (membership_id = (select private.current_membership_id(organisation_id)) or (select private.has_permission(organisation_id, 'membership.read')));
create policy membership_site_access_insert on public.membership_site_access for insert to authenticated
with check ((select private.has_permission(organisation_id, 'membership.manage')));
create policy membership_site_access_update on public.membership_site_access for update to authenticated
using ((select private.has_permission(organisation_id, 'membership.manage')))
with check ((select private.has_permission(organisation_id, 'membership.manage')));

create policy staff_site_assignments_select on public.staff_site_assignments for select to authenticated
using ((select private.has_site_permission(organisation_id, site_id, 'staff.read')));
create policy staff_site_assignments_insert on public.staff_site_assignments for insert to authenticated
with check ((select private.has_site_permission(organisation_id, site_id, 'staff.manage')));
create policy staff_site_assignments_update on public.staff_site_assignments for update to authenticated
using ((select private.has_site_permission(organisation_id, site_id, 'staff.manage')))
with check ((select private.has_site_permission(organisation_id, site_id, 'staff.manage')));

create policy organisation_settings_select on public.organisation_settings for select to authenticated
using ((select private.is_active_member(organisation_id)));
create policy organisation_settings_insert on public.organisation_settings for insert to authenticated
with check ((select private.has_permission(organisation_id, 'settings.manage')));
create policy organisation_settings_update on public.organisation_settings for update to authenticated
using ((select private.has_permission(organisation_id, 'settings.manage')))
with check ((select private.has_permission(organisation_id, 'settings.manage')));

create policy site_settings_select on public.site_settings for select to authenticated
using ((select private.has_site_permission(organisation_id, site_id, 'site.read')));
create policy site_settings_insert on public.site_settings for insert to authenticated
with check ((select private.has_site_permission(organisation_id, site_id, 'settings.manage')));
create policy site_settings_update on public.site_settings for update to authenticated
using ((select private.has_site_permission(organisation_id, site_id, 'settings.manage')))
with check ((select private.has_site_permission(organisation_id, site_id, 'settings.manage')));

create policy organisation_invitations_select on public.organisation_invitations for select to authenticated
using ((select private.has_permission(organisation_id, 'membership.read')));
create policy organisation_invitations_insert on public.organisation_invitations for insert to authenticated
with check ((select private.has_permission(organisation_id, 'membership.manage')));
create policy organisation_invitations_update on public.organisation_invitations for update to authenticated
using ((select private.has_permission(organisation_id, 'membership.manage')))
with check ((select private.has_permission(organisation_id, 'membership.manage')));

create policy organisation_invitation_roles_select on public.organisation_invitation_roles for select to authenticated
using ((select private.has_permission(organisation_id, 'membership.read')));
create policy organisation_invitation_roles_insert on public.organisation_invitation_roles for insert to authenticated
with check ((select private.has_permission(organisation_id, 'membership.manage'))
  and (role <> 'organisation_owner' or (select private.has_permission(organisation_id, 'billing.manage'))));
create policy organisation_invitation_roles_update on public.organisation_invitation_roles for update to authenticated
using ((select private.has_permission(organisation_id, 'membership.manage')))
with check ((select private.has_permission(organisation_id, 'membership.manage'))
  and (role <> 'organisation_owner' or (select private.has_permission(organisation_id, 'billing.manage'))));

create policy organisation_invitation_site_access_select on public.organisation_invitation_site_access for select to authenticated
using ((select private.has_permission(organisation_id, 'membership.read')));
create policy organisation_invitation_site_access_insert on public.organisation_invitation_site_access for insert to authenticated
with check ((select private.has_permission(organisation_id, 'membership.manage')));
create policy organisation_invitation_site_access_update on public.organisation_invitation_site_access for update to authenticated
using ((select private.has_permission(organisation_id, 'membership.manage')))
with check ((select private.has_permission(organisation_id, 'membership.manage')));
