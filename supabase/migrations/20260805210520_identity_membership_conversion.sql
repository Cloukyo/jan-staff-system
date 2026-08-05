-- Commercial Workstream 3: identity and membership conversion foundations.
alter table public.organisation_memberships
  add column authorisation_revision bigint not null default 1
  check (authorisation_revision > 0);

create table public.membership_status_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  membership_id uuid not null,
  from_status public.organisation_membership_status not null,
  to_status public.organisation_membership_status not null,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  foreign key (organisation_id, membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (from_status <> to_status)
);

create index membership_status_events_membership_idx
  on public.membership_status_events (organisation_id, membership_id, occurred_at desc);

create or replace function private.bump_membership_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_organisation_id uuid;
  target_membership_id uuid;
begin
  if tg_op = 'DELETE' then
    target_organisation_id := old.organisation_id;
    target_membership_id := old.membership_id;
  else
    target_organisation_id := new.organisation_id;
    target_membership_id := new.membership_id;
  end if;

  update public.organisation_memberships
  set authorisation_revision = authorisation_revision + 1
  where organisation_id = target_organisation_id and id = target_membership_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function private.bump_membership_revision_on_identity_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status or old.staff_id is distinct from new.staff_id then
    new.authorisation_revision = old.authorisation_revision + 1;
  end if;
  return new;
end
$$;

create or replace function private.record_membership_status_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from new.status then
    insert into public.membership_status_events (
      organisation_id, membership_id, from_status, to_status, actor_auth_user_id
    ) values (
      new.organisation_id, new.id, old.status, new.status, auth.uid()
    );
  end if;
  return new;
end
$$;

create trigger organisation_memberships_bump_identity_revision
before update of status, staff_id on public.organisation_memberships
for each row execute function private.bump_membership_revision_on_identity_change();

create trigger organisation_memberships_record_status_event
after update of status on public.organisation_memberships
for each row execute function private.record_membership_status_event();

create trigger membership_roles_bump_revision
after insert or update or delete on public.membership_role_assignments
for each row execute function private.bump_membership_revision();

create trigger membership_site_access_bump_revision
after insert or update or delete on public.membership_site_access
for each row execute function private.bump_membership_revision();

alter table public.membership_status_events enable row level security;
revoke all on public.membership_status_events from anon, authenticated;
grant select on public.membership_status_events to authenticated;

create policy membership_status_events_select on public.membership_status_events
for select to authenticated using (
  membership_id = (select private.current_membership_id(organisation_id))
  or (select private.has_permission(organisation_id, 'organisation.audit.read'))
);

create or replace function public.current_commercial_identity_snapshot()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(snapshot order by snapshot->>'organisationId'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'membershipId', membership.id,
      'organisationId', membership.organisation_id,
      'organisationDisplayName', organisation.display_name,
      'organisationStatus', organisation.status,
      'organisationArchived', organisation.archived_at is not null,
      'status', membership.status,
      'active', membership.status = 'active'
        and organisation.archived_at is null
        and organisation.status not in ('suspended', 'closed'),
      'staffId', membership.staff_id,
      'authorisationRevision', membership.authorisation_revision,
      'roles', coalesce((
        select jsonb_agg(jsonb_build_object(
          'role', assignment.role,
          'scopeType', assignment.scope_type,
          'siteId', assignment.site_id
        ) order by assignment.role, assignment.scope_type, assignment.site_id)
        from public.membership_role_assignments assignment
        where assignment.organisation_id = membership.organisation_id
          and assignment.membership_id = membership.id
          and assignment.revoked_at is null
      ), '[]'::jsonb),
      'siteAccess', coalesce((
        select jsonb_agg(access.site_id order by access.site_id)
        from public.membership_site_access access
        join public.organisation_sites site
          on site.organisation_id = access.organisation_id and site.id = access.site_id
        where access.organisation_id = membership.organisation_id
          and access.membership_id = membership.id
          and access.revoked_at is null and site.active and site.archived_at is null
      ), '[]'::jsonb),
      'permissions', coalesce((
        select jsonb_agg(distinct permission.permission order by permission.permission)
        from public.membership_role_assignments assignment
        join private.role_permissions permission on permission.role = assignment.role
        where assignment.organisation_id = membership.organisation_id
          and assignment.membership_id = membership.id
          and assignment.revoked_at is null
          and assignment.scope_type = 'organisation'
      ), '[]'::jsonb),
      'sitePermissions', coalesce((
        select jsonb_object_agg(site_permission.site_id, site_permission.permissions)
        from (
          select site.id as site_id, jsonb_agg(distinct permission.permission order by permission.permission) as permissions
          from public.organisation_sites site
          join public.membership_role_assignments assignment
            on assignment.organisation_id = site.organisation_id
           and assignment.membership_id = membership.id
           and assignment.revoked_at is null
          join private.role_permissions permission on permission.role = assignment.role
          where site.organisation_id = membership.organisation_id and site.active and site.archived_at is null
            and (
              assignment.scope_type = 'organisation'
              or (
                assignment.scope_type = 'site' and assignment.site_id = site.id
                and exists (
                  select 1 from public.membership_site_access access
                  where access.organisation_id = membership.organisation_id
                    and access.membership_id = membership.id
                    and access.site_id = site.id and access.revoked_at is null
                )
              )
            )
          group by site.id
        ) site_permission
      ), '{}'::jsonb)
    ) as snapshot
    from public.organisation_memberships membership
    join public.organisations organisation on organisation.id = membership.organisation_id
    where auth.uid() is not null and membership.auth_user_id = auth.uid()
  ) memberships
