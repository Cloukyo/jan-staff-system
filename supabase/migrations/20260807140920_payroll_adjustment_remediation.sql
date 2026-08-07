-- Commercial payroll adjustment remediation.
-- Adjustment lifecycle state is interpreted only by
-- private.effective_commercial_payroll_adjustments.

drop trigger if exists payroll_periods_apply_adjustment_carry_forwards on public.payroll_periods;
drop function if exists private.apply_pending_payroll_adjustment_carry_forwards();

-- A pending carry decision represented an adjustment which should remain active.
-- Preserve the decision as applied audit evidence without minting another value row.
update public.payroll_adjustments adjustment
set status = 'active'::public.payroll_adjustment_status
from public.payroll_adjustment_lifecycle_events event
where event.organisation_id = adjustment.organisation_id
  and event.adjustment_id = adjustment.id
  and event.resolution = 'carry_forward'
  and event.applied_adjustment_id is null;

update public.payroll_adjustment_lifecycle_events event
set applied_run_id = adjustment.run_id,
    applied_revision = adjustment.revision,
    applied_adjustment_id = adjustment.id,
    applied_at = coalesce(event.applied_at, now())
from public.payroll_adjustments adjustment
where event.organisation_id = adjustment.organisation_id
  and event.adjustment_id = adjustment.id
  and event.resolution = 'carry_forward'
  and event.applied_adjustment_id is null;

alter table public.payroll_adjustments
  add column target_kind text,
  add column target_operational_date date,
  add column lineage_root_id uuid,
  add column replaces_adjustment_id uuid;

update public.payroll_adjustments adjustment
set target_kind = case
      when adjustment.source_key like 'staff-summary:%' and adjustment.site_id is null
        then 'organisation_summary'
      when adjustment.source_key like 'staff-summary:%'
        then 'site_summary'
      else 'attendance'
    end,
    target_operational_date = case
      when adjustment.source_key like 'staff-summary:%' then null
      else row_value.operational_date
    end,
    lineage_root_id = adjustment.id
from public.payroll_preparation_rows row_value
where row_value.organisation_id = adjustment.organisation_id
  and row_value.run_id = adjustment.run_id
  and row_value.source_key = adjustment.source_key;

update public.payroll_adjustments adjustment
set target_kind = case when adjustment.site_id is null
      then 'organisation_summary' else 'site_summary' end,
    target_operational_date = null,
    lineage_root_id = adjustment.id
where adjustment.target_kind is null;

with recursive ancestry as (
  select adjustment.organisation_id,
    adjustment.id descendant_id,
    adjustment.id ancestor_id,
    coalesce(adjustment.carried_from_adjustment_id, adjustment.supersedes_adjustment_id) parent_id,
    0 depth
  from public.payroll_adjustments adjustment
  union all
  select ancestry.organisation_id,
    ancestry.descendant_id,
    parent.id,
    coalesce(parent.carried_from_adjustment_id, parent.supersedes_adjustment_id),
    ancestry.depth + 1
  from ancestry
  join public.payroll_adjustments parent
    on parent.organisation_id = ancestry.organisation_id
   and parent.id = ancestry.parent_id
), roots as (
  select distinct on (organisation_id, descendant_id)
    organisation_id, descendant_id, ancestor_id root_id
  from ancestry
  order by organisation_id, descendant_id, depth desc
)
update public.payroll_adjustments adjustment
set lineage_root_id = roots.root_id
from roots
where roots.organisation_id = adjustment.organisation_id
  and roots.descendant_id = adjustment.id;

alter table public.payroll_adjustments
  alter column target_kind set not null,
  alter column lineage_root_id set not null,
  add constraint payroll_adjustments_target_kind_check
    check (target_kind in ('attendance', 'organisation_summary', 'site_summary')),
  add constraint payroll_adjustments_target_shape_check check (
    (target_kind = 'attendance' and site_id is not null and target_operational_date is not null)
    or (target_kind = 'organisation_summary' and site_id is null and target_operational_date is null)
    or (target_kind = 'site_summary' and site_id is not null and target_operational_date is null)
  ),
  add constraint payroll_adjustments_lineage_root_fk
    foreign key (organisation_id, lineage_root_id)
    references public.payroll_adjustments(organisation_id, id)
    on delete restrict deferrable initially deferred,
  add constraint payroll_adjustments_replaces_fk
    foreign key (organisation_id, replaces_adjustment_id)
    references public.payroll_adjustments(organisation_id, id)
    on delete restrict deferrable initially deferred,
  add constraint payroll_adjustments_replacement_not_self_check
    check (replaces_adjustment_id is null or replaces_adjustment_id <> id);

create unique index payroll_adjustments_one_active_lineage_idx
  on public.payroll_adjustments (organisation_id, lineage_root_id)
  where status = 'active';
create index payroll_adjustments_stable_target_idx
  on public.payroll_adjustments (
    organisation_id, period_id, staff_id, target_kind, site_id, target_operational_date
  );

alter table public.payroll_preparation_runs
  add column adjustment_fingerprint text,
  add column site_scope_fingerprint text,
  add column readiness_fingerprint text,
  add column row_fingerprint text,
  add column payable_minutes_total bigint,
  add column adjustment_minutes_total bigint;

alter table public.payroll_approvals
  add column attendance_fingerprint text,
  add column adjustment_fingerprint text,
  add column pay_arrangement_fingerprint text,
  add column site_scope_fingerprint text,
  add column readiness_fingerprint text,
  add column row_fingerprint text,
  add column payable_minutes_total bigint,
  add column adjustment_minutes_total bigint;

alter table public.payroll_export_audits
  add column attendance_fingerprint text,
  add column adjustment_fingerprint text,
  add column pay_arrangement_fingerprint text,
  add column site_scope_fingerprint text,
  add column readiness_fingerprint text,
  add column row_fingerprint text,
  add column payable_minutes_total bigint,
  add column adjustment_minutes_total bigint;

create table public.payroll_run_adjustment_snapshots (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  period_id uuid not null,
  run_id uuid not null,
  adjustment_id uuid not null,
  lineage_root_id uuid not null,
  staff_id text not null,
  target_kind text not null,
  site_id uuid,
  operational_date date,
  adjustment_minutes integer not null,
  reason text not null,
  adjustment_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, run_id, adjustment_id),
  foreign key (organisation_id, period_id, run_id)
    references public.payroll_preparation_runs(organisation_id, period_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (organisation_id, adjustment_id)
    references public.payroll_adjustments(organisation_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (organisation_id, lineage_root_id)
    references public.payroll_adjustments(organisation_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (organisation_id, staff_id)
    references public.staff_profiles(organisation_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (organisation_id, site_id)
    references public.organisation_sites(organisation_id, id)
    on delete restrict deferrable initially deferred,
  constraint payroll_run_adjustment_snapshots_target_kind_check
    check (target_kind in ('attendance', 'organisation_summary', 'site_summary')),
  constraint payroll_run_adjustment_snapshots_target_shape_check check (
    (target_kind = 'attendance' and site_id is not null and operational_date is not null)
    or (target_kind = 'organisation_summary' and site_id is null and operational_date is null)
    or (target_kind = 'site_summary' and site_id is not null and operational_date is null)
  ),
  constraint payroll_run_adjustment_snapshots_minutes_check
    check (adjustment_minutes <> 0 and adjustment_minutes between -10080 and 10080),
  constraint payroll_run_adjustment_snapshots_reason_check
    check (length(btrim(reason)) between 5 and 2000)
);

create index payroll_run_adjustment_snapshots_run_idx
  on public.payroll_run_adjustment_snapshots (organisation_id, run_id, staff_id);
create index payroll_run_adjustment_snapshots_period_idx
  on public.payroll_run_adjustment_snapshots (organisation_id, period_id, run_id);

create or replace function private.reject_payroll_run_adjustment_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Payroll run adjustment snapshots are immutable';
end
$$;

revoke all on function private.reject_payroll_run_adjustment_snapshot_mutation()
  from public, anon, authenticated, service_role;

create trigger payroll_run_adjustment_snapshots_immutable
before update or delete on public.payroll_run_adjustment_snapshots
for each row execute function private.reject_payroll_run_adjustment_snapshot_mutation();

alter table public.payroll_run_adjustment_snapshots enable row level security;
create policy payroll_run_adjustment_snapshots_read
on public.payroll_run_adjustment_snapshots for select to authenticated
using (private.has_permission(organisation_id, 'payroll.read'));
revoke all on public.payroll_run_adjustment_snapshots from anon, authenticated;
grant select on public.payroll_run_adjustment_snapshots to authenticated;

create or replace function private.effective_commercial_payroll_adjustments(
  target_organisation_id uuid,
  target_period_id uuid,
  target_site_filter_id uuid,
  source_run_id uuid default null
)
returns table (
  adjustment_id uuid,
  lineage_root_id uuid,
  staff_id text,
  target_kind text,
  site_id uuid,
  operational_date date,
  adjustment_minutes integer,
  reason text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.payroll_periods period
    where period.organisation_id = target_organisation_id
      and period.id = target_period_id
  ) then
    return;
  end if;
  if target_site_filter_id is not null and not exists (
    select 1 from public.organisation_sites site
    where site.organisation_id = target_organisation_id
      and site.id = target_site_filter_id
  ) then
    return;
  end if;

  if source_run_id is null then
    return query
    select adjustment.id,
      adjustment.lineage_root_id,
      adjustment.staff_id,
      adjustment.target_kind,
      adjustment.site_id,
      adjustment.target_operational_date,
      adjustment.adjustment_minutes,
      adjustment.reason,
      adjustment.created_at
    from public.payroll_adjustments adjustment
    where adjustment.organisation_id = target_organisation_id
      and adjustment.period_id = target_period_id
      and adjustment.status = 'active'
      and (
        target_site_filter_id is null
        or (
          adjustment.target_kind <> 'organisation_summary'
          and adjustment.site_id = target_site_filter_id
        )
      )
    order by adjustment.staff_id, adjustment.target_kind,
      adjustment.site_id nulls first, adjustment.target_operational_date nulls first,
      adjustment.lineage_root_id, adjustment.id;
  else
    if not exists (
      select 1 from public.payroll_preparation_runs run
      where run.organisation_id = target_organisation_id
        and run.period_id = target_period_id
        and run.id = source_run_id
        and run.site_filter_id is not distinct from target_site_filter_id
    ) then
      return;
    end if;
    return query
    select snapshot.adjustment_id,
      snapshot.lineage_root_id,
      snapshot.staff_id,
      snapshot.target_kind,
      snapshot.site_id,
      snapshot.operational_date,
      snapshot.adjustment_minutes,
      snapshot.reason,
      snapshot.adjustment_created_at
    from public.payroll_run_adjustment_snapshots snapshot
    where snapshot.organisation_id = target_organisation_id
      and snapshot.period_id = target_period_id
      and snapshot.run_id = source_run_id
    order by snapshot.staff_id, snapshot.target_kind,
      snapshot.site_id nulls first, snapshot.operational_date nulls first,
      snapshot.lineage_root_id, snapshot.adjustment_id;
  end if;
end
$$;

revoke all on function private.effective_commercial_payroll_adjustments(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.payroll_effective_adjustment_fingerprint(
  target_organisation_id uuid,
  target_period_id uuid,
  target_site_filter_id uuid,
  source_run_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(
    coalesce(jsonb_agg(jsonb_build_object(
      'adjustmentId', effective.adjustment_id,
      'lineageRootId', effective.lineage_root_id,
      'staffId', effective.staff_id,
      'targetKind', effective.target_kind,
      'siteId', effective.site_id,
      'operationalDate', effective.operational_date,
      'adjustmentMinutes', effective.adjustment_minutes,
      'reason', effective.reason,
      'createdAt', effective.created_at
    ) order by effective.staff_id, effective.target_kind,
      effective.site_id nulls first, effective.operational_date nulls first,
      effective.lineage_root_id, effective.adjustment_id), '[]'::jsonb)::text,
    'sha256'
  ), 'hex')
  from private.effective_commercial_payroll_adjustments(
    target_organisation_id, target_period_id, target_site_filter_id, source_run_id
  ) effective
$$;

revoke all on function private.payroll_effective_adjustment_fingerprint(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Every historical adjustment row was applied to the run it references. Snapshot
-- that immutable fact before later lifecycle changes are evaluated.
insert into public.payroll_run_adjustment_snapshots (
  organisation_id, period_id, run_id, adjustment_id, lineage_root_id, staff_id,
  target_kind, site_id, operational_date, adjustment_minutes, reason,
  adjustment_created_at, created_at
)
select adjustment.organisation_id,
  adjustment.period_id,
  adjustment.run_id,
  adjustment.id,
  adjustment.lineage_root_id,
  adjustment.staff_id,
  adjustment.target_kind,
  adjustment.site_id,
  adjustment.target_operational_date,
  adjustment.adjustment_minutes,
  adjustment.reason,
  adjustment.created_at,
  adjustment.created_at
from public.payroll_adjustments adjustment
on conflict (organisation_id, run_id, adjustment_id) do nothing;

update public.payroll_preparation_runs run
set adjustment_fingerprint = private.payroll_effective_adjustment_fingerprint(
      run.organisation_id, run.period_id, run.site_filter_id, run.id
    ),
    site_scope_fingerprint = encode(extensions.digest(jsonb_build_object(
      'organisationId', run.organisation_id,
      'periodId', run.period_id,
      'siteFilterId', run.site_filter_id
    )::text, 'sha256'), 'hex'),
    readiness_fingerprint = encode(extensions.digest(run.readiness::text, 'sha256'), 'hex'),
    row_fingerprint = encode(extensions.digest(coalesce((
      select jsonb_agg(to_jsonb(row_value) - 'created_at' order by row_value.staff_id,
        row_value.operational_date, row_value.source_key)
      from public.payroll_preparation_rows row_value
      where row_value.organisation_id = run.organisation_id and row_value.run_id = run.id
    ), '[]'::jsonb)::text, 'sha256'), 'hex'),
    payable_minutes_total = coalesce((
      select sum(row_value.payable_minutes)::bigint
      from public.payroll_preparation_rows row_value
      where row_value.organisation_id = run.organisation_id and row_value.run_id = run.id
    ), 0),
    adjustment_minutes_total = coalesce((
      select sum(row_value.adjustment_minutes)::bigint
      from public.payroll_preparation_rows row_value
      where row_value.organisation_id = run.organisation_id and row_value.run_id = run.id
    ), 0);

alter table public.payroll_preparation_runs
  alter column adjustment_fingerprint set default encode(extensions.digest('[]', 'sha256'), 'hex'),
  alter column adjustment_fingerprint set not null,
  alter column site_scope_fingerprint set default encode(extensions.digest('{}', 'sha256'), 'hex'),
  alter column site_scope_fingerprint set not null,
  alter column readiness_fingerprint set default encode(extensions.digest('{}', 'sha256'), 'hex'),
  alter column readiness_fingerprint set not null,
  alter column row_fingerprint set default encode(extensions.digest('[]', 'sha256'), 'hex'),
  alter column row_fingerprint set not null,
  alter column payable_minutes_total set default 0,
  alter column payable_minutes_total set not null,
  alter column adjustment_minutes_total set default 0,
  alter column adjustment_minutes_total set not null,
  add constraint payroll_preparation_runs_remediation_fingerprints_check check (
    adjustment_fingerprint ~ '^[0-9a-f]{64}$'
    and site_scope_fingerprint ~ '^[0-9a-f]{64}$'
    and readiness_fingerprint ~ '^[0-9a-f]{64}$'
    and row_fingerprint ~ '^[0-9a-f]{64}$'
  );

update public.payroll_approvals approval
set attendance_fingerprint = run.authoritative_attendance_fingerprint,
    adjustment_fingerprint = run.adjustment_fingerprint,
    pay_arrangement_fingerprint = run.authoritative_pay_arrangement_fingerprint,
    site_scope_fingerprint = run.site_scope_fingerprint,
    readiness_fingerprint = run.readiness_fingerprint,
    row_fingerprint = run.row_fingerprint,
    payable_minutes_total = run.payable_minutes_total,
    adjustment_minutes_total = run.adjustment_minutes_total
from public.payroll_preparation_runs run
where run.organisation_id = approval.organisation_id and run.id = approval.run_id;

update public.payroll_export_audits audit
set attendance_fingerprint = approval.attendance_fingerprint,
    adjustment_fingerprint = approval.adjustment_fingerprint,
    pay_arrangement_fingerprint = approval.pay_arrangement_fingerprint,
    site_scope_fingerprint = approval.site_scope_fingerprint,
    readiness_fingerprint = approval.readiness_fingerprint,
    row_fingerprint = approval.row_fingerprint,
    payable_minutes_total = approval.payable_minutes_total,
    adjustment_minutes_total = approval.adjustment_minutes_total
from public.payroll_approvals approval
where approval.organisation_id = audit.organisation_id and approval.id = audit.approval_id;

alter table public.payroll_approvals
  alter column attendance_fingerprint set default repeat('0', 64),
  alter column attendance_fingerprint set not null,
  alter column adjustment_fingerprint set default encode(extensions.digest('[]', 'sha256'), 'hex'),
  alter column adjustment_fingerprint set not null,
  alter column pay_arrangement_fingerprint set default repeat('0', 64),
  alter column pay_arrangement_fingerprint set not null,
  alter column site_scope_fingerprint set default encode(extensions.digest('{}', 'sha256'), 'hex'),
  alter column site_scope_fingerprint set not null,
  alter column readiness_fingerprint set default encode(extensions.digest('{}', 'sha256'), 'hex'),
  alter column readiness_fingerprint set not null,
  alter column row_fingerprint set default encode(extensions.digest('[]', 'sha256'), 'hex'),
  alter column row_fingerprint set not null,
  alter column payable_minutes_total set default 0,
  alter column payable_minutes_total set not null,
  alter column adjustment_minutes_total set default 0,
  alter column adjustment_minutes_total set not null;

alter table public.payroll_export_audits
  alter column attendance_fingerprint set default repeat('0', 64),
  alter column attendance_fingerprint set not null,
  alter column adjustment_fingerprint set default encode(extensions.digest('[]', 'sha256'), 'hex'),
  alter column adjustment_fingerprint set not null,
  alter column pay_arrangement_fingerprint set default repeat('0', 64),
  alter column pay_arrangement_fingerprint set not null,
  alter column site_scope_fingerprint set default encode(extensions.digest('{}', 'sha256'), 'hex'),
  alter column site_scope_fingerprint set not null,
  alter column readiness_fingerprint set default encode(extensions.digest('{}', 'sha256'), 'hex'),
  alter column readiness_fingerprint set not null,
  alter column row_fingerprint set default encode(extensions.digest('[]', 'sha256'), 'hex'),
  alter column row_fingerprint set not null,
  alter column payable_minutes_total set default 0,
  alter column payable_minutes_total set not null,
  alter column adjustment_minutes_total set default 0,
  alter column adjustment_minutes_total set not null;

alter table public.payroll_adjustment_lifecycle_events
  drop constraint if exists payroll_adjustment_lifecycle_events_resolution_check,
  drop constraint if exists payroll_adjustment_lifecycle_application,
  add constraint payroll_adjustment_lifecycle_events_resolution_check
    check (resolution in ('void', 'carry_forward', 'replace', 'reverse')),
  add constraint payroll_adjustment_lifecycle_application check (
    (resolution in ('void', 'reverse')
      and applied_run_id is null and applied_revision is null
      and applied_adjustment_id is null and applied_at is null)
    or (resolution = 'replace'
      and applied_run_id is null and applied_revision is null
      and applied_adjustment_id is not null and applied_at is not null)
    or (resolution = 'carry_forward' and (
      (applied_run_id is null and applied_revision is null
        and applied_adjustment_id is null and applied_at is null)
      or (applied_run_id is not null and applied_revision is not null
        and applied_adjustment_id is not null and applied_at is not null)
    ))
  );

revoke all on function public.create_commercial_payroll_adjustment(
  uuid, integer, uuid, text, uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.resolve_commercial_payroll_adjustment(
  uuid, integer, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create or replace function private.payroll_actor_has_any_permission(
  target_organisation_id uuid,
  requested_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.organisation_memberships membership
    join public.membership_role_assignments assignment
      on assignment.organisation_id = membership.organisation_id
     and assignment.membership_id = membership.id
    join private.role_permissions permission
      on permission.role = assignment.role
     and permission.permission = requested_permission
    where membership.organisation_id = target_organisation_id
      and membership.auth_user_id = auth.uid()
      and membership.status = 'active'
      and assignment.revoked_at is null
  )
$$;

revoke all on function private.payroll_actor_has_any_permission(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.payroll_run_has_current_adjustments(
  target_organisation_id uuid,
  target_period_id uuid,
  target_site_filter_id uuid,
  target_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.payroll_effective_adjustment_fingerprint(
    target_organisation_id, target_period_id, target_site_filter_id, null
  ) = private.payroll_effective_adjustment_fingerprint(
    target_organisation_id, target_period_id, target_site_filter_id, target_run_id
  )
$$;

revoke all on function private.payroll_run_has_current_adjustments(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_commercial_payroll_adjustment_v2(
  target_period_id uuid,
  expected_revision integer,
  operation_id uuid,
  target_staff_id text,
  target_kind text,
  target_site_id uuid,
  target_operational_date date,
  adjustment_minutes integer,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_expected_revision alias for $2;
  command_operation_id alias for $3;
  command_staff_id alias for $4;
  command_target_kind alias for $5;
  command_site_id alias for $6;
  command_operational_date alias for $7;
  command_adjustment_minutes alias for $8;
  command_reason alias for $9;
  target_period public.payroll_periods%rowtype;
  target_run public.payroll_preparation_runs%rowtype;
  target_row public.payroll_preparation_rows%rowtype;
  existing_adjustment public.payroll_adjustments%rowtype;
  existing_event public.payroll_adjustment_lifecycle_events%rowtype;
  actor_membership_id uuid;
  created_adjustment_id uuid;
  command_request_digest text;
  target_base_minutes integer := 0;
  target_existing_adjustment_minutes integer := 0;
  stable_source_key text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'aal2_required');
  end if;

  select period.* into target_period
  from public.payroll_periods period
  where period.id = target_period_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  actor_membership_id := private.current_membership_id(target_period.organisation_id);
  if actor_membership_id is null
     or not private.payroll_actor_has_any_permission(
       target_period.organisation_id, 'payroll.prepare'
     ) then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if command_target_kind not in ('attendance', 'organisation_summary', 'site_summary')
     or command_operation_id is null
     or command_expected_revision is null
     or command_staff_id is null or btrim(command_staff_id) = ''
     or command_adjustment_minutes is null or command_adjustment_minutes = 0
     or command_adjustment_minutes not between -10080 and 10080
     or length(btrim(coalesce(command_reason, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_target');
  end if;
  if command_target_kind = 'organisation_summary' then
    if command_site_id is not null or command_operational_date is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_target');
    end if;
    if not private.has_permission(target_period.organisation_id, 'payroll.prepare') then
      return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
    end if;
  else
    if command_site_id is null
       or not private.has_site_permission(
         target_period.organisation_id, command_site_id, 'payroll.prepare'
       ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
    end if;
    if command_target_kind = 'attendance' and command_operational_date is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_target');
    end if;
    if command_target_kind = 'site_summary' and command_operational_date is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_target');
    end if;
  end if;

  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'create_adjustment_v2',
    'periodId', target_period_id,
    'expectedRevision', command_expected_revision,
    'staffId', btrim(command_staff_id),
    'targetKind', command_target_kind,
    'siteId', command_site_id,
    'operationalDate', command_operational_date,
    'adjustmentMinutes', command_adjustment_minutes,
    'reason', btrim(command_reason)
  ));

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-operation:' || target_period.organisation_id::text
      || ':' || command_operation_id::text, 0
  ));
  select adjustment.* into existing_adjustment
  from public.payroll_adjustments adjustment
  where adjustment.organisation_id = target_period.organisation_id
    and adjustment.operation_id = command_operation_id;
  if found then
    if existing_adjustment.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'adjustment_reused', 'reused', true,
      'organisationId', existing_adjustment.organisation_id,
      'periodId', existing_adjustment.period_id,
      'runId', existing_adjustment.run_id,
      'adjustmentId', existing_adjustment.id,
      'revision', existing_adjustment.revision,
      'adjustmentMinutes', existing_adjustment.adjustment_minutes
    );
  end if;
  select event.* into existing_event
  from public.payroll_adjustment_lifecycle_events event
  where event.organisation_id = target_period.organisation_id
    and event.operation_id = command_operation_id;
  if found then
    return jsonb_build_object('ok', false, 'code', 'operation_conflict');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-period:' || target_period.organisation_id::text
      || ':' || target_period.id::text, 0
  ));
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = target_period.organisation_id
    and period.id = target_period_id
  for update;
  if target_period.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'period_closed');
  end if;
  if target_period.revision <> command_expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision',
      'currentRevision', target_period.revision
    );
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id
    and run.revision = target_period.revision
  for update;
  if not found or not private.payroll_run_has_current_adjustments(
    target_period.organisation_id, target_period.id, target_run.site_filter_id, target_run.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'run_stale');
  end if;
  if target_run.site_filter_id is not null
     and target_run.site_filter_id is distinct from command_site_id then
    return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
  end if;
  if not exists (
    select 1 from public.staff_profiles staff
    where staff.organisation_id = target_period.organisation_id
      and staff.id = btrim(command_staff_id)
      and staff.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_target');
  end if;

  if command_target_kind = 'attendance' then
    if command_operational_date not between target_period.period_start and target_period.period_end then
      return jsonb_build_object('ok', false, 'code', 'invalid_target');
    end if;
    select row_value.* into target_row
    from public.payroll_preparation_rows row_value
    where row_value.organisation_id = target_period.organisation_id
      and row_value.run_id = target_run.id
      and row_value.staff_id = btrim(command_staff_id)
      and row_value.site_id = command_site_id
      and row_value.operational_date = command_operational_date
      and row_value.source_key not like 'staff-summary:%'
    order by row_value.source_key
    limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid_target');
    end if;
    target_base_minutes := target_row.raw_minutes;
    stable_source_key := target_row.source_key;
  elsif command_target_kind = 'site_summary' then
    if not exists (
      select 1 from public.staff_site_assignments assignment
      where assignment.organisation_id = target_period.organisation_id
        and assignment.staff_id = btrim(command_staff_id)
        and assignment.site_id = command_site_id
        and assignment.effective_from <= target_period.period_end
        and (assignment.effective_to is null
          or assignment.effective_to >= target_period.period_start)
    ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
    end if;
    stable_source_key := 'adjustment-summary:site:'
      || target_period.organisation_id::text || ':' || btrim(command_staff_id)
      || ':' || command_site_id::text;
  else
    if target_run.site_filter_id is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
    end if;
    stable_source_key := 'adjustment-summary:organisation:'
      || target_period.organisation_id::text || ':' || btrim(command_staff_id);
  end if;

  select coalesce(sum(effective.adjustment_minutes), 0)::integer
    into target_existing_adjustment_minutes
  from private.effective_commercial_payroll_adjustments(
    target_period.organisation_id, target_period.id, target_run.site_filter_id, null
  ) effective
  where effective.staff_id = btrim(command_staff_id)
    and effective.target_kind = command_target_kind
    and effective.site_id is not distinct from command_site_id
    and effective.operational_date is not distinct from command_operational_date;
  if target_base_minutes + target_existing_adjustment_minutes
       + command_adjustment_minutes < 0 then
    return jsonb_build_object('ok', false, 'code', 'negative_target_total');
  end if;

  created_adjustment_id := gen_random_uuid();
  insert into public.payroll_adjustments (
    id, organisation_id, period_id, run_id, revision, staff_id, site_id,
    operation_id, request_expected_revision, request_digest, source_key,
    adjustment_minutes, reason, status, created_by_membership_id,
    target_kind, target_operational_date, lineage_root_id, replaces_adjustment_id
  ) values (
    created_adjustment_id, target_period.organisation_id, target_period.id,
    target_run.id, target_run.revision, btrim(command_staff_id), command_site_id,
    command_operation_id, command_expected_revision, command_request_digest,
    stable_source_key, command_adjustment_minutes, btrim(command_reason),
    'active'::public.payroll_adjustment_status, actor_membership_id,
    command_target_kind, command_operational_date, created_adjustment_id, null
  );

  return jsonb_build_object(
    'ok', true, 'code', 'adjustment_created', 'reused', false,
    'organisationId', target_period.organisation_id,
    'periodId', target_period.id,
    'runId', target_run.id,
    'adjustmentId', created_adjustment_id,
    'revision', target_period.revision,
    'adjustmentMinutes', command_adjustment_minutes
  );
end
$$;

create or replace function public.replace_commercial_payroll_adjustment_v2(
  target_period_id uuid,
  expected_revision integer,
  operation_id uuid,
  target_adjustment_id uuid,
  adjustment_minutes integer,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_expected_revision alias for $2;
  command_operation_id alias for $3;
  command_adjustment_id alias for $4;
  command_adjustment_minutes alias for $5;
  command_reason alias for $6;
  target_period public.payroll_periods%rowtype;
  target_run public.payroll_preparation_runs%rowtype;
  source_adjustment public.payroll_adjustments%rowtype;
  existing_adjustment public.payroll_adjustments%rowtype;
  existing_event public.payroll_adjustment_lifecycle_events%rowtype;
  effective_target record;
  target_row public.payroll_preparation_rows%rowtype;
  actor_membership_id uuid;
  replacement_id uuid;
  command_request_digest text;
  target_base_minutes integer := 0;
  other_adjustment_minutes integer := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'aal2_required');
  end if;
  select period.* into target_period
  from public.payroll_periods period where period.id = target_period_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'permission_denied'); end if;
  actor_membership_id := private.current_membership_id(target_period.organisation_id);
  if actor_membership_id is null
     or not private.payroll_actor_has_any_permission(
       target_period.organisation_id, 'payroll.prepare'
     ) then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if command_operation_id is null or command_adjustment_id is null
     or command_expected_revision is null
     or command_adjustment_minutes is null or command_adjustment_minutes = 0
     or command_adjustment_minutes not between -10080 and 10080
     or length(btrim(coalesce(command_reason, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_target');
  end if;

  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'replace_adjustment_v2', 'periodId', target_period_id,
    'expectedRevision', command_expected_revision,
    'adjustmentId', command_adjustment_id,
    'adjustmentMinutes', command_adjustment_minutes,
    'reason', btrim(command_reason)
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-operation:' || target_period.organisation_id::text
      || ':' || command_operation_id::text, 0
  ));
  select adjustment.* into existing_adjustment
  from public.payroll_adjustments adjustment
  where adjustment.organisation_id = target_period.organisation_id
    and adjustment.operation_id = command_operation_id;
  if found then
    if existing_adjustment.request_digest is distinct from command_request_digest
       or existing_adjustment.replaces_adjustment_id is null then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'adjustment_reused', 'reused', true,
      'organisationId', existing_adjustment.organisation_id,
      'periodId', existing_adjustment.period_id,
      'runId', existing_adjustment.run_id,
      'adjustmentId', existing_adjustment.id,
      'replacedAdjustmentId', existing_adjustment.replaces_adjustment_id,
      'revision', existing_adjustment.revision,
      'adjustmentMinutes', existing_adjustment.adjustment_minutes
    );
  end if;
  select event.* into existing_event
  from public.payroll_adjustment_lifecycle_events event
  where event.organisation_id = target_period.organisation_id
    and event.operation_id = command_operation_id;
  if found then return jsonb_build_object('ok', false, 'code', 'operation_conflict'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-period:' || target_period.organisation_id::text
      || ':' || target_period.id::text, 0
  ));
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = target_period.organisation_id
    and period.id = target_period_id
  for update;
  if target_period.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'period_closed');
  end if;
  if target_period.revision <> command_expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision
    );
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id and run.revision = target_period.revision
  for update;
  if not found or not private.payroll_run_has_current_adjustments(
    target_period.organisation_id, target_period.id, target_run.site_filter_id, target_run.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'run_stale');
  end if;

  select effective.* into effective_target
  from private.effective_commercial_payroll_adjustments(
    target_period.organisation_id, target_period.id, target_run.site_filter_id, null
  ) effective
  where effective.adjustment_id = command_adjustment_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid_target'); end if;
  if effective_target.target_kind = 'organisation_summary' then
    if not private.has_permission(target_period.organisation_id, 'payroll.prepare') then
      return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
    end if;
  elsif not private.has_site_permission(
    target_period.organisation_id, effective_target.site_id, 'payroll.prepare'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
  end if;
  select adjustment.* into source_adjustment
  from public.payroll_adjustments adjustment
  where adjustment.organisation_id = target_period.organisation_id
    and adjustment.id = effective_target.adjustment_id
  for update;

  if effective_target.target_kind = 'attendance' then
    select row_value.* into target_row
    from public.payroll_preparation_rows row_value
    where row_value.organisation_id = target_period.organisation_id
      and row_value.run_id = target_run.id
      and row_value.staff_id = effective_target.staff_id
      and row_value.site_id = effective_target.site_id
      and row_value.operational_date = effective_target.operational_date
      and row_value.source_key not like 'staff-summary:%'
    order by row_value.source_key limit 1;
    if not found then return jsonb_build_object('ok', false, 'code', 'invalid_target'); end if;
    target_base_minutes := target_row.raw_minutes;
  end if;
  select coalesce(sum(effective.adjustment_minutes), 0)::integer
    into other_adjustment_minutes
  from private.effective_commercial_payroll_adjustments(
    target_period.organisation_id, target_period.id, target_run.site_filter_id, null
  ) effective
  where effective.staff_id = effective_target.staff_id
    and effective.target_kind = effective_target.target_kind
    and effective.site_id is not distinct from effective_target.site_id
    and effective.operational_date is not distinct from effective_target.operational_date
    and effective.lineage_root_id <> effective_target.lineage_root_id;
  if target_base_minutes + other_adjustment_minutes + command_adjustment_minutes < 0 then
    return jsonb_build_object('ok', false, 'code', 'negative_target_total');
  end if;

  update public.payroll_adjustments adjustment
  set status = 'superseded'::public.payroll_adjustment_status
  where adjustment.organisation_id = source_adjustment.organisation_id
    and adjustment.id = source_adjustment.id;
  replacement_id := gen_random_uuid();
  insert into public.payroll_adjustments (
    id, organisation_id, period_id, run_id, revision, staff_id, site_id,
    operation_id, request_expected_revision, request_digest, source_key,
    adjustment_minutes, reason, status, created_by_membership_id,
    target_kind, target_operational_date, lineage_root_id, replaces_adjustment_id
  ) values (
    replacement_id, source_adjustment.organisation_id, source_adjustment.period_id,
    target_run.id, target_run.revision, source_adjustment.staff_id, source_adjustment.site_id,
    command_operation_id, command_expected_revision, command_request_digest,
    source_adjustment.source_key, command_adjustment_minutes, btrim(command_reason),
    'active'::public.payroll_adjustment_status, actor_membership_id,
    source_adjustment.target_kind, source_adjustment.target_operational_date,
    source_adjustment.lineage_root_id, source_adjustment.id
  );
  insert into public.payroll_adjustment_lifecycle_events (
    organisation_id, period_id, adjustment_id, operation_id,
    request_expected_revision, request_digest, resolution, reason,
    applied_adjustment_id, created_by_membership_id, applied_at
  ) values (
    target_period.organisation_id, target_period.id, source_adjustment.id,
    command_operation_id, command_expected_revision, command_request_digest,
    'replace', btrim(command_reason), replacement_id, actor_membership_id, now()
  );

  return jsonb_build_object(
    'ok', true, 'code', 'adjustment_replaced', 'reused', false,
    'organisationId', target_period.organisation_id,
    'periodId', target_period.id, 'runId', target_run.id,
    'adjustmentId', replacement_id,
    'replacedAdjustmentId', source_adjustment.id,
    'revision', target_period.revision,
    'adjustmentMinutes', command_adjustment_minutes
  );
end
$$;

create or replace function public.transition_commercial_payroll_adjustment_v2(
  target_period_id uuid,
  expected_revision integer,
  operation_id uuid,
  target_adjustment_id uuid,
  transition text,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_expected_revision alias for $2;
  command_operation_id alias for $3;
  command_adjustment_id alias for $4;
  command_transition alias for $5;
  command_reason alias for $6;
  target_period public.payroll_periods%rowtype;
  target_run public.payroll_preparation_runs%rowtype;
  target_adjustment public.payroll_adjustments%rowtype;
  existing_event public.payroll_adjustment_lifecycle_events%rowtype;
  effective_target record;
  actor_membership_id uuid;
  command_request_digest text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'aal2_required');
  end if;
  select period.* into target_period
  from public.payroll_periods period where period.id = target_period_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'permission_denied'); end if;
  actor_membership_id := private.current_membership_id(target_period.organisation_id);
  if actor_membership_id is null
     or not private.payroll_actor_has_any_permission(
       target_period.organisation_id, 'payroll.prepare'
     ) then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if command_operation_id is null or command_adjustment_id is null
     or command_expected_revision is null
     or command_transition not in ('void', 'reverse')
     or length(btrim(coalesce(command_reason, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_target');
  end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'transition_adjustment_v2', 'periodId', target_period_id,
    'expectedRevision', command_expected_revision,
    'adjustmentId', command_adjustment_id,
    'transition', command_transition, 'reason', btrim(command_reason)
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-operation:' || target_period.organisation_id::text
      || ':' || command_operation_id::text, 0
  ));
  select event.* into existing_event
  from public.payroll_adjustment_lifecycle_events event
  where event.organisation_id = target_period.organisation_id
    and event.operation_id = command_operation_id;
  if found then
    if existing_event.request_digest is distinct from command_request_digest
       or existing_event.resolution is distinct from command_transition then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', case when existing_event.resolution = 'void'
        then 'adjustment_voided' else 'adjustment_reversed' end,
      'reused', true,
      'organisationId', existing_event.organisation_id,
      'periodId', existing_event.period_id,
      'adjustmentId', existing_event.adjustment_id,
      'revision', existing_event.request_expected_revision
    );
  end if;
  if exists (
    select 1 from public.payroll_adjustments adjustment
    where adjustment.organisation_id = target_period.organisation_id
      and adjustment.operation_id = command_operation_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'operation_conflict');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-period:' || target_period.organisation_id::text
      || ':' || target_period.id::text, 0
  ));
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = target_period.organisation_id
    and period.id = target_period_id
  for update;
  if target_period.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'period_closed');
  end if;
  if target_period.revision <> command_expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision
    );
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id and run.revision = target_period.revision
  for update;
  if not found or not private.payroll_run_has_current_adjustments(
    target_period.organisation_id, target_period.id, target_run.site_filter_id, target_run.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'run_stale');
  end if;
  select effective.* into effective_target
  from private.effective_commercial_payroll_adjustments(
    target_period.organisation_id, target_period.id, target_run.site_filter_id, null
  ) effective
  where effective.adjustment_id = command_adjustment_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid_target'); end if;
  if effective_target.target_kind = 'organisation_summary' then
    if not private.has_permission(target_period.organisation_id, 'payroll.prepare') then
      return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
    end if;
  elsif not private.has_site_permission(
    target_period.organisation_id, effective_target.site_id, 'payroll.prepare'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site_scope');
  end if;
  select adjustment.* into target_adjustment
  from public.payroll_adjustments adjustment
  where adjustment.organisation_id = target_period.organisation_id
    and adjustment.id = effective_target.adjustment_id
  for update;

  insert into public.payroll_adjustment_lifecycle_events (
    organisation_id, period_id, adjustment_id, operation_id,
    request_expected_revision, request_digest, resolution, reason,
    created_by_membership_id
  ) values (
    target_period.organisation_id, target_period.id, target_adjustment.id,
    command_operation_id, command_expected_revision, command_request_digest,
    command_transition, btrim(command_reason), actor_membership_id
  );
  update public.payroll_adjustments adjustment
  set status = case when command_transition = 'void'
      then 'voided'::public.payroll_adjustment_status
      else 'superseded'::public.payroll_adjustment_status end
  where adjustment.organisation_id = target_adjustment.organisation_id
    and adjustment.id = target_adjustment.id;

  return jsonb_build_object(
    'ok', true,
    'code', case when command_transition = 'void'
      then 'adjustment_voided' else 'adjustment_reversed' end,
    'reused', false,
    'organisationId', target_period.organisation_id,
    'periodId', target_period.id,
    'adjustmentId', target_adjustment.id,
    'revision', target_period.revision
  );
end
$$;

revoke all on function public.create_commercial_payroll_adjustment_v2(uuid, integer, uuid, text, text, uuid, date, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.create_commercial_payroll_adjustment_v2(uuid, integer, uuid, text, text, uuid, date, integer, text) to authenticated;
revoke all on function public.replace_commercial_payroll_adjustment_v2(uuid, integer, uuid, uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.replace_commercial_payroll_adjustment_v2(uuid, integer, uuid, uuid, integer, text) to authenticated;
revoke all on function public.transition_commercial_payroll_adjustment_v2(uuid, integer, uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.transition_commercial_payroll_adjustment_v2(uuid, integer, uuid, uuid, text, text) to authenticated;

-- Readiness is derived from the complete composed payroll row universe. Summary
-- adjustments are pay evidence, not attendance evidence, so they receive only
-- the pay-arrangement checks that apply to their positive payable value.
create or replace function private.payroll_authoritative_readiness(
  target_organisation_id uuid,
  period_start date,
  period_end date,
  target_site_filter_id uuid,
  preparation_rows jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with row_universe as (
    select row_value, case
      when left(coalesce(row_value ->> 'sourceKey', ''), 19) = 'adjustment-summary:'
        then 'adjustment_summary'
      when left(coalesce(row_value ->> 'sourceKey', ''), 14) = 'staff-summary:'
        then 'staff_summary'
      else 'attendance' end source_kind
    from jsonb_array_elements(preparation_rows) row_value
  ), attendance_rows as (
    select coalesce(jsonb_agg(row_value), '[]'::jsonb) rows
    from row_universe where source_kind = 'attendance'
  ), attendance_readiness as (
    select private.payroll_authoritative_attendance_readiness(
      target_organisation_id, period_start, period_end, target_site_filter_id, rows
    ) value
    from attendance_rows
  ), issue_values as (
    select readiness_issue issue from attendance_readiness,
      jsonb_array_elements(attendance_readiness.value -> 'issues') readiness_issue
    union
    select jsonb_build_object(
      'code', 'missing_pay_arrangement', 'severity', 'blocker',
      'organisationId', target_organisation_id,
      'staffId', row_value ->> 'staffId', 'siteId', null,
      'operationalDate', (row_value ->> 'operationalDate')::date,
      'sourceId', null
    )
    from row_universe
    where source_kind = 'staff_summary'
      and nullif(row_value ->> 'payArrangementId', '') is null
    union
    select jsonb_build_object(
      'code', 'missing_pay_arrangement', 'severity', 'blocker',
      'organisationId', target_organisation_id,
      'staffId', row_value ->> 'staffId',
      'siteId', nullif(row_value ->> 'siteId', '')::uuid,
      'operationalDate', (row_value ->> 'operationalDate')::date,
      'sourceId', null
    )
    from row_universe
    where source_kind = 'adjustment_summary'
      and nullif(row_value ->> 'payArrangementId', '') is null
      and greatest(
        coalesce((row_value ->> 'payableMinutes')::integer, 0),
        coalesce((row_value ->> 'adjustmentMinutes')::integer, 0)
      ) > 0
  ), issues as (
    select distinct issue from issue_values
  )
  select jsonb_build_object(
    'issues', coalesce(jsonb_agg(issue order by issue::text), '[]'::jsonb),
    'counts', jsonb_build_object(
      'blocker', count(*) filter (where issue ->> 'severity' = 'blocker'),
      'warning', count(*) filter (where issue ->> 'severity' = 'warning'),
      'informational', count(*) filter (where issue ->> 'severity' = 'informational')
    )
  ) from issues
$$;

revoke all on function private.payroll_authoritative_readiness(uuid, date, date, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Browser payloads contain base attendance and zero-value staff summaries only.
-- This function is the sole preparation-time composer of live adjustments.
create or replace function private.compose_commercial_payroll_preparation(
  target_organisation_id uuid,
  target_period_id uuid,
  target_site_filter_id uuid,
  base_rows jsonb
)
returns table (composed_rows jsonb, validation_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_period public.payroll_periods%rowtype;
  base_row jsonb;
  final_row jsonb;
  effective_target record;
  summary_arrangement public.staff_pay_arrangements%rowtype;
  target_adjustment_minutes integer;
  target_payable_minutes integer;
  working_rows jsonb := '[]'::jsonb;
  canonical_rows jsonb;
begin
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = target_organisation_id
    and period.id = target_period_id;
  if not found or jsonb_typeof(base_rows) <> 'array' then
    return query select null::jsonb, 'invalid_snapshot'::text;
    return;
  end if;

  if exists (
    select 1
    from private.effective_commercial_payroll_adjustments(
      target_organisation_id, target_period_id, target_site_filter_id, null
    ) effective
    where effective.target_kind = 'attendance'
      and not exists (
        select 1 from jsonb_array_elements(base_rows) supplied
        where supplied ->> 'staffId' = effective.staff_id
          and nullif(supplied ->> 'siteId', '')::uuid = effective.site_id
          and (supplied ->> 'operationalDate')::date = effective.operational_date
          and left(coalesce(supplied ->> 'sourceKey', ''), 14) <> 'staff-summary:'
      )
  ) then
    return query select null::jsonb, 'invalid_adjustment_target'::text;
    return;
  end if;

  for base_row in select value from jsonb_array_elements(base_rows)
  loop
    target_adjustment_minutes := 0;
    if left(coalesce(base_row ->> 'sourceKey', ''), 14) <> 'staff-summary:' then
      select coalesce(sum(effective.adjustment_minutes), 0)::integer
        into target_adjustment_minutes
      from private.effective_commercial_payroll_adjustments(
        target_organisation_id, target_period_id, target_site_filter_id, null
      ) effective
      where effective.target_kind = 'attendance'
        and effective.staff_id = base_row ->> 'staffId'
        and effective.site_id = nullif(base_row ->> 'siteId', '')::uuid
        and effective.operational_date = (base_row ->> 'operationalDate')::date;
    end if;
    target_payable_minutes := (base_row ->> 'rawMinutes')::integer
      + target_adjustment_minutes;
    if target_payable_minutes < 0 then
      return query select null::jsonb, 'negative_target_total'::text;
      return;
    end if;
    if target_payable_minutes > 10080 then
      return query select null::jsonb, 'adjustment_out_of_range'::text;
      return;
    end if;
    final_row := jsonb_set(
      jsonb_set(base_row, '{adjustmentMinutes}', to_jsonb(target_adjustment_minutes), true),
      '{payableMinutes}', to_jsonb(target_payable_minutes), true
    );
    working_rows := working_rows || jsonb_build_array(final_row);
  end loop;

  for effective_target in
    select effective.staff_id, effective.target_kind, effective.site_id,
      sum(effective.adjustment_minutes)::integer adjustment_minutes
    from private.effective_commercial_payroll_adjustments(
      target_organisation_id, target_period_id, target_site_filter_id, null
    ) effective
    where effective.target_kind in ('organisation_summary', 'site_summary')
    group by effective.staff_id, effective.target_kind, effective.site_id
    order by effective.staff_id, effective.target_kind, effective.site_id nulls first
  loop
    if effective_target.adjustment_minutes < 0 then
      return query select null::jsonb, 'negative_target_total'::text;
      return;
    elsif effective_target.adjustment_minutes > 10080 then
      return query select null::jsonb, 'adjustment_out_of_range'::text;
      return;
    end if;
    summary_arrangement := null;
    select arrangement.* into summary_arrangement
    from public.staff_pay_arrangements arrangement
    where arrangement.organisation_id = target_organisation_id
      and arrangement.staff_id = effective_target.staff_id
      and arrangement.is_active
      and arrangement.effective_from <= target_period.period_end
      and (arrangement.effective_to is null
        or arrangement.effective_to >= target_period.period_start)
    order by arrangement.effective_from desc, arrangement.id
    limit 1;

    working_rows := working_rows || jsonb_build_array(jsonb_build_object(
      'organisationId', target_organisation_id,
      'staffId', effective_target.staff_id,
      'sourceKind', 'adjustment_summary',
      'siteId', effective_target.site_id,
      'payArrangementId', summary_arrangement.id,
      'operationalDate', case when summary_arrangement.id is null
        then target_period.period_start
        else greatest(target_period.period_start, summary_arrangement.effective_from) end,
      'sourceKey', case when effective_target.target_kind = 'organisation_summary'
        then 'adjustment-summary:organisation:' || target_organisation_id::text
          || ':' || effective_target.staff_id
        else 'adjustment-summary:site:' || target_organisation_id::text
          || ':' || effective_target.staff_id || ':' || effective_target.site_id::text end,
      'payType', summary_arrangement.pay_type,
      'rawMinutes', 0,
      'adjustmentMinutes', effective_target.adjustment_minutes,
      'payableMinutes', effective_target.adjustment_minutes,
      'ordinaryMinutes', 0,
      'overtimeMinutes', 0,
      'hourlyRate', summary_arrangement.hourly_rate,
      'annualSalary', summary_arrangement.annual_salary,
      'monthlySalary', summary_arrangement.monthly_salary,
      'overtimeMultiplier', summary_arrangement.overtime_multiplier,
      'estimatedGrossValue', null,
      'salaryBasis', null,
      'currencyCode', 'GBP',
      'warnings', '[]'::jsonb
    ));
  end loop;

  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(
        jsonb_set(row_value, '{ordinaryMinutes}', to_jsonb(canonical.ordinary_minutes), true),
        '{overtimeMinutes}', to_jsonb(canonical.overtime_minutes), true
      ),
      '{estimatedGrossValue}',
      coalesce(to_jsonb(canonical.estimated_gross_value), 'null'::jsonb), true
    ) order by row_value ->> 'staffId', row_value ->> 'operationalDate', row_value ->> 'sourceKey'
  ), '[]'::jsonb) into canonical_rows
  from jsonb_array_elements(working_rows) row_value
  join private.payroll_canonical_arithmetic(
    target_organisation_id, target_period.period_start, target_period.period_end, working_rows
  ) canonical on canonical.source_key = row_value ->> 'sourceKey';

  if jsonb_array_length(canonical_rows) <> jsonb_array_length(working_rows) then
    return query select null::jsonb, 'invalid_arithmetic'::text;
    return;
  end if;
  return query select canonical_rows, null::text;
end
$$;

revoke all on function private.compose_commercial_payroll_preparation(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.validate_commercial_payroll_base(
  target_organisation_id uuid,
  period_start date,
  period_end date,
  target_site_filter_id uuid,
  preparation_rows jsonb,
  preparation_readiness jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attendance_rows jsonb;
  summary_rows jsonb;
  summary_row jsonb;
  row_staff_id text;
  row_site_id uuid;
  row_arrangement_id uuid;
  row_date date;
  arrangement public.staff_pay_arrangements%rowtype;
  attendance_validation text;
  authoritative_readiness jsonb;
  normalised_readiness_issues jsonb;
begin
  if jsonb_typeof(preparation_rows) <> 'array'
     or jsonb_typeof(preparation_readiness) <> 'object'
     or jsonb_typeof(preparation_readiness -> 'issues') <> 'array'
     or jsonb_typeof(preparation_readiness -> 'counts') <> 'object' then
    return 'invalid_snapshot';
  end if;
  select coalesce(jsonb_agg(row_value), '[]'::jsonb) into attendance_rows
  from jsonb_array_elements(preparation_rows) row_value
  where left(coalesce(row_value ->> 'sourceKey', ''), 14) <> 'staff-summary:';
  select coalesce(jsonb_agg(row_value), '[]'::jsonb) into summary_rows
  from jsonb_array_elements(preparation_rows) row_value
  where left(coalesce(row_value ->> 'sourceKey', ''), 14) = 'staff-summary:';

  if exists (
    select 1 from jsonb_array_elements(preparation_rows) supplied
    group by supplied ->> 'sourceKey' having count(*) > 1
  ) then return 'duplicate_evidence'; end if;
  if exists (
    select 1 from jsonb_array_elements(preparation_rows) supplied
    where not exists (
      select 1 from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id
        and staff.id = supplied ->> 'staffId' and staff.active
    )
  ) then return 'invalid_staff'; end if;
  if exists (
    select 1 from jsonb_array_elements(attendance_rows) supplied
    where nullif(supplied ->> 'siteId', '') is not null and (
      not exists (select 1 from public.organisation_sites site
        where site.organisation_id = target_organisation_id
          and site.id = (supplied ->> 'siteId')::uuid)
      or (target_site_filter_id is not null
        and (supplied ->> 'siteId')::uuid <> target_site_filter_id)
    )
  ) then return 'invalid_site'; end if;

  if jsonb_array_length(attendance_rows) > 0 then
    attendance_validation := private.validate_payroll_attendance_snapshot(
      target_organisation_id, period_start, period_end, target_site_filter_id,
      attendance_rows,
      private.payroll_authoritative_attendance_readiness(
        target_organisation_id, period_start, period_end,
        target_site_filter_id, attendance_rows
      )
    );
    if attendance_validation is not null then return attendance_validation; end if;
  elsif exists (
    select 1 from (
      select event.site_id, event.staff_id, event.recorded_date
      from public.clock_events event
      where event.organisation_id = target_organisation_id
        and event.recorded_date between period_start and period_end
        and (target_site_filter_id is null or event.site_id = target_site_filter_id)
      union
      select correction.site_id, correction.staff_id, correction.recorded_date
      from public.clock_event_corrections correction
      where correction.organisation_id = target_organisation_id
        and correction.recorded_date between period_start and period_end
        and (target_site_filter_id is null or correction.site_id = target_site_filter_id)
    ) evidence
  ) then return 'attendance_evidence_mismatch'; end if;

  for summary_row in select value from jsonb_array_elements(summary_rows)
  loop
    row_staff_id := summary_row ->> 'staffId';
    row_site_id := nullif(summary_row ->> 'siteId', '')::uuid;
    row_arrangement_id := nullif(summary_row ->> 'payArrangementId', '')::uuid;
    row_date := (summary_row ->> 'operationalDate')::date;
    arrangement := null;
    if row_date not between period_start and period_end
       or summary_row ->> 'currencyCode' <> 'GBP'
       or jsonb_typeof(summary_row -> 'warnings') <> 'array'
       or coalesce((summary_row ->> 'rawMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'adjustmentMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'payableMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'ordinaryMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'overtimeMinutes')::integer, -1) <> 0 then
      return 'invalid_snapshot';
    end if;
    if exists (select 1 from jsonb_array_elements(attendance_rows) attendance
      where attendance ->> 'staffId' = row_staff_id) then
      return 'invalid_snapshot';
    end if;

    if target_site_filter_id is null then
      if row_site_id is not null
         or summary_row ->> 'sourceKey' not like
           'staff-summary:' || target_organisation_id::text || ':' || row_staff_id || '%' then
        return 'invalid_site_attribution';
      end if;
    else
      if row_site_id is distinct from target_site_filter_id
         or summary_row ->> 'sourceKey' is distinct from
           'staff-summary:' || target_organisation_id::text || ':' || row_staff_id
             || ':site:' || target_site_filter_id::text then
        return 'invalid_site_attribution';
      end if;
      if (select count(distinct assignment.site_id)
        from public.staff_site_assignments assignment
        where assignment.organisation_id = target_organisation_id
          and assignment.staff_id = row_staff_id
          and assignment.effective_from <= period_end
          and (assignment.effective_to is null or assignment.effective_to >= period_start)) <> 1
         or not exists (
          select 1 from public.staff_site_assignments assignment
          where assignment.organisation_id = target_organisation_id
            and assignment.staff_id = row_staff_id
            and assignment.site_id = target_site_filter_id
            and assignment.effective_from <= period_end
            and (assignment.effective_to is null or assignment.effective_to >= period_start)
         ) then return 'invalid_site_attribution'; end if;
    end if;

    if row_arrangement_id is null then
      if summary_row ->> 'payType' is not null
         or summary_row ->> 'hourlyRate' is not null
         or summary_row ->> 'annualSalary' is not null
         or summary_row ->> 'monthlySalary' is not null
         or summary_row ->> 'overtimeMultiplier' is not null
         or exists (select 1 from public.staff_pay_arrangements candidate
           where candidate.organisation_id = target_organisation_id
             and candidate.staff_id = row_staff_id and candidate.is_active
             and candidate.effective_from <= period_end
             and (candidate.effective_to is null or candidate.effective_to >= period_start)) then
        return 'invalid_pay_arrangement';
      end if;
    else
      select candidate.* into arrangement
      from public.staff_pay_arrangements candidate
      where candidate.organisation_id = target_organisation_id
        and candidate.id = row_arrangement_id and candidate.staff_id = row_staff_id
        and candidate.is_active and candidate.effective_from <= period_end
        and (candidate.effective_to is null or candidate.effective_to >= period_start);
      if not found
         or row_date is distinct from greatest(period_start, arrangement.effective_from)
         or summary_row ->> 'payType' is distinct from arrangement.pay_type::text
         or nullif(summary_row ->> 'hourlyRate', '')::numeric is distinct from arrangement.hourly_rate
         or nullif(summary_row ->> 'annualSalary', '')::numeric is distinct from arrangement.annual_salary
         or nullif(summary_row ->> 'monthlySalary', '')::numeric is distinct from arrangement.monthly_salary
         or nullif(summary_row ->> 'overtimeMultiplier', '')::numeric
           is distinct from arrangement.overtime_multiplier then
        return 'invalid_pay_arrangement';
      end if;
    end if;
  end loop;

  if exists (
    with eligible_staff as (
      select staff.id
      from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id and staff.active
        and not exists (select 1 from jsonb_array_elements(attendance_rows) attendance
          where attendance ->> 'staffId' = staff.id)
        and (target_site_filter_id is null or (
          (select count(distinct assignment.site_id)
           from public.staff_site_assignments assignment
           where assignment.organisation_id = target_organisation_id
             and assignment.staff_id = staff.id
             and assignment.effective_from <= period_end
             and (assignment.effective_to is null
               or assignment.effective_to >= period_start)) = 1
          and exists (select 1 from public.staff_site_assignments assignment
            where assignment.organisation_id = target_organisation_id
              and assignment.staff_id = staff.id
              and assignment.site_id = target_site_filter_id
              and assignment.effective_from <= period_end
              and (assignment.effective_to is null
                or assignment.effective_to >= period_start))
        ))
    ), supplied_staff as (
      select distinct row_value ->> 'staffId' id
      from jsonb_array_elements(summary_rows) row_value
    )
    (select id from eligible_staff except select id from supplied_staff)
    union all
    (select id from supplied_staff except select id from eligible_staff)
  ) then return 'invalid_staff_summary_coverage'; end if;

  if exists (
    select 1 from jsonb_array_elements(preparation_rows) supplied
    join private.payroll_canonical_arithmetic(
      target_organisation_id, period_start, period_end, preparation_rows
    ) canonical on canonical.source_key = supplied ->> 'sourceKey'
    where (supplied ->> 'ordinaryMinutes')::integer is distinct from canonical.ordinary_minutes
      or (supplied ->> 'overtimeMinutes')::integer is distinct from canonical.overtime_minutes
      or nullif(supplied ->> 'estimatedGrossValue', '')::numeric
        is distinct from canonical.estimated_gross_value
  ) then return 'invalid_arithmetic'; end if;

  authoritative_readiness := private.payroll_authoritative_readiness(
    target_organisation_id, period_start, period_end, target_site_filter_id, preparation_rows
  );
  select coalesce(jsonb_agg(issue order by issue::text), '[]'::jsonb)
    into normalised_readiness_issues
  from (select distinct value issue
    from jsonb_array_elements(preparation_readiness -> 'issues')) supplied_issues;
  if jsonb_build_object('issues', normalised_readiness_issues,
       'counts', preparation_readiness -> 'counts') <> authoritative_readiness then
    return 'invalid_readiness';
  end if;
  return null;
exception when others then
  return 'invalid_snapshot';
end
$$;

revoke all on function private.validate_commercial_payroll_base(uuid, date, date, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.payroll_attendance_fingerprint(
  target_organisation_id uuid,
  period_start date,
  period_end date,
  target_site_filter_id uuid,
  preparation_rows jsonb
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(string_agg(
    to_jsonb(event)::text, E'\n'
    order by event.recorded_date, event.staff_id, event.site_id,
      event.event_timestamp, event.event_order_key, event.event_id
  ), '') || '|site-filter:' || coalesce(target_site_filter_id::text, 'all'), 'sha256'), 'hex')
  from public.organisation_sites site
  cross join lateral private.get_commercial_effective_clock_events(
    target_organisation_id, site.id, period_start, period_end, null
  ) event
  where site.organisation_id = target_organisation_id
    and (target_site_filter_id is null or site.id = target_site_filter_id)
$$;

create or replace function private.payroll_authoritative_site_scope_fingerprint(
  target_organisation_id uuid,
  period_start date,
  period_end date,
  target_site_filter_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(jsonb_build_object(
    'organisationId', target_organisation_id,
    'periodStart', period_start,
    'periodEnd', period_end,
    'siteFilterId', target_site_filter_id,
    'staff', coalesce(jsonb_agg(jsonb_build_object(
      'staffId', staff.id,
      'assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'siteId', assignment.site_id,
          'effectiveFrom', assignment.effective_from,
          'effectiveTo', assignment.effective_to
        ) order by assignment.effective_from, assignment.site_id, assignment.effective_to)
        from public.staff_site_assignments assignment
        where assignment.organisation_id = target_organisation_id
          and assignment.staff_id = staff.id
          and assignment.effective_from <= period_end
          and (assignment.effective_to is null
            or assignment.effective_to >= period_start)
      ), '[]'::jsonb),
      'overlappingSiteIds', coalesce((
        select jsonb_agg(site_id order by site_id)
        from (select distinct assignment.site_id
          from public.staff_site_assignments assignment
          where assignment.organisation_id = target_organisation_id
            and assignment.staff_id = staff.id
            and assignment.effective_from <= period_end
            and (assignment.effective_to is null
              or assignment.effective_to >= period_start)) sites
      ), '[]'::jsonb)
    ) order by staff.id), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  from public.staff_profiles staff
  where staff.organisation_id = target_organisation_id and staff.active
$$;

create or replace function private.payroll_authoritative_pay_arrangement_fingerprint(
  target_organisation_id uuid,
  period_start date,
  period_end date,
  target_site_filter_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(jsonb_build_object(
    'organisationId', target_organisation_id,
    'periodStart', period_start,
    'periodEnd', period_end,
    'siteFilterId', target_site_filter_id,
    'arrangements', coalesce(jsonb_agg(jsonb_build_object(
      'id', arrangement.id, 'staffId', arrangement.staff_id,
      'siteId', arrangement.site_id, 'payType', arrangement.pay_type,
      'hourlyRate', arrangement.hourly_rate,
      'annualSalary', arrangement.annual_salary,
      'monthlySalary', arrangement.monthly_salary,
      'contractedWeeklyHours', arrangement.contracted_weekly_hours,
      'hoursBasis', arrangement.hours_basis,
      'standardDailyHours', arrangement.standard_daily_hours,
      'overtimeMultiplier', arrangement.overtime_multiplier,
      'effectiveFrom', arrangement.effective_from,
      'effectiveTo', arrangement.effective_to,
      'isActive', arrangement.is_active,
      'managerNotes', arrangement.manager_notes,
      'createdAt', arrangement.created_at,
      'updatedAt', arrangement.updated_at
    ) order by arrangement.staff_id, arrangement.effective_from, arrangement.id), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  from public.staff_pay_arrangements arrangement
  join public.staff_profiles staff
    on staff.organisation_id = arrangement.organisation_id
   and staff.id = arrangement.staff_id and staff.active
  where arrangement.organisation_id = target_organisation_id
    and arrangement.is_active
    and arrangement.effective_from <= period_end
    and (arrangement.effective_to is null or arrangement.effective_to >= period_start)
$$;

revoke all on function private.payroll_authoritative_site_scope_fingerprint(uuid, date, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.payroll_authoritative_pay_arrangement_fingerprint(uuid, date, date, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.persist_commercial_payroll_preparation(
  target_period_id uuid,
  target_site_filter_id uuid,
  expected_revision integer,
  target_operation_id uuid,
  target_input_fingerprint text,
  target_attendance_fingerprint text,
  target_pay_arrangement_fingerprint text,
  preparation_rows jsonb,
  preparation_readiness jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_context record;
  target_period public.payroll_periods%rowtype;
  current_run public.payroll_preparation_runs%rowtype;
  existing_run public.payroll_preparation_runs%rowtype;
  created_run public.payroll_preparation_runs%rowtype;
  preparation_row jsonb;
  validation_code text;
  next_revision integer;
  target_status public.payroll_preparation_status;
  target_blocker_count integer;
  target_warning_count integer;
  target_informational_count integer;
  authoritative_attendance_fingerprint text;
  authoritative_pay_arrangement_fingerprint text;
  arrangement_ids uuid[];
  authoritative_readiness jsonb;
  normalised_request_rows jsonb;
  normalised_request_issues jsonb;
  normalised_request_readiness jsonb;
  command_request_digest text;
  canonical_pay_snapshots jsonb;
  database_rows jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'mfa_required');
  end if;
  select * into command_context
  from private.authorised_payroll_period(target_period_id, 'payroll.prepare');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || command_context.organisation_id::text || ':'
      || coalesce(target_operation_id::text, ''), 0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-period:' || command_context.organisation_id::text || ':'
      || target_period_id::text, 0
  ));

  if jsonb_typeof(preparation_rows) = 'array' then
    select coalesce(jsonb_agg(row_value
      order by row_value ->> 'sourceKey', row_value::text), '[]'::jsonb)
      into normalised_request_rows
    from (
      select case
        when target_site_filter_id is not null
          and left(coalesce(value ->> 'sourceKey', ''), 14) = 'staff-summary:'
          and nullif(value ->> 'siteId', '') is null
        then jsonb_set(
          jsonb_set(value, '{siteId}', to_jsonb(target_site_filter_id::text), true),
          '{sourceKey}', to_jsonb(
            'staff-summary:' || command_context.organisation_id::text || ':'
              || (value ->> 'staffId') || ':site:' || target_site_filter_id::text
          ), true
        )
        else value end row_value
      from jsonb_array_elements(preparation_rows)
    ) canonical_request_rows;
    preparation_rows := normalised_request_rows;
  else
    normalised_request_rows := preparation_rows;
  end if;
  if jsonb_typeof(preparation_readiness) = 'object'
     and jsonb_typeof(preparation_readiness -> 'issues') = 'array' then
    select coalesce(jsonb_agg(issue order by issue::text), '[]'::jsonb)
      into normalised_request_issues
    from (select distinct value issue
      from jsonb_array_elements(preparation_readiness -> 'issues')) supplied_issues;
    normalised_request_readiness := jsonb_build_object(
      'issues', normalised_request_issues, 'counts', preparation_readiness -> 'counts'
    );
  else
    normalised_request_readiness := preparation_readiness;
  end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id, 'siteFilterId', target_site_filter_id,
    'expectedRevision', expected_revision, 'inputFingerprint', target_input_fingerprint,
    'attendanceFingerprint', target_attendance_fingerprint,
    'payArrangementFingerprint', target_pay_arrangement_fingerprint,
    'rows', normalised_request_rows, 'readiness', normalised_request_readiness,
    'command', 'persist_preparation'
  ));

  select run.* into existing_run
  from public.payroll_preparation_runs run
  where run.organisation_id = command_context.organisation_id
    and run.operation_id = target_operation_id;
  if found then
    if existing_run.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'preparation_reused', 'reused', true,
      'organisationId', existing_run.organisation_id, 'periodId', existing_run.period_id,
      'runId', existing_run.id, 'revision', existing_run.revision,
      'status', existing_run.status, 'blockerCount', existing_run.blocker_count,
      'warningCount', existing_run.warning_count,
      'informationalCount', existing_run.informational_count
    );
  end if;
  if expected_revision is null or target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  if jsonb_typeof(preparation_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_snapshot');
  end if;
  if exists (
    select 1 from jsonb_array_elements(preparation_rows) supplied
    where coalesce((supplied ->> 'adjustmentMinutes')::integer, 0) <> 0
  ) then
    return jsonb_build_object('ok', false, 'code', 'client_adjustment_forbidden');
  end if;

  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id
    and period.id = target_period_id
  for update;
  if target_period.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'period_closed');
  end if;
  if target_period.revision <> expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision
    );
  end if;
  if target_input_fingerprint !~ '^[0-9a-f]{64}$'
     or target_attendance_fingerprint !~ '^[0-9a-f]{64}$'
     or target_pay_arrangement_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_fingerprint');
  end if;
  if target_site_filter_id is not null and not exists (
    select 1 from public.organisation_sites site
    where site.organisation_id = target_period.organisation_id
      and site.id = target_site_filter_id and site.active and site.archived_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site');
  end if;

  validation_code := private.validate_commercial_payroll_base(
    target_period.organisation_id, target_period.period_start, target_period.period_end,
    target_site_filter_id, preparation_rows, preparation_readiness
  );
  if validation_code is not null then
    return jsonb_build_object('ok', false, 'code', validation_code);
  end if;
  select composed.composed_rows, composed.validation_code
    into database_rows, validation_code
  from private.compose_commercial_payroll_preparation(
    target_period.organisation_id, target_period.id, target_site_filter_id, preparation_rows
  ) composed;
  if validation_code is not null then
    return jsonb_build_object('ok', false, 'code', validation_code);
  end if;

  select coalesce(jsonb_object_agg(canonical.source_key, jsonb_build_object(
    'payRegimeKey', canonical.pay_regime_key,
    'ordinaryMinutesLimit', canonical.ordinary_minutes_limit
  )), '{}'::jsonb) into canonical_pay_snapshots
  from private.payroll_canonical_arithmetic(
    target_period.organisation_id, target_period.period_start,
    target_period.period_end, database_rows
  ) canonical;
  authoritative_attendance_fingerprint := private.payroll_attendance_fingerprint(
    target_period.organisation_id, target_period.period_start, target_period.period_end,
    target_site_filter_id, preparation_rows
  );
  select array_agg(distinct nullif(row_value ->> 'payArrangementId', '')::uuid
    order by nullif(row_value ->> 'payArrangementId', '')::uuid)
    filter (where nullif(row_value ->> 'payArrangementId', '') is not null)
    into arrangement_ids from jsonb_array_elements(database_rows) row_value;
  authoritative_pay_arrangement_fingerprint := private.payroll_authoritative_pay_arrangement_fingerprint(
    target_period.organisation_id, target_period.period_start, target_period.period_end,
    target_site_filter_id
  );
  authoritative_readiness := private.payroll_authoritative_readiness(
    target_period.organisation_id, target_period.period_start, target_period.period_end,
    target_site_filter_id, database_rows
  );
  target_blocker_count := (authoritative_readiness #>> '{counts,blocker}')::integer;
  target_warning_count := (authoritative_readiness #>> '{counts,warning}')::integer;
  target_informational_count := (authoritative_readiness #>> '{counts,informational}')::integer;
  target_status := case when target_blocker_count > 0
    then 'needs_review'::public.payroll_preparation_status
    else 'ready'::public.payroll_preparation_status end;

  select run.* into current_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id and run.revision = target_period.revision;
  if found then
    next_revision := target_period.revision + 1;
    update public.payroll_preparation_runs run set status = 'superseded'
    where run.organisation_id = current_run.organisation_id and run.id = current_run.id;
  else
    next_revision := target_period.revision;
  end if;

  insert into public.payroll_preparation_runs (
    organisation_id, period_id, revision, status, operation_id, request_expected_revision,
    request_digest, input_fingerprint, attendance_fingerprint,
    pay_arrangement_fingerprint, authoritative_attendance_fingerprint,
    authoritative_pay_arrangement_fingerprint, blocker_count, warning_count,
    informational_count, readiness, site_filter_id, supersedes_run_id,
    supersedes_revision, prepared_by_membership_id
  ) values (
    target_period.organisation_id, target_period.id, next_revision, target_status,
    target_operation_id, expected_revision, command_request_digest,
    target_input_fingerprint, target_attendance_fingerprint,
    target_pay_arrangement_fingerprint, authoritative_attendance_fingerprint,
    authoritative_pay_arrangement_fingerprint, target_blocker_count,
    target_warning_count, target_informational_count, authoritative_readiness,
    target_site_filter_id, current_run.id, current_run.revision,
    command_context.membership_id
  ) returning * into created_run;

  for preparation_row in select value from jsonb_array_elements(database_rows)
  loop
    insert into public.payroll_preparation_rows (
      organisation_id, run_id, staff_id, site_id, pay_arrangement_id,
      operational_date, source_key, pay_type, pay_regime_key, ordinary_minutes_limit,
      raw_minutes, adjustment_minutes, payable_minutes, ordinary_minutes,
      overtime_minutes, hourly_rate, annual_salary, monthly_salary,
      overtime_multiplier, estimated_gross_value, currency_code, warnings
    ) values (
      target_period.organisation_id, created_run.id, preparation_row ->> 'staffId',
      nullif(preparation_row ->> 'siteId', '')::uuid,
      nullif(preparation_row ->> 'payArrangementId', '')::uuid,
      (preparation_row ->> 'operationalDate')::date, preparation_row ->> 'sourceKey',
      nullif(preparation_row ->> 'payType', '')::public.payroll_pay_type,
      canonical_pay_snapshots -> (preparation_row ->> 'sourceKey') ->> 'payRegimeKey',
      nullif(canonical_pay_snapshots -> (preparation_row ->> 'sourceKey')
        ->> 'ordinaryMinutesLimit', '')::integer,
      (preparation_row ->> 'rawMinutes')::integer,
      (preparation_row ->> 'adjustmentMinutes')::integer,
      (preparation_row ->> 'payableMinutes')::integer,
      (preparation_row ->> 'ordinaryMinutes')::integer,
      (preparation_row ->> 'overtimeMinutes')::integer,
      nullif(preparation_row ->> 'hourlyRate', '')::numeric,
      nullif(preparation_row ->> 'annualSalary', '')::numeric,
      nullif(preparation_row ->> 'monthlySalary', '')::numeric,
      nullif(preparation_row ->> 'overtimeMultiplier', '')::numeric,
      nullif(preparation_row ->> 'estimatedGrossValue', '')::numeric,
      preparation_row ->> 'currencyCode', preparation_row -> 'warnings'
    );
  end loop;

  insert into public.payroll_run_adjustment_snapshots (
    organisation_id, period_id, run_id, adjustment_id, lineage_root_id, staff_id,
    target_kind, site_id, operational_date, adjustment_minutes, reason,
    adjustment_created_at
  )
  select target_period.organisation_id, target_period.id, created_run.id,
    effective.adjustment_id, effective.lineage_root_id, effective.staff_id,
    effective.target_kind, effective.site_id, effective.operational_date,
    effective.adjustment_minutes, effective.reason, effective.created_at
  from private.effective_commercial_payroll_adjustments(
    target_period.organisation_id, target_period.id, target_site_filter_id, null
  ) effective;

  update public.payroll_preparation_runs run
  set adjustment_fingerprint = private.payroll_effective_adjustment_fingerprint(
        run.organisation_id, run.period_id, run.site_filter_id, run.id
      ),
      site_scope_fingerprint = private.payroll_authoritative_site_scope_fingerprint(
        run.organisation_id, target_period.period_start, target_period.period_end,
        run.site_filter_id
      ),
      readiness_fingerprint = encode(extensions.digest(run.readiness::text, 'sha256'), 'hex'),
      row_fingerprint = encode(extensions.digest(coalesce((
        select jsonb_agg(to_jsonb(row_value) - 'created_at'
          order by row_value.staff_id, row_value.operational_date, row_value.source_key)
        from public.payroll_preparation_rows row_value
        where row_value.organisation_id = run.organisation_id and row_value.run_id = run.id
      ), '[]'::jsonb)::text, 'sha256'), 'hex'),
      payable_minutes_total = coalesce((select sum(row_value.payable_minutes)::bigint
        from public.payroll_preparation_rows row_value
        where row_value.organisation_id = run.organisation_id and row_value.run_id = run.id), 0),
      adjustment_minutes_total = coalesce((select sum(row_value.adjustment_minutes)::bigint
        from public.payroll_preparation_rows row_value
        where row_value.organisation_id = run.organisation_id and row_value.run_id = run.id), 0)
  where run.organisation_id = created_run.organisation_id and run.id = created_run.id
  returning run.* into created_run;

  if next_revision <> target_period.revision then
    update public.payroll_periods period set revision = next_revision, updated_at = now()
    where period.organisation_id = target_period.organisation_id and period.id = target_period.id;
  end if;
  return jsonb_build_object(
    'ok', true, 'code', 'preparation_persisted', 'reused', false,
    'organisationId', created_run.organisation_id, 'periodId', created_run.period_id,
    'runId', created_run.id, 'revision', created_run.revision,
    'status', created_run.status, 'blockerCount', created_run.blocker_count,
    'warningCount', created_run.warning_count,
    'informationalCount', created_run.informational_count
  );
end
$$;

revoke all on function public.persist_commercial_payroll_preparation(
  uuid, uuid, integer, uuid, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.persist_commercial_payroll_preparation(
  uuid, uuid, integer, uuid, text, text, text, jsonb, jsonb
) to authenticated;

create or replace function private.validate_commercial_payroll_run_inputs(
  target_organisation_id uuid,
  target_run_id uuid
)
returns table (
  is_fresh boolean,
  stale_code text,
  attendance_fingerprint text,
  adjustment_fingerprint text,
  pay_arrangement_fingerprint text,
  site_scope_fingerprint text,
  readiness_fingerprint text,
  row_fingerprint text,
  payable_minutes bigint,
  adjustment_minutes bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stored_run public.payroll_preparation_runs%rowtype;
  stored_period public.payroll_periods%rowtype;
  fingerprint_rows jsonb;
  readiness_rows jsonb;
  current_readiness jsonb;
begin
  select run.* into stored_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_organisation_id and run.id = target_run_id;
  if not found then
    return query select false, 'stale_run_missing'::text,
      repeat('0', 64), repeat('0', 64), repeat('0', 64), repeat('0', 64),
      repeat('0', 64), repeat('0', 64), 0::bigint, 0::bigint;
    return;
  end if;
  select period.* into stored_period
  from public.payroll_periods period
  where period.organisation_id = target_organisation_id
    and period.id = stored_run.period_id;
  if not found then
    return query select false, 'stale_period_missing'::text,
      repeat('0', 64), repeat('0', 64), repeat('0', 64), repeat('0', 64),
      repeat('0', 64), repeat('0', 64), 0::bigint, 0::bigint;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceKey', row_value.source_key,
    'staffId', row_value.staff_id,
    'siteId', row_value.site_id,
    'payArrangementId', row_value.pay_arrangement_id,
    'operationalDate', row_value.operational_date
  ) order by row_value.staff_id, row_value.operational_date, row_value.source_key), '[]'::jsonb)
    into fingerprint_rows
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_organisation_id
    and row_value.run_id = target_run_id
    and left(row_value.source_key, 19) <> 'adjustment-summary:';

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceKey', row_value.source_key,
    'staffId', row_value.staff_id,
    'siteId', row_value.site_id,
    'payArrangementId', row_value.pay_arrangement_id,
    'operationalDate', row_value.operational_date,
    'payableMinutes', row_value.payable_minutes,
    'adjustmentMinutes', row_value.adjustment_minutes
  ) order by row_value.staff_id, row_value.operational_date, row_value.source_key), '[]'::jsonb)
    into readiness_rows
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_organisation_id
    and row_value.run_id = target_run_id;

  attendance_fingerprint := private.payroll_attendance_fingerprint(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id, fingerprint_rows
  );
  adjustment_fingerprint := private.payroll_effective_adjustment_fingerprint(
    target_organisation_id, stored_period.id, stored_run.site_filter_id, null
  );
  pay_arrangement_fingerprint := private.payroll_authoritative_pay_arrangement_fingerprint(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id
  );
  site_scope_fingerprint := private.payroll_authoritative_site_scope_fingerprint(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id
  );
  current_readiness := private.payroll_authoritative_readiness(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id, readiness_rows
  );
  readiness_fingerprint := encode(extensions.digest(current_readiness::text, 'sha256'), 'hex');
  select encode(extensions.digest(coalesce(jsonb_agg(
      to_jsonb(row_value) - 'created_at'
      order by row_value.staff_id, row_value.operational_date, row_value.source_key
    ), '[]'::jsonb)::text, 'sha256'), 'hex'),
    coalesce(sum(row_value.payable_minutes)::bigint, 0),
    coalesce(sum(row_value.adjustment_minutes)::bigint, 0)
    into row_fingerprint, payable_minutes, adjustment_minutes
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_organisation_id
    and row_value.run_id = target_run_id;

  stale_code := case
    when stored_period.revision <> stored_run.revision then 'stale_period_revision'
    when attendance_fingerprint <> stored_run.authoritative_attendance_fingerprint
      then 'stale_attendance_fingerprint'
    when adjustment_fingerprint <> stored_run.adjustment_fingerprint
      then 'stale_adjustment_fingerprint'
    when pay_arrangement_fingerprint <> stored_run.authoritative_pay_arrangement_fingerprint
      then 'stale_pay_arrangement_fingerprint'
    when site_scope_fingerprint <> stored_run.site_scope_fingerprint
      then 'stale_site_scope_fingerprint'
    when readiness_fingerprint <> stored_run.readiness_fingerprint
      then 'stale_readiness'
    when row_fingerprint <> stored_run.row_fingerprint
      or payable_minutes <> stored_run.payable_minutes_total
      or adjustment_minutes <> stored_run.adjustment_minutes_total
      then 'stale_row_fingerprint'
    else null end;
  is_fresh := stale_code is null;
  return next;
end
$$;

revoke all on function private.validate_commercial_payroll_run_inputs(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.approve_commercial_payroll_preparation_v2(
  target_period_id uuid,
  expected_revision integer,
  target_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_context record;
  target_period public.payroll_periods%rowtype;
  target_run public.payroll_preparation_runs%rowtype;
  existing_approval public.payroll_approvals%rowtype;
  created_approval public.payroll_approvals%rowtype;
  validation record;
  command_request_digest text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'mfa_required');
  end if;
  select * into command_context
  from private.authorised_payroll_period(target_period_id, 'payroll.prepare');
  if not found then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || command_context.organisation_id::text || ':'
      || coalesce(target_operation_id::text, ''), 0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-period:' || command_context.organisation_id::text || ':'
      || target_period_id::text, 0
  ));
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id, 'expectedRevision', expected_revision,
    'command', 'approve_v2'
  ));

  select approval.* into existing_approval
  from public.payroll_approvals approval
  where approval.organisation_id = command_context.organisation_id
    and approval.operation_id = target_operation_id;
  if found then
    if existing_approval.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'approval_reused', 'reused', true,
      'organisationId', existing_approval.organisation_id,
      'periodId', existing_approval.period_id, 'runId', existing_approval.run_id,
      'approvalId', existing_approval.id, 'revision', existing_approval.revision,
      'status', existing_approval.status
    );
  end if;
  if expected_revision is null or target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id
    and period.id = target_period_id
  for update;
  if target_period.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'period_closed');
  end if;
  if target_period.revision <> expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision
    );
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id and run.revision = target_period.revision
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'preparation_required'); end if;
  if target_run.blocker_count > 0 then
    return jsonb_build_object('ok', false, 'code', 'blockers_present');
  end if;
  if target_run.warning_count > 0
     and target_run.warning_acknowledgement_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'warning_acknowledgement_required');
  end if;

  select * into validation
  from private.validate_commercial_payroll_run_inputs(
    target_period.organisation_id, target_run.id
  );
  if not validation.is_fresh then
    return jsonb_build_object('ok', false, 'code', validation.stale_code);
  end if;

  insert into public.payroll_approvals (
    organisation_id, period_id, run_id, revision, operation_id,
    request_expected_revision, request_digest, status,
    acknowledged_warning_codes, acknowledgement_note,
    created_by_membership_id, attendance_fingerprint, adjustment_fingerprint,
    pay_arrangement_fingerprint, site_scope_fingerprint, readiness_fingerprint,
    row_fingerprint, payable_minutes_total, adjustment_minutes_total
  ) values (
    target_period.organisation_id, target_period.id, target_run.id, target_run.revision,
    target_operation_id, expected_revision, command_request_digest, 'approved',
    coalesce(target_run.warning_acknowledged_codes, '{}'),
    target_run.warning_acknowledgement_note, command_context.membership_id,
    validation.attendance_fingerprint, validation.adjustment_fingerprint,
    validation.pay_arrangement_fingerprint, validation.site_scope_fingerprint,
    validation.readiness_fingerprint, validation.row_fingerprint,
    validation.payable_minutes, validation.adjustment_minutes
  ) returning * into created_approval;

  update public.payroll_preparation_runs run set status = 'approved'
  where run.organisation_id = target_run.organisation_id and run.id = target_run.id;
  update public.payroll_periods period
  set status = 'closed', closed_by_membership_id = command_context.membership_id,
      closed_at = now(), updated_at = now()
  where period.organisation_id = target_period.organisation_id and period.id = target_period.id;
  return jsonb_build_object(
    'ok', true, 'code', 'preparation_approved', 'reused', false,
    'organisationId', created_approval.organisation_id,
    'periodId', created_approval.period_id, 'runId', created_approval.run_id,
    'approvalId', created_approval.id, 'revision', created_approval.revision,
    'status', created_approval.status
  );