$$;

revoke execute on function private.bump_membership_revision() from public, anon, authenticated, service_role;
revoke execute on function private.bump_membership_revision_on_identity_change() from public, anon, authenticated, service_role;
revoke execute on function private.record_membership_status_event() from public, anon, authenticated, service_role;
revoke execute on function public.current_commercial_identity_snapshot() from public, anon, authenticated, service_role;
grant execute on function public.current_commercial_identity_snapshot() to authenticated;

revoke insert, update, delete on public.organisation_memberships from authenticated;
revoke insert, update, delete on public.membership_role_assignments from authenticated;
revoke insert, update, delete on public.membership_site_access from authenticated;

alter table public.organisation_invitations
  add column superseded_at timestamptz,
  add column superseded_by_invitation_id uuid;
alter table public.organisation_invitations
  add constraint organisation_invitations_superseded_by_fk
  foreign key (superseded_by_invitation_id) references public.organisation_invitations(id)
  on delete restrict deferrable initially deferred;

create or replace function private.supersede_pending_organisation_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.organisation_invitations
  set status = 'revoked', revoked_at = now(), superseded_at = now(), superseded_by_invitation_id = new.id
  where organisation_id = new.organisation_id
    and invited_email = lower(new.invited_email)
    and status = 'pending'
    and id <> new.id;
  new.invited_email = lower(new.invited_email);
  return new;
end
$$;

create trigger organisation_invitations_supersede_pending
before insert on public.organisation_invitations
for each row execute function private.supersede_pending_organisation_invitation();

create or replace function public.accept_organisation_invitation(invitation_token text)
returns table (
  organisation_id uuid,
  membership_id uuid,
  outcome text,
  authorisation_revision bigint
)
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  invitation_record public.organisation_invitations;
  membership_record public.organisation_memberships;
  accepted_membership public.organisation_memberships;
  inviter_authorised boolean;
  privileged_invitation boolean;