end
$$;

revoke all on function public.approve_commercial_payroll_preparation(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.approve_commercial_payroll_preparation_v2(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_commercial_payroll_preparation_v2(uuid, integer, uuid)
  to authenticated;

-- Sensitive payroll reporting is exposed only through exact-scope guarded RPCs.
create or replace view private.commercial_payroll_preparation_rows
with (security_invoker = true)
as
select row_value.*,
  case
    when left(row_value.source_key, 19) = 'adjustment-summary:' then 'adjustment_summary'
    when left(row_value.source_key, 14) = 'staff-summary:' then 'staff_summary'
    else 'attendance'
  end source_kind
from public.payroll_preparation_rows row_value;

revoke all on private.commercial_payroll_preparation_rows
  from public, anon, authenticated, service_role;

create or replace function public.get_commercial_payroll_run_report(
  target_run_id uuid,
  requested_site_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_run public.payroll_preparation_runs%rowtype;
  target_period public.payroll_periods%rowtype;
  validation record;
  report_rows jsonb;
  report_adjustments jsonb;
  report_targets jsonb;
  report_approval jsonb;
  report_export jsonb;
  site_display_name text;
begin
  if auth.uid() is null or target_run_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.id = target_run_id;
  if not found or private.current_membership_id(target_run.organisation_id) is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_run.site_filter_id is null then
    if requested_site_id is not null
       or not private.has_permission(target_run.organisation_id, 'payroll.read') then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  elsif requested_site_id is distinct from target_run.site_filter_id
     or not private.has_site_permission(
       target_run.organisation_id, target_run.site_filter_id, 'payroll.read'
     ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = target_run.organisation_id
    and period.id = target_run.period_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  select * into validation
  from private.validate_commercial_payroll_run_inputs(
    target_run.organisation_id, target_run.id
  );
  if target_run.site_filter_id is not null then
    select site.name into site_display_name
    from public.organisation_sites site
    where site.organisation_id = target_run.organisation_id
      and site.id = target_run.site_filter_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'rowId', row_value.id,
      'organisationId', row_value.organisation_id,
      'runId', row_value.run_id,
      'staffId', row_value.staff_id,
      'sourceKind', row_value.source_kind,
      'fullName', staff.full_name,
      'employmentRole', staff.employment_role,
      'siteId', row_value.site_id,
      'siteDisplayName', site.name,
      'operationalDate', row_value.operational_date,
      'payType', row_value.pay_type,
      'rawMinutes', row_value.raw_minutes,
      'adjustmentMinutes', row_value.adjustment_minutes,
      'payableMinutes', row_value.payable_minutes,
      'ordinaryMinutes', row_value.ordinary_minutes,
      'overtimeMinutes', row_value.overtime_minutes,
      'estimatedGrossValue', row_value.estimated_gross_value,
      'currencyCode', row_value.currency_code,
      'warnings', row_value.warnings
    ) order by row_value.operational_date, staff.full_name, row_value.id), '[]'::jsonb)
    into report_rows
  from private.commercial_payroll_preparation_rows row_value
  join public.staff_profiles staff
    on staff.organisation_id = row_value.organisation_id
   and staff.id = row_value.staff_id
  left join public.organisation_sites site
    on site.organisation_id = row_value.organisation_id
   and site.id = row_value.site_id
  where row_value.organisation_id = target_run.organisation_id
    and row_value.run_id = target_run.id
    and (target_run.site_filter_id is null
      or row_value.site_id = target_run.site_filter_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', effective.adjustment_id,
      'lineageRootId', effective.lineage_root_id,
      'staffId', effective.staff_id,
      'targetKind', effective.target_kind,
      'siteId', effective.site_id,
      'operationalDate', effective.operational_date,
      'adjustmentMinutes', effective.adjustment_minutes,
      'reason', effective.reason,
      'createdAt', effective.created_at
    ) order by effective.created_at desc, effective.adjustment_id), '[]'::jsonb)
    into report_adjustments
  from private.effective_commercial_payroll_adjustments(
    target_run.organisation_id, target_run.period_id,
    target_run.site_filter_id, target_run.id
  ) effective;

  select coalesce(jsonb_agg(target_value order by target_value ->> 'key'), '[]'::jsonb)
    into report_targets
  from (
    select distinct jsonb_build_object(
      'key', case
        when row_value.source_kind = 'staff_summary' and row_value.site_id is null
          then 'organisation-summary:' || row_value.staff_id
        when row_value.source_kind = 'staff_summary'
          then 'site-summary:' || row_value.staff_id || ':' || row_value.site_id::text
        else 'attendance:' || row_value.staff_id || ':' || row_value.site_id::text
          || ':' || row_value.operational_date::text end,
      'label', case
        when row_value.source_kind = 'staff_summary' and row_value.site_id is null
          then staff.full_name || ', organisation summary'
        when row_value.source_kind = 'staff_summary'
          then staff.full_name || ', ' || site.name || ', site summary'
        else staff.full_name || ', ' || site.name || ', '
          || to_char(row_value.operational_date, 'DD/MM/YYYY') end,
      'target', case
        when row_value.source_kind = 'staff_summary' and row_value.site_id is null
          then jsonb_build_object('kind', 'organisation_summary', 'staffId', row_value.staff_id,
            'siteId', null, 'operationalDate', null)
        when row_value.source_kind = 'staff_summary'
          then jsonb_build_object('kind', 'site_summary', 'staffId', row_value.staff_id,
            'siteId', row_value.site_id, 'operationalDate', null)
        else jsonb_build_object('kind', 'attendance', 'staffId', row_value.staff_id,
          'siteId', row_value.site_id, 'operationalDate', row_value.operational_date) end
    ) target_value
    from private.commercial_payroll_preparation_rows row_value
    join public.staff_profiles staff
      on staff.organisation_id = row_value.organisation_id and staff.id = row_value.staff_id
    left join public.organisation_sites site
      on site.organisation_id = row_value.organisation_id and site.id = row_value.site_id
    where row_value.organisation_id = target_run.organisation_id
      and row_value.run_id = target_run.id
      and row_value.source_kind <> 'adjustment_summary'
      and (target_run.site_filter_id is null
        or row_value.site_id = target_run.site_filter_id)
    union
    select distinct jsonb_build_object(
      'key', 'site-summary:' || staff.id || ':' || target_run.site_filter_id::text,
      'label', staff.full_name || ', ' || site.name || ', site summary',
      'target', jsonb_build_object(
        'kind', 'site_summary', 'staffId', staff.id,
        'siteId', target_run.site_filter_id, 'operationalDate', null
      )
    ) target_value
    from public.staff_profiles staff
    join public.staff_site_assignments assignment
      on assignment.organisation_id = staff.organisation_id
     and assignment.staff_id = staff.id
     and assignment.site_id = target_run.site_filter_id
     and assignment.effective_from <= target_period.period_end
     and (assignment.effective_to is null
       or assignment.effective_to >= target_period.period_start)
    join public.organisation_sites site
      on site.organisation_id = assignment.organisation_id
     and site.id = assignment.site_id
    where target_run.site_filter_id is not null
      and staff.organisation_id = target_run.organisation_id
      and staff.active
      and not exists (
        select 1
        from private.commercial_payroll_preparation_rows attendance_row
        where attendance_row.organisation_id = target_run.organisation_id
          and attendance_row.run_id = target_run.id
          and attendance_row.staff_id = staff.id
          and attendance_row.source_kind = 'attendance'
      )
  ) targets;

  select jsonb_build_object('id', approval.id, 'status', approval.status)
    into report_approval
  from public.payroll_approvals approval
  where approval.organisation_id = target_run.organisation_id
    and approval.period_id = target_run.period_id
    and approval.run_id = target_run.id
    and approval.revision = target_run.revision
  order by approval.created_at desc limit 1;
  select jsonb_build_object(
      'fileName', audit.file_name, 'createdAt', audit.created_at,
      'revision', audit.revision
    ) into report_export
  from public.payroll_export_audits audit
  where audit.organisation_id = target_run.organisation_id
    and audit.period_id = target_run.period_id
    and audit.run_id = target_run.id
    and audit.revision = target_run.revision
  order by audit.created_at desc limit 1;

  return jsonb_build_object(
    'ok', true, 'code', 'report_loaded',
    'organisationId', target_run.organisation_id,
    'periodId', target_run.period_id,
    'isFresh', validation.is_fresh,
    'staleCode', validation.stale_code,
    'run', jsonb_build_object(
      'id', target_run.id, 'status', target_run.status,
      'revision', target_run.revision,
      'blockerCount', target_run.blocker_count,
      'warningCount', target_run.warning_count,
      'informationalCount', target_run.informational_count,
      'siteFilterId', target_run.site_filter_id,
      'siteFilterDisplayName', site_display_name,
      'warningCodes', coalesce((select jsonb_agg(code order by code) from (
        select distinct issue ->> 'code' code
        from jsonb_array_elements(target_run.readiness -> 'issues') issue
        where issue ->> 'severity' = 'warning'
      ) warning_values), '[]'::jsonb),
      'warningsAcknowledged', target_run.warning_acknowledgement_operation_id is not null
    ),
    'approval', report_approval,
    'lastExport', report_export,
    'rows', report_rows,
    'adjustments', report_adjustments,
    'adjustmentTargets', report_targets
  );
end
$$;

revoke all on function public.get_commercial_payroll_run_report(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_commercial_payroll_run_report(uuid, uuid)
  to authenticated;

create or replace function public.get_commercial_approved_payroll_export(
  target_approval_id uuid,
  expected_revision integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_approval public.payroll_approvals%rowtype;
  target_run public.payroll_preparation_runs%rowtype;
  target_period public.payroll_periods%rowtype;
  validation record;
  export_rows jsonb;
  export_adjustments jsonb;
  organisation_display_name text;
  site_display_name text;
begin
  if auth.uid() is null or target_approval_id is null or expected_revision is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select approval.* into target_approval
  from public.payroll_approvals approval
  where approval.id = target_approval_id
    and approval.revision = expected_revision
    and approval.status = 'approved';
  if not found or private.current_membership_id(target_approval.organisation_id) is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_approval.organisation_id
    and run.period_id = target_approval.period_id
    and run.id = target_approval.run_id
    and run.revision = target_approval.revision
    and run.status = 'approved';
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if target_run.site_filter_id is null then
    if not private.has_permission(target_run.organisation_id, 'payroll.read')
       or not private.has_permission(target_run.organisation_id, 'payroll.export') then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  elsif not private.has_site_permission(
      target_run.organisation_id, target_run.site_filter_id, 'payroll.read'
    ) or not private.has_site_permission(
      target_run.organisation_id, target_run.site_filter_id, 'payroll.export'
    ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = target_run.organisation_id
    and period.id = target_run.period_id
    and period.revision = expected_revision
    and period.status = 'closed';
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select * into validation
  from private.validate_commercial_payroll_run_inputs(
    target_run.organisation_id, target_run.id
  );
  if not validation.is_fresh then
    return jsonb_build_object('ok', false, 'code', validation.stale_code);
  end if;
  if target_approval.attendance_fingerprint is distinct from validation.attendance_fingerprint
     or target_approval.adjustment_fingerprint is distinct from validation.adjustment_fingerprint
     or target_approval.pay_arrangement_fingerprint is distinct from validation.pay_arrangement_fingerprint
     or target_approval.site_scope_fingerprint is distinct from validation.site_scope_fingerprint
     or target_approval.readiness_fingerprint is distinct from validation.readiness_fingerprint
     or target_approval.row_fingerprint is distinct from validation.row_fingerprint
     or target_approval.payable_minutes_total is distinct from validation.payable_minutes
     or target_approval.adjustment_minutes_total is distinct from validation.adjustment_minutes then
    return jsonb_build_object('ok', false, 'code', 'stale_approval_evidence');
  end if;

  select organisation.display_name into organisation_display_name
  from public.organisations organisation where organisation.id = target_run.organisation_id;
  if target_run.site_filter_id is not null then
    select site.name into site_display_name from public.organisation_sites site
    where site.organisation_id = target_run.organisation_id
      and site.id = target_run.site_filter_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'rowId', row_value.id,
      'organisationId', row_value.organisation_id,
      'runId', row_value.run_id,
      'staffId', row_value.staff_id,
      'sourceKind', row_value.source_kind,
      'fullName', staff.full_name,
      'employmentRole', staff.employment_role,
      'siteId', row_value.site_id,
      'siteDisplayName', site.name,
      'operationalDate', row_value.operational_date,
      'payType', row_value.pay_type,
      'rawMinutes', row_value.raw_minutes,
      'adjustmentMinutes', row_value.adjustment_minutes,
      'payableMinutes', row_value.payable_minutes,
      'ordinaryMinutes', row_value.ordinary_minutes,
      'overtimeMinutes', row_value.overtime_minutes,
      'estimatedGrossValue', row_value.estimated_gross_value,
      'currencyCode', row_value.currency_code,
      'warnings', row_value.warnings
    ) order by row_value.operational_date, staff.full_name, row_value.id), '[]'::jsonb)
    into export_rows
  from private.commercial_payroll_preparation_rows row_value
  join public.staff_profiles staff
    on staff.organisation_id = row_value.organisation_id and staff.id = row_value.staff_id
  left join public.organisation_sites site
    on site.organisation_id = row_value.organisation_id and site.id = row_value.site_id
  where row_value.organisation_id = target_run.organisation_id
    and row_value.run_id = target_run.id
    and (target_run.site_filter_id is null
      or row_value.site_id = target_run.site_filter_id);
  select coalesce(jsonb_agg(jsonb_build_object(
      'adjustmentId', effective.adjustment_id,
      'lineageRootId', effective.lineage_root_id,
      'staffId', effective.staff_id,
      'targetKind', effective.target_kind,
      'siteId', effective.site_id,
      'operationalDate', effective.operational_date,
      'adjustmentMinutes', effective.adjustment_minutes,
      'reason', effective.reason,
      'createdAt', effective.created_at
    ) order by effective.adjustment_id), '[]'::jsonb)
    into export_adjustments
  from private.effective_commercial_payroll_adjustments(
    target_run.organisation_id, target_run.period_id,
    target_run.site_filter_id, target_run.id
  ) effective;
  return jsonb_build_object(
    'ok', true, 'code', 'approved_export_loaded',
    'organisationId', target_run.organisation_id,
    'organisationDisplayName', organisation_display_name,
    'siteId', target_run.site_filter_id,
    'siteDisplayName', site_display_name,
    'periodId', target_period.id,
    'periodStart', target_period.period_start,
    'periodEnd', target_period.period_end,
    'runId', target_run.id,
    'approvalId', target_approval.id,
    'revision', target_run.revision,
    'approvalStatus', target_approval.status,
    'rowFingerprint', validation.row_fingerprint,
    'payableMinutes', validation.payable_minutes,
    'adjustmentMinutes', validation.adjustment_minutes,
    'readiness', jsonb_build_object(
      'blocker', target_run.blocker_count,
      'warning', target_run.warning_count,
      'informational', target_run.informational_count
    ),
    'rows', export_rows,
    'adjustmentSnapshots', export_adjustments
  );