begin
  if current_user_id is null or invitation_token is null or length(invitation_token) < 16 then
    raise exception 'commercial_invitation_unavailable';
  end if;

  select lower(email) into current_email from auth.users where id = current_user_id;

  select invitation.* into invitation_record
  from public.organisation_invitations invitation
  where invitation.token_hash = sha256(convert_to(invitation_token, 'UTF8'))
  for update;

  if not found or current_email is null or current_email <> invitation_record.invited_email then
    raise exception 'commercial_invitation_unavailable';
  end if;

  if invitation_record.status = 'accepted' then
    select membership.* into accepted_membership
    from public.organisation_memberships membership
    where membership.organisation_id = invitation_record.organisation_id
      and membership.id = invitation_record.accepted_by_membership_id
      and membership.auth_user_id = current_user_id;
    if found then
      return query select accepted_membership.organisation_id, accepted_membership.id,
        'already_accepted'::text, accepted_membership.authorisation_revision;
      return;
    end if;
    raise exception 'commercial_invitation_unavailable';
  end if;

  if invitation_record.status <> 'pending' or invitation_record.expires_at <= now() then
    raise exception 'commercial_invitation_unavailable';
  end if;

  select exists (
    select 1
    from public.organisation_memberships inviter
    join public.membership_role_assignments assignment
      on assignment.organisation_id = inviter.organisation_id and assignment.membership_id = inviter.id
    join private.role_permissions permission
      on permission.role = assignment.role and permission.permission = 'membership.manage'
    where inviter.organisation_id = invitation_record.organisation_id
      and inviter.id = invitation_record.invited_by_membership_id
      and inviter.status = 'active' and assignment.revoked_at is null
      and assignment.scope_type = 'organisation'
  ) into inviter_authorised;

  if not inviter_authorised or not exists (
    select 1 from public.organisation_invitation_roles intended
    where intended.organisation_id = invitation_record.organisation_id
      and intended.invitation_id = invitation_record.id
  ) then
    raise exception 'commercial_invitation_unavailable';
  end if;

  if exists (
    select 1 from public.organisation_invitation_roles intended
    where intended.organisation_id = invitation_record.organisation_id
      and intended.invitation_id = invitation_record.id
      and intended.role = 'organisation_owner'
  ) and not exists (
    select 1
    from public.organisation_memberships inviter
    join public.membership_role_assignments assignment
      on assignment.organisation_id = inviter.organisation_id and assignment.membership_id = inviter.id
    join private.role_permissions permission
      on permission.role = assignment.role and permission.permission = 'billing.manage'
    where inviter.organisation_id = invitation_record.organisation_id
      and inviter.id = invitation_record.invited_by_membership_id
      and inviter.status = 'active' and assignment.revoked_at is null
      and assignment.scope_type = 'organisation'
  ) then
    raise exception 'commercial_invitation_unavailable';
  end if;

  if exists (
    select 1
    from public.organisation_invitation_roles intended
    left join public.organisation_sites site
      on site.organisation_id = intended.organisation_id and site.id = intended.site_id
    where intended.organisation_id = invitation_record.organisation_id
      and intended.invitation_id = invitation_record.id
      and intended.scope_type = 'site'
      and (site.id is null or not site.active or site.archived_at is not null)
  ) then
    raise exception 'commercial_invitation_unavailable';
  end if;

  select exists (
    select 1 from public.organisation_invitation_roles intended
    where intended.organisation_id = invitation_record.organisation_id
      and intended.invitation_id = invitation_record.id
      and intended.role in ('organisation_owner', 'organisation_admin', 'hr_admin', 'payroll_admin', 'site_manager')
  ) into privileged_invitation;

  if privileged_invitation and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then
    raise exception 'commercial_invitation_mfa_required';
  end if;

  select membership.* into membership_record
  from public.organisation_memberships membership
  where membership.organisation_id = invitation_record.organisation_id
    and membership.auth_user_id = current_user_id
  for update;

  if found and membership_record.status in ('active', 'suspended') then
    raise exception 'commercial_invitation_duplicate_membership';
  end if;

  if found then
    update public.organisation_memberships membership
    set status = 'active', joined_at = coalesce(membership.joined_at, now()),
      suspended_at = null, revoked_at = null
    where membership.organisation_id = membership_record.organisation_id and membership.id = membership_record.id
    returning membership.* into membership_record;
  else
    insert into public.organisation_memberships (
      organisation_id, auth_user_id, status, joined_at, created_by_membership_id
    ) values (
      invitation_record.organisation_id, current_user_id, 'active', now(), invitation_record.invited_by_membership_id
    ) returning * into membership_record;
  end if;

  insert into public.membership_role_assignments (
    organisation_id, membership_id, role, scope_type, site_id, granted_by_membership_id
  )
  select intended.organisation_id, membership_record.id, intended.role, intended.scope_type,
    intended.site_id, invitation_record.invited_by_membership_id
  from public.organisation_invitation_roles intended
  where intended.organisation_id = invitation_record.organisation_id
    and intended.invitation_id = invitation_record.id
    and not exists (
      select 1 from public.membership_role_assignments existing
      where existing.organisation_id = intended.organisation_id
        and existing.membership_id = membership_record.id
        and existing.role = intended.role and existing.scope_type = intended.scope_type
        and existing.site_id is not distinct from intended.site_id and existing.revoked_at is null
    );

  insert into public.membership_site_access (
    organisation_id, membership_id, site_id, granted_by_membership_id
  )
  select intended.organisation_id, membership_record.id, intended.site_id,
    invitation_record.invited_by_membership_id
  from public.organisation_invitation_site_access intended
  where intended.organisation_id = invitation_record.organisation_id
    and intended.invitation_id = invitation_record.id
    and not exists (
      select 1 from public.membership_site_access existing
      where existing.organisation_id = intended.organisation_id
        and existing.membership_id = membership_record.id and existing.site_id = intended.site_id
        and existing.revoked_at is null
    );

  update public.organisation_invitations invitation
  set status = 'accepted', accepted_by_membership_id = membership_record.id, accepted_at = now()
  where invitation.id = invitation_record.id;

  select membership.* into membership_record
  from public.organisation_memberships membership where membership.id = membership_record.id;

  return query select membership_record.organisation_id, membership_record.id,
    'accepted'::text, membership_record.authorisation_revision;
exception
  when unique_violation or foreign_key_violation then
    raise exception 'commercial_invitation_unavailable';
end
$$;

revoke execute on function private.supersede_pending_organisation_invitation() from public, anon, authenticated, service_role;
revoke execute on function public.accept_organisation_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_organisation_invitation(text) to authenticated;

revoke insert, update, delete on public.organisation_invitations from authenticated;
revoke insert, update, delete on public.organisation_invitation_roles from authenticated;
revoke insert, update, delete on public.organisation_invitation_site_access from authenticated;