end
$$;

revoke all on function public.get_commercial_approved_payroll_export(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_commercial_approved_payroll_export(uuid, integer)
  to authenticated;

create or replace function public.record_commercial_payroll_export_v2(
  target_period_id uuid,
  target_approval_id uuid,
  expected_revision integer,
  target_operation_id uuid,
  target_export_format public.payroll_export_format,
  target_file_name text,
  target_file_sha256 text,
  target_row_count integer,
  target_row_fingerprint text,
  target_payable_minutes bigint,
  target_adjustment_minutes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_approval public.payroll_approvals%rowtype;
  target_run public.payroll_preparation_runs%rowtype;
  target_period public.payroll_periods%rowtype;
  existing_export public.payroll_export_audits%rowtype;
  created_export public.payroll_export_audits%rowtype;
  validation record;
  command_request_digest text;
  actor_membership_id uuid;
  authoritative_row_count integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'permission_denied');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'aal2_required');
  end if;
  select approval.* into target_approval
  from public.payroll_approvals approval
  where approval.id = target_approval_id
    and approval.period_id = target_period_id
    and approval.status = 'approved';
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  actor_membership_id := private.current_membership_id(target_approval.organisation_id);
  if actor_membership_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_approval.organisation_id
    and run.period_id = target_approval.period_id
    and run.id = target_approval.run_id
    and run.revision = target_approval.revision
    and run.status = 'approved';
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if target_run.site_filter_id is null then
    if not private.has_permission(target_run.organisation_id, 'payroll.export') then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  elsif not private.has_site_permission(
    target_run.organisation_id, target_run.site_filter_id, 'payroll.export'
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_operation_id is null
     or length(btrim(coalesce(target_file_name, ''))) not between 1 and 255
     or target_file_name ~ '[\\/[:cntrl:]]'
     or target_file_sha256 !~ '^[0-9a-f]{64}$'
     or target_row_count is null or target_row_count < 0
     or target_row_fingerprint !~ '^[0-9a-f]{64}$'
     or target_payable_minutes is null or target_adjustment_minutes is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_export');
  end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'record_export_v2', 'periodId', target_period_id,
    'approvalId', target_approval_id, 'expectedRevision', expected_revision,
    'exportFormat', target_export_format, 'fileName', btrim(target_file_name),
    'fileSha256', target_file_sha256, 'rowCount', target_row_count,
    'rowFingerprint', target_row_fingerprint,
    'payableMinutes', target_payable_minutes,
    'adjustmentMinutes', target_adjustment_minutes
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-export-operation:' || target_run.organisation_id::text
      || ':' || target_operation_id::text, 0
  ));
  select audit.* into existing_export
  from public.payroll_export_audits audit
  where audit.organisation_id = target_run.organisation_id
    and audit.operation_id = target_operation_id;
  if found then
    if existing_export.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'export_reused', 'reused', true,
      'organisationId', existing_export.organisation_id,
      'periodId', existing_export.period_id, 'runId', existing_export.run_id,
      'approvalId', existing_export.approval_id,
      'exportAuditId', existing_export.id, 'revision', existing_export.revision
    );
  end if;
  if target_approval.revision is distinct from expected_revision then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-adjustment-period:' || target_run.organisation_id::text
      || ':' || target_period_id::text, 0
  ));
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = target_run.organisation_id
    and period.id = target_period_id
  for update;
  if not found or target_period.status <> 'closed'
     or target_period.revision <> expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision');
  end if;
  select * into validation
  from private.validate_commercial_payroll_run_inputs(
    target_run.organisation_id, target_run.id
  );
  if not validation.is_fresh then
    return jsonb_build_object('ok', false, 'code', validation.stale_code);
  end if;
  if target_approval.attendance_fingerprint is distinct from validation.attendance_fingerprint
     or target_approval.adjustment_fingerprint is distinct from validation.adjustment_fingerprint
     or target_approval.pay_arrangement_fingerprint is distinct from validation.pay_arrangement_fingerprint
     or target_approval.site_scope_fingerprint is distinct from validation.site_scope_fingerprint
     or target_approval.readiness_fingerprint is distinct from validation.readiness_fingerprint
     or target_approval.row_fingerprint is distinct from validation.row_fingerprint
     or target_approval.payable_minutes_total is distinct from validation.payable_minutes
     or target_approval.adjustment_minutes_total is distinct from validation.adjustment_minutes
     or target_row_fingerprint is distinct from validation.row_fingerprint
     or target_payable_minutes is distinct from validation.payable_minutes
     or target_adjustment_minutes is distinct from validation.adjustment_minutes then
    return jsonb_build_object('ok', false, 'code', 'export_evidence_mismatch');
  end if;
  select count(*)::integer into authoritative_row_count
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_run.organisation_id
    and row_value.run_id = target_run.id
    and (target_run.site_filter_id is null
      or row_value.site_id = target_run.site_filter_id);
  if target_row_count <> authoritative_row_count then
    return jsonb_build_object('ok', false, 'code', 'export_evidence_mismatch');
  end if;

  insert into public.payroll_export_audits (
    organisation_id, period_id, run_id, approval_id, revision, operation_id,
    request_expected_revision, request_digest, export_format, site_id,
    file_name, file_sha256, row_count, filter_metadata,
    created_by_membership_id, attendance_fingerprint, adjustment_fingerprint,
    pay_arrangement_fingerprint, site_scope_fingerprint, readiness_fingerprint,
    row_fingerprint, payable_minutes_total, adjustment_minutes_total
  ) values (
    target_run.organisation_id, target_period.id, target_run.id, target_approval.id,
    target_run.revision, target_operation_id, expected_revision,
    command_request_digest, target_export_format, target_run.site_filter_id,
    btrim(target_file_name), target_file_sha256, authoritative_row_count,
    jsonb_build_object('siteId', target_run.site_filter_id,
      'runId', target_run.id, 'revision', target_run.revision),
    actor_membership_id, validation.attendance_fingerprint,
    validation.adjustment_fingerprint, validation.pay_arrangement_fingerprint,
    validation.site_scope_fingerprint, validation.readiness_fingerprint,
    validation.row_fingerprint, validation.payable_minutes,
    validation.adjustment_minutes
  ) returning * into created_export;
  return jsonb_build_object(
    'ok', true, 'code', 'export_recorded', 'reused', false,
    'organisationId', created_export.organisation_id,
    'periodId', created_export.period_id, 'runId', created_export.run_id,
    'approvalId', created_export.approval_id,
    'exportAuditId', created_export.id, 'revision', created_export.revision
  );
end
$$;

revoke all on function public.record_commercial_payroll_export(
  uuid, uuid, integer, uuid, public.payroll_export_format, uuid,
  text, text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.record_commercial_payroll_export_v2(
  uuid, uuid, integer, uuid, public.payroll_export_format,
  text, text, integer, text, bigint, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.record_commercial_payroll_export_v2(
  uuid, uuid, integer, uuid, public.payroll_export_format,
  text, text, integer, text, bigint, bigint
) to authenticated;
