-- Workstream 6 final review fixes. Commercial pay data remains RPC-owned,
-- original attendance evidence is untouched, and Jan's unowned policies stay explicit.

drop policy if exists staff_pay_arrangements_commercial_write on public.staff_pay_arrangements;

create table public.payroll_pay_arrangement_change_audits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  staff_id text not null,
  previous_arrangement_id uuid,
  replacement_arrangement_id uuid not null,
  operation_id uuid not null,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  change_reason text not null check (length(btrim(change_reason)) between 5 and 2000),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, operation_id),
  foreign key (organisation_id, staff_id)
    references public.staff_profiles(organisation_id, id) on delete restrict,
  foreign key (organisation_id, previous_arrangement_id)
    references public.staff_pay_arrangements(organisation_id, id) on delete restrict,
  foreign key (organisation_id, replacement_arrangement_id)
    references public.staff_pay_arrangements(organisation_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict
);

alter table public.payroll_pay_arrangement_change_audits enable row level security;
create policy payroll_pay_arrangement_change_audits_commercial_read
on public.payroll_pay_arrangement_change_audits for select to authenticated
using (private.has_permission(organisation_id, 'payroll.read'));
revoke all on public.payroll_pay_arrangement_change_audits from anon, authenticated;
grant select on public.payroll_pay_arrangement_change_audits to authenticated;
create index payroll_pay_arrangement_change_audits_staff_idx
  on public.payroll_pay_arrangement_change_audits (organisation_id, staff_id, created_at desc);
create index payroll_pay_arrangement_change_audits_actor_idx
  on public.payroll_pay_arrangement_change_audits (organisation_id, created_by_membership_id);

create or replace function public.create_commercial_staff_pay_arrangement(
  target_organisation_id uuid,
  target_operation_id uuid,
  target_staff_id text,
  target_site_id uuid,
  target_supersedes_arrangement_id uuid,
  target_pay_type public.payroll_pay_type,
  target_hourly_rate numeric,
  target_annual_salary numeric,
  target_monthly_salary numeric,
  target_contracted_weekly_hours numeric,
  target_hours_basis text,
  target_standard_daily_hours numeric,
  target_overtime_multiplier numeric,
  target_effective_from date,
  target_change_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  prior_arrangement public.staff_pay_arrangements%rowtype;
  created_arrangement public.staff_pay_arrangements%rowtype;
  existing_audit public.payroll_pay_arrangement_change_audits%rowtype;
  command_request_digest text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'mfa_required');
  end if;
  actor_membership_id := private.payroll_command_actor(target_organisation_id, 'payroll.prepare');
  if actor_membership_id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'create_pay_arrangement',
    'organisationId', target_organisation_id,
    'staffId', target_staff_id,
    'siteId', target_site_id,
    'supersedesArrangementId', target_supersedes_arrangement_id,
    'payType', target_pay_type,
    'hourlyRate', target_hourly_rate,
    'annualSalary', target_annual_salary,
    'monthlySalary', target_monthly_salary,
    'contractedWeeklyHours', target_contracted_weekly_hours,
    'hoursBasis', target_hours_basis,
    'standardDailyHours', target_standard_daily_hours,
    'overtimeMultiplier', target_overtime_multiplier,
    'effectiveFrom', target_effective_from,
    'reason', case when target_change_reason is null then null else btrim(target_change_reason) end
  ));
  if target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'pay-arrangement-operation:' || target_organisation_id::text || ':' || target_operation_id::text, 0
  ));
  select audit.* into existing_audit
  from public.payroll_pay_arrangement_change_audits audit
  where audit.organisation_id = target_organisation_id and audit.operation_id = target_operation_id;
  if found then
    if existing_audit.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'pay_arrangement_reused', 'reused', true,
      'organisationId', existing_audit.organisation_id,
      'arrangementId', existing_audit.replacement_arrangement_id
    );
  end if;
  if target_effective_from is null
     or length(btrim(coalesce(target_change_reason, ''))) not between 5 and 2000
     or target_hours_basis not in ('contracted', 'variable_hours', 'casual', 'zero_hours', 'salaried_untracked')
     or target_overtime_multiplier is null or target_overtime_multiplier not between 1 and 5
     or (target_standard_daily_hours is not null and target_standard_daily_hours not between 0.25 and 24)
     or (target_hours_basis = 'contracted' and (
       target_contracted_weekly_hours is null or target_contracted_weekly_hours <= 0
       or target_contracted_weekly_hours > 80
     ))
     or (target_hours_basis <> 'contracted' and target_contracted_weekly_hours is not null)
     or (target_pay_type = 'hourly' and (
       target_hourly_rate is null or target_hourly_rate <= 0
       or target_annual_salary is not null or target_monthly_salary is not null
     ))
     or (target_pay_type = 'salaried' and (
       target_hourly_rate is not null or not (
         (target_annual_salary is not null and target_annual_salary > 0 and target_monthly_salary is null)
         or (target_monthly_salary is not null and target_monthly_salary > 0 and target_annual_salary is null)
       )
     )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_pay_arrangement');
  end if;
  if not exists (
    select 1 from public.staff_profiles staff
    where staff.organisation_id = target_organisation_id and staff.id = target_staff_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_staff');
  end if;
  if target_site_id is not null and not exists (
    select 1 from public.organisation_sites site
    where site.organisation_id = target_organisation_id and site.id = target_site_id
      and site.active and site.archived_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site');
  end if;
  if target_supersedes_arrangement_id is not null then
    select arrangement.* into prior_arrangement
    from public.staff_pay_arrangements arrangement
    where arrangement.organisation_id = target_organisation_id
      and arrangement.id = target_supersedes_arrangement_id
      and arrangement.staff_id = target_staff_id
      and arrangement.is_active
    for update;
    if not found or target_effective_from <= prior_arrangement.effective_from
       or (prior_arrangement.effective_to is not null
         and target_effective_from > prior_arrangement.effective_to) then
      return jsonb_build_object('ok', false, 'code', 'invalid_superseded_arrangement');
    end if;
    update public.staff_pay_arrangements arrangement
    set effective_to = target_effective_from - 1,
        updated_by = null,
        updated_by_membership_id = actor_membership_id,
        updated_at = now()
    where arrangement.organisation_id = target_organisation_id
      and arrangement.id = prior_arrangement.id;
  elsif exists (
    select 1 from public.staff_pay_arrangements arrangement
    where arrangement.organisation_id = target_organisation_id
      and arrangement.staff_id = target_staff_id and arrangement.is_active
      and daterange(arrangement.effective_from, coalesce(arrangement.effective_to + 1, 'infinity'::date), '[)')
        && daterange(target_effective_from, 'infinity'::date, '[)')
  ) then
    return jsonb_build_object('ok', false, 'code', 'pay_arrangement_overlap');
  end if;

  insert into public.staff_pay_arrangements (
    organisation_id, site_id, staff_id, pay_type, hourly_rate, annual_salary,
    monthly_salary, contracted_weekly_hours, hours_basis, standard_daily_hours,
    overtime_multiplier, effective_from, effective_to, is_active, manager_notes,
    created_by, updated_by, created_by_membership_id, updated_by_membership_id
  ) values (
    target_organisation_id, target_site_id, target_staff_id, target_pay_type,
    target_hourly_rate, target_annual_salary, target_monthly_salary,
    target_contracted_weekly_hours, target_hours_basis, target_standard_daily_hours,
    target_overtime_multiplier, target_effective_from, null, true,
    btrim(target_change_reason), null, null, actor_membership_id, actor_membership_id
  ) returning * into created_arrangement;

  insert into public.payroll_pay_arrangement_change_audits (
    organisation_id, staff_id, previous_arrangement_id, replacement_arrangement_id,
    operation_id, request_digest, change_reason, created_by_membership_id
  ) values (
    target_organisation_id, target_staff_id, target_supersedes_arrangement_id,
    created_arrangement.id, target_operation_id, command_request_digest,
    btrim(target_change_reason), actor_membership_id
  );
  return jsonb_build_object(
    'ok', true, 'code', 'pay_arrangement_created', 'reused', false,
    'organisationId', target_organisation_id, 'arrangementId', created_arrangement.id
  );
end
$$;

revoke all on function public.create_commercial_staff_pay_arrangement(
  uuid, uuid, text, uuid, uuid, public.payroll_pay_type, numeric, numeric, numeric,
  numeric, text, numeric, numeric, date, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_commercial_staff_pay_arrangement(
  uuid, uuid, text, uuid, uuid, public.payroll_pay_type, numeric, numeric, numeric,
  numeric, text, numeric, numeric, date, text
) to authenticated;

alter table public.payroll_adjustments
  add column carried_from_adjustment_id uuid,
  add constraint payroll_adjustments_carried_from_fk
    foreign key (organisation_id, carried_from_adjustment_id)
    references public.payroll_adjustments(organisation_id, id) on delete restrict;
create index payroll_adjustments_carried_from_idx
  on public.payroll_adjustments (organisation_id, carried_from_adjustment_id)
  where carried_from_adjustment_id is not null;

create table public.payroll_adjustment_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  period_id uuid not null,
  adjustment_id uuid not null,
  operation_id uuid not null,
  request_expected_revision integer not null check (request_expected_revision > 0),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  resolution text not null check (resolution in ('void', 'carry_forward')),
  reason text not null check (length(btrim(reason)) between 5 and 2000),
  applied_run_id uuid,
  applied_revision integer,
  applied_adjustment_id uuid,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (organisation_id, id),
  unique (organisation_id, operation_id),
  foreign key (organisation_id, period_id) references public.payroll_periods(organisation_id, id) on delete restrict,
  foreign key (organisation_id, adjustment_id) references public.payroll_adjustments(organisation_id, id) on delete restrict,
  foreign key (organisation_id, applied_run_id) references public.payroll_preparation_runs(organisation_id, id) on delete restrict,
  foreign key (organisation_id, applied_adjustment_id) references public.payroll_adjustments(organisation_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  constraint payroll_adjustment_lifecycle_application check (
    (resolution = 'void' and applied_run_id is null and applied_revision is null
      and applied_adjustment_id is null and applied_at is null)
    or (resolution = 'carry_forward' and (
      (applied_run_id is null and applied_revision is null and applied_adjustment_id is null and applied_at is null)
      or (applied_run_id is not null and applied_revision is not null
        and applied_adjustment_id is not null and applied_at is not null)
    ))
  )
);
alter table public.payroll_adjustment_lifecycle_events enable row level security;
create policy payroll_adjustment_lifecycle_events_commercial_read
on public.payroll_adjustment_lifecycle_events for select to authenticated
using (private.has_permission(organisation_id, 'payroll.read'));
revoke all on public.payroll_adjustment_lifecycle_events from anon, authenticated;
grant select on public.payroll_adjustment_lifecycle_events to authenticated;
create index payroll_adjustment_lifecycle_events_period_idx
  on public.payroll_adjustment_lifecycle_events (organisation_id, period_id, created_at desc);
create index payroll_adjustment_lifecycle_events_adjustment_idx
  on public.payroll_adjustment_lifecycle_events (organisation_id, adjustment_id, created_at desc);

create or replace function public.resolve_commercial_payroll_adjustment(
  target_period_id uuid,
  expected_revision integer,
  target_adjustment_id uuid,
  target_operation_id uuid,
  target_resolution text,
  resolution_reason text
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
  target_adjustment public.payroll_adjustments%rowtype;
  existing_event public.payroll_adjustment_lifecycle_events%rowtype;
  command_request_digest text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'mfa_required');
  end if;
  select * into command_context
  from private.authorised_payroll_period(target_period_id, 'payroll.prepare');
  if not found then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'resolve_adjustment', 'periodId', target_period_id,
    'expectedRevision', expected_revision, 'adjustmentId', target_adjustment_id,
    'resolution', target_resolution,
    'reason', case when resolution_reason is null then null else btrim(resolution_reason) end
  ));
  if target_operation_id is null or target_adjustment_id is null
     or target_resolution not in ('void', 'carry_forward')
     or length(btrim(coalesce(resolution_reason, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || command_context.organisation_id::text || ':' || target_operation_id::text, 0
  ));
  select event.* into existing_event
  from public.payroll_adjustment_lifecycle_events event
  where event.organisation_id = command_context.organisation_id and event.operation_id = target_operation_id;
  if found then
    if existing_event.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', case when existing_event.resolution = 'void' then 'adjustment_voided'
        else 'adjustment_carry_forward_queued' end,
      'reused', true, 'organisationId', existing_event.organisation_id,
      'periodId', existing_event.period_id, 'adjustmentId', existing_event.adjustment_id
    );
  end if;
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id and period.id = target_period_id
  for update;
  if target_period.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'period_closed'); end if;
  if target_period.revision <> expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision);
  end if;
  select run.* into target_run from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id and run.revision = target_period.revision;
  select adjustment.* into target_adjustment
  from public.payroll_adjustments adjustment
  where adjustment.organisation_id = target_period.organisation_id
    and adjustment.period_id = target_period.id and adjustment.id = target_adjustment_id
    and adjustment.run_id = target_run.id and adjustment.status = 'active'
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'adjustment_unavailable'); end if;

  insert into public.payroll_adjustment_lifecycle_events (
    organisation_id, period_id, adjustment_id, operation_id, request_expected_revision,
    request_digest, resolution, reason, created_by_membership_id
  ) values (
    target_period.organisation_id, target_period.id, target_adjustment.id, target_operation_id,
    expected_revision, command_request_digest, target_resolution, btrim(resolution_reason),
    command_context.membership_id
  );
  update public.payroll_adjustments adjustment
  set status = case when target_resolution = 'void' then 'voided'::public.payroll_adjustment_status
    else 'superseded'::public.payroll_adjustment_status end
  where adjustment.organisation_id = target_adjustment.organisation_id
    and adjustment.id = target_adjustment.id;
  return jsonb_build_object(
    'ok', true,
    'code', case when target_resolution = 'void' then 'adjustment_voided'
      else 'adjustment_carry_forward_queued' end,
    'reused', false, 'organisationId', target_period.organisation_id,
    'periodId', target_period.id, 'adjustmentId', target_adjustment.id,
    'revision', target_period.revision
  );
end
$$;

revoke all on function public.resolve_commercial_payroll_adjustment(uuid, integer, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_commercial_payroll_adjustment(uuid, integer, uuid, uuid, text, text)
  to authenticated;

create or replace function private.apply_pending_payroll_adjustment_carry_forwards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.payroll_preparation_runs%rowtype;
  lifecycle_event record;
  target_row public.payroll_preparation_rows%rowtype;
  created_adjustment_id uuid;
  adjusted_rows jsonb;
  applied_count integer := 0;
begin
  if new.revision = old.revision then return new; end if;
  select run.* into target_run from public.payroll_preparation_runs run
  where run.organisation_id = new.organisation_id and run.period_id = new.id
    and run.revision = new.revision;
  if not found then return new; end if;
  for lifecycle_event in
    select event.*, adjustment.staff_id, adjustment.site_id, adjustment.source_key,
      adjustment.adjustment_minutes, adjustment.reason adjustment_reason
    from public.payroll_adjustment_lifecycle_events event
    join public.payroll_adjustments adjustment
      on adjustment.organisation_id = event.organisation_id and adjustment.id = event.adjustment_id
    where event.organisation_id = new.organisation_id and event.period_id = new.id
      and event.resolution = 'carry_forward' and event.applied_adjustment_id is null
    order by event.created_at, event.id
    for update of event
  loop
    select row_value.* into target_row from public.payroll_preparation_rows row_value
    where row_value.organisation_id = new.organisation_id and row_value.run_id = target_run.id
      and row_value.staff_id = lifecycle_event.staff_id
      and row_value.source_key = lifecycle_event.source_key
    for update;
    if not found then
      raise exception 'Payroll adjustment carry-forward source is unavailable';
    end if;
    if target_row.payable_minutes + lifecycle_event.adjustment_minutes < 0
       or target_row.adjustment_minutes + lifecycle_event.adjustment_minutes not between -10080 and 10080 then
      raise exception 'Payroll adjustment carry-forward is outside the allowed range';
    end if;
    select jsonb_agg(jsonb_build_object(
      'sourceKey', row_value.source_key, 'staffId', row_value.staff_id,
      'siteId', row_value.site_id, 'payArrangementId', row_value.pay_arrangement_id,
      'operationalDate', row_value.operational_date,
      'payableMinutes', case when row_value.id = target_row.id
        then row_value.payable_minutes + lifecycle_event.adjustment_minutes
        else row_value.payable_minutes end,
      'payType', row_value.pay_type, 'payRegimeKey', row_value.pay_regime_key,
      'ordinaryMinutesLimit', row_value.ordinary_minutes_limit,
      'hourlyRate', row_value.hourly_rate,
      'overtimeMultiplier', row_value.overtime_multiplier
    ) order by row_value.staff_id, row_value.operational_date,
      coalesce(row_value.site_id::text, ''), row_value.source_key)
    into adjusted_rows
    from public.payroll_preparation_rows row_value
    where row_value.organisation_id = new.organisation_id and row_value.run_id = target_run.id;
    update public.payroll_preparation_rows row_value
    set adjustment_minutes = case when row_value.id = target_row.id
          then row_value.adjustment_minutes + lifecycle_event.adjustment_minutes
          else row_value.adjustment_minutes end,
        payable_minutes = case when row_value.id = target_row.id
          then row_value.payable_minutes + lifecycle_event.adjustment_minutes
          else row_value.payable_minutes end,
        ordinary_minutes = canonical.ordinary_minutes,
        overtime_minutes = canonical.overtime_minutes,
        estimated_gross_value = canonical.estimated_gross_value
    from private.payroll_snapshot_arithmetic(adjusted_rows) canonical
    where row_value.organisation_id = new.organisation_id and row_value.run_id = target_run.id
      and row_value.source_key = canonical.source_key;
    insert into public.payroll_adjustments (
      organisation_id, period_id, run_id, revision, staff_id, site_id,
      operation_id, request_expected_revision, request_digest, source_key,
      adjustment_minutes, reason, status, carried_from_adjustment_id,
      created_by_membership_id
    ) values (
      new.organisation_id, new.id, target_run.id, target_run.revision,
      lifecycle_event.staff_id, lifecycle_event.site_id, lifecycle_event.operation_id,
      lifecycle_event.request_expected_revision, lifecycle_event.request_digest,
      lifecycle_event.source_key, lifecycle_event.adjustment_minutes,
      lifecycle_event.adjustment_reason, 'active', lifecycle_event.adjustment_id,
      lifecycle_event.created_by_membership_id
    ) returning id into created_adjustment_id;
    update public.payroll_adjustment_lifecycle_events event
    set applied_run_id = target_run.id, applied_revision = target_run.revision,
        applied_adjustment_id = created_adjustment_id, applied_at = now()
    where event.organisation_id = lifecycle_event.organisation_id and event.id = lifecycle_event.id;
    applied_count := applied_count + 1;
  end loop;
  if applied_count > 0 then
    select jsonb_agg(jsonb_build_object(
      'sourceKey', row_value.source_key, 'staffId', row_value.staff_id,
      'siteId', row_value.site_id, 'payArrangementId', row_value.pay_arrangement_id,
      'operationalDate', row_value.operational_date, 'payableMinutes', row_value.payable_minutes,
      'payType', row_value.pay_type, 'payRegimeKey', row_value.pay_regime_key,
      'ordinaryMinutesLimit', row_value.ordinary_minutes_limit,
      'hourlyRate', row_value.hourly_rate, 'overtimeMultiplier', row_value.overtime_multiplier
    ) order by row_value.staff_id, row_value.operational_date,
      coalesce(row_value.site_id::text, ''), row_value.source_key)
    into adjusted_rows
    from public.payroll_preparation_rows row_value
    where row_value.organisation_id = new.organisation_id and row_value.run_id = target_run.id;
    update public.payroll_preparation_rows row_value
    set ordinary_minutes = canonical.ordinary_minutes,
        overtime_minutes = canonical.overtime_minutes,
        estimated_gross_value = canonical.estimated_gross_value
    from private.payroll_snapshot_arithmetic(adjusted_rows) canonical
    where row_value.organisation_id = new.organisation_id and row_value.run_id = target_run.id
      and row_value.source_key = canonical.source_key;
  end if;
  return new;
end
$$;

revoke all on function private.apply_pending_payroll_adjustment_carry_forwards()
  from public, anon, authenticated, service_role;
create trigger payroll_periods_apply_adjustment_carry_forwards
after update of revision on public.payroll_periods
for each row execute function private.apply_pending_payroll_adjustment_carry_forwards();

-- Attendance rows retain the original evidence validator. Staff-summary rows are
-- validated independently so a zero-attendance employee never becomes invented
-- site or clock evidence.
alter function private.payroll_authoritative_readiness(uuid, date, date, uuid, jsonb)
  rename to payroll_authoritative_attendance_readiness;
alter function private.validate_payroll_snapshot(uuid, date, date, uuid, jsonb, jsonb)
  rename to validate_payroll_attendance_snapshot;

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
  with attendance_rows as (
    select coalesce(jsonb_agg(row_value), '[]'::jsonb) rows
    from jsonb_array_elements(preparation_rows) row_value
    where left(coalesce(row_value ->> 'sourceKey', ''), 14) <> 'staff-summary:'
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
    from jsonb_array_elements(preparation_rows) row_value
    where left(coalesce(row_value ->> 'sourceKey', ''), 14) = 'staff-summary:'
      and nullif(row_value ->> 'payArrangementId', '') is null
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

create or replace function private.validate_payroll_snapshot(
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
security invoker
set search_path = ''
as $$
declare
  attendance_rows jsonb;
  summary_rows jsonb;
  summary_row jsonb;
  row_staff_id text;
  row_arrangement_id uuid;
  row_date date;
  arrangement public.staff_pay_arrangements%rowtype;
  attendance_validation text;
  authoritative_readiness jsonb;
  normalised_readiness_issues jsonb;
begin
  if jsonb_typeof(preparation_rows) <> 'array'
     or jsonb_array_length(preparation_rows) = 0
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
    select 1 from jsonb_array_elements(attendance_rows) attendance
    where not exists (
      select 1 from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id
        and staff.id = attendance ->> 'staffId'
    )
  ) then
    return 'invalid_staff';
  end if;
  if exists (
    select 1 from jsonb_array_elements(attendance_rows) attendance
    where nullif(attendance ->> 'siteId', '') is not null and (
      not exists (
        select 1 from public.organisation_sites site
        where site.organisation_id = target_organisation_id
          and site.id = (attendance ->> 'siteId')::uuid
      )
      or (target_site_filter_id is not null
        and (attendance ->> 'siteId')::uuid <> target_site_filter_id)
    )
  ) then
    return 'invalid_site';
  end if;

  if jsonb_array_length(attendance_rows) > 0 then
    attendance_validation := private.validate_payroll_attendance_snapshot(
      target_organisation_id, period_start, period_end, target_site_filter_id,
      attendance_rows,
      private.payroll_authoritative_attendance_readiness(
        target_organisation_id, period_start, period_end, target_site_filter_id, attendance_rows
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
  ) then
    return 'attendance_evidence_mismatch';
  end if;

  if exists (
    select 1 from jsonb_array_elements(preparation_rows) row_value
    group by row_value ->> 'sourceKey' having count(*) > 1
  ) then
    return 'duplicate_evidence';
  end if;

  for summary_row in select value from jsonb_array_elements(summary_rows)
  loop
    row_staff_id := summary_row ->> 'staffId';
    row_arrangement_id := nullif(summary_row ->> 'payArrangementId', '')::uuid;
    row_date := (summary_row ->> 'operationalDate')::date;
    arrangement := null;
    if row_date not between period_start and period_end
       or summary_row ->> 'siteId' is not null
       or summary_row ->> 'currencyCode' <> 'GBP'
       or jsonb_typeof(summary_row -> 'warnings') <> 'array'
       or coalesce((summary_row ->> 'rawMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'adjustmentMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'payableMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'ordinaryMinutes')::integer, -1) <> 0
       or coalesce((summary_row ->> 'overtimeMinutes')::integer, -1) <> 0 then
      return 'invalid_snapshot';
    end if;
    if not exists (
      select 1 from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id
        and staff.id = row_staff_id and staff.active
    ) then
      return 'invalid_staff';
    end if;
    if target_site_filter_id is not null and not exists (
      select 1 from public.staff_site_assignments assignment
      where assignment.organisation_id = target_organisation_id
        and assignment.staff_id = row_staff_id and assignment.site_id = target_site_filter_id
        and assignment.effective_from <= period_end
        and (assignment.effective_to is null or assignment.effective_to >= period_start)
    ) then
      return 'invalid_site_attribution';
    end if;
    if exists (
      select 1 from jsonb_array_elements(attendance_rows) attendance
      where attendance ->> 'staffId' = row_staff_id
    ) then
      return 'invalid_snapshot';
    end if;
    if row_arrangement_id is null then
      if summary_row ->> 'sourceKey' is distinct from
           'staff-summary:' || target_organisation_id::text || ':' || row_staff_id || ':missing'
         or summary_row ->> 'payType' is not null
         or summary_row ->> 'hourlyRate' is not null
         or summary_row ->> 'annualSalary' is not null
         or summary_row ->> 'monthlySalary' is not null
         or summary_row ->> 'overtimeMultiplier' is not null
         or exists (
           select 1 from public.staff_pay_arrangements candidate
           where candidate.organisation_id = target_organisation_id
             and candidate.staff_id = row_staff_id and candidate.is_active
             and candidate.effective_from <= period_end
             and (candidate.effective_to is null or candidate.effective_to >= period_start)
         ) then
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
         or summary_row ->> 'sourceKey' is distinct from
           'staff-summary:' || target_organisation_id::text || ':' || row_staff_id || ':' || row_arrangement_id::text
         or summary_row ->> 'payType' is distinct from arrangement.pay_type::text
         or nullif(summary_row ->> 'hourlyRate', '')::numeric is distinct from arrangement.hourly_rate
         or nullif(summary_row ->> 'annualSalary', '')::numeric is distinct from arrangement.annual_salary
         or nullif(summary_row ->> 'monthlySalary', '')::numeric is distinct from arrangement.monthly_salary
         or nullif(summary_row ->> 'overtimeMultiplier', '')::numeric is distinct from arrangement.overtime_multiplier then
        return 'invalid_pay_arrangement';
      end if;
    end if;
  end loop;

  if exists (
    with eligible_staff as (
      select staff.id
      from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id and staff.active
        and (target_site_filter_id is null or exists (
          select 1 from public.staff_site_assignments assignment
          where assignment.organisation_id = target_organisation_id
            and assignment.staff_id = staff.id and assignment.site_id = target_site_filter_id
            and assignment.effective_from <= period_end
            and (assignment.effective_to is null or assignment.effective_to >= period_start)
        ))
        and not exists (
          select 1 from jsonb_array_elements(attendance_rows) attendance
          where attendance ->> 'staffId' = staff.id
        )
    ), expected as (
      select 'staff-summary:' || target_organisation_id::text || ':' || staff.id || ':'
        || coalesce(expected_arrangement.id::text, 'missing') source_key
      from eligible_staff staff
      left join public.staff_pay_arrangements expected_arrangement
        on expected_arrangement.organisation_id = target_organisation_id
       and expected_arrangement.staff_id = staff.id and expected_arrangement.is_active
       and expected_arrangement.effective_from <= period_end
       and (expected_arrangement.effective_to is null or expected_arrangement.effective_to >= period_start)
    ), supplied as (
      select row_value ->> 'sourceKey' source_key from jsonb_array_elements(summary_rows) row_value
    )
    (select source_key from expected except select source_key from supplied)
    union all
    (select source_key from supplied except select source_key from expected)
  ) then
    return 'invalid_staff_summary_coverage';
  end if;

  if exists (
    select 1 from jsonb_array_elements(preparation_rows) supplied
    join private.payroll_canonical_arithmetic(
      target_organisation_id, period_start, period_end, preparation_rows
    ) canonical on canonical.source_key = supplied ->> 'sourceKey'
    where (supplied ->> 'ordinaryMinutes')::integer is distinct from canonical.ordinary_minutes
      or (supplied ->> 'overtimeMinutes')::integer is distinct from canonical.overtime_minutes
      or nullif(supplied ->> 'estimatedGrossValue', '')::numeric
        is distinct from canonical.estimated_gross_value
  ) then
    return 'invalid_arithmetic';
  end if;

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

create or replace function private.payroll_run_evidence_drift(
  target_organisation_id uuid,
  target_run_id uuid
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  stored_run public.payroll_preparation_runs%rowtype;
  stored_row public.payroll_preparation_rows%rowtype;
  evidence record;
  stored_period public.payroll_periods%rowtype;
  arrangement_ids uuid[];
  fingerprint_rows jsonb;
  current_readiness jsonb;
begin
  select run.* into stored_run from public.payroll_preparation_runs run
  where run.organisation_id = target_organisation_id and run.id = target_run_id;
  if not found then return 'stale_attendance_evidence'; end if;
  select period.* into stored_period from public.payroll_periods period
  where period.organisation_id = target_organisation_id and period.id = stored_run.period_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceKey', row_value.source_key,
    'staffId', row_value.staff_id, 'siteId', row_value.site_id,
    'payArrangementId', row_value.pay_arrangement_id,
    'operationalDate', row_value.operational_date
  ) order by row_value.staff_id, row_value.operational_date, row_value.source_key), '[]'::jsonb)
    into fingerprint_rows
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_organisation_id and row_value.run_id = target_run_id;
  if stored_run.authoritative_attendance_fingerprint <> private.payroll_attendance_fingerprint(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id, fingerprint_rows
  ) then return 'stale_attendance_fingerprint'; end if;
  select array_agg(distinct row_value.pay_arrangement_id order by row_value.pay_arrangement_id)
    filter (where row_value.pay_arrangement_id is not null) into arrangement_ids
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_organisation_id and row_value.run_id = target_run_id;
  if stored_run.authoritative_pay_arrangement_fingerprint <> private.payroll_pay_arrangement_fingerprint(
    target_organisation_id, arrangement_ids
  ) then return 'stale_pay_arrangement_fingerprint'; end if;
  current_readiness := private.payroll_authoritative_readiness(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id, fingerprint_rows
  );
  if stored_run.readiness is distinct from current_readiness then return 'stale_readiness'; end if;

  for stored_row in select row_value.* from public.payroll_preparation_rows row_value
    where row_value.organisation_id = target_organisation_id and row_value.run_id = target_run_id
  loop
    if not exists (select 1 from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id
        and staff.id = stored_row.staff_id and staff.active) then
      return 'stale_staff_evidence';
    end if;
    if stored_row.pay_arrangement_id is not null and not exists (
      select 1 from public.staff_pay_arrangements arrangement
      where arrangement.organisation_id = target_organisation_id
        and arrangement.id = stored_row.pay_arrangement_id
        and arrangement.staff_id = stored_row.staff_id and arrangement.is_active
        and arrangement.effective_from <= stored_row.operational_date
        and (arrangement.effective_to is null or arrangement.effective_to >= stored_row.operational_date)
        and arrangement.pay_type is not distinct from stored_row.pay_type
        and arrangement.hourly_rate is not distinct from stored_row.hourly_rate
        and arrangement.annual_salary is not distinct from stored_row.annual_salary
        and arrangement.monthly_salary is not distinct from stored_row.monthly_salary
        and arrangement.overtime_multiplier is not distinct from stored_row.overtime_multiplier
    ) then return 'stale_pay_arrangement_evidence'; end if;
    if left(stored_row.source_key, 14) = 'staff-summary:' then
      if stored_row.site_id is not null or stored_row.raw_minutes <> 0
         or stored_row.payable_minutes <> 0 then return 'stale_staff_summary_evidence'; end if;
    elsif stored_row.site_id is not null then
      select * into evidence from private.payroll_attendance_evidence(
        target_organisation_id, stored_row.site_id, stored_row.staff_id, stored_row.operational_date
      );
      if stored_row.raw_minutes <> evidence.effective_minutes then
        return 'stale_attendance_evidence';
      end if;
    elsif stored_row.raw_minutes <> 0 then return 'stale_attendance_evidence'; end if;
  end loop;
  if exists (
    select 1 from (
      select event.site_id, event.staff_id, event.recorded_date
      from public.clock_events event
      where event.organisation_id = target_organisation_id
        and event.recorded_date between stored_period.period_start and stored_period.period_end
        and (stored_run.site_filter_id is null or event.site_id = stored_run.site_filter_id)
      union
      select correction.site_id, correction.staff_id, correction.recorded_date
      from public.clock_event_corrections correction
      where correction.organisation_id = target_organisation_id
        and correction.recorded_date between stored_period.period_start and stored_period.period_end
        and (stored_run.site_filter_id is null or correction.site_id = stored_run.site_filter_id)
    ) current_evidence
    where not exists (
      select 1 from public.payroll_preparation_rows row_value
      where row_value.organisation_id = target_organisation_id and row_value.run_id = target_run_id
        and left(row_value.source_key, 14) <> 'staff-summary:'
        and row_value.staff_id = current_evidence.staff_id
        and row_value.site_id = current_evidence.site_id
        and row_value.operational_date = current_evidence.recorded_date
    )
  ) then return 'stale_attendance_evidence'; end if;
  return null;
end
$$;

revoke all on function private.payroll_authoritative_attendance_readiness(uuid, date, date, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_payroll_attendance_snapshot(uuid, date, date, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.payroll_authoritative_readiness(uuid, date, date, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_payroll_snapshot(uuid, date, date, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.payroll_run_evidence_drift(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Authorise a batch identifier before entering the inherited mutation body so
-- absent and foreign identifiers share one safe denial.
create or replace function private.authorised_payroll_import_batch(target_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.payroll_import_batches batch
    join public.organisation_memberships membership
      on membership.organisation_id = batch.organisation_id
     and membership.auth_user_id = auth.uid()
     and membership.status = 'active'
    where batch.id = target_batch_id and batch.organisation_id is not null
      and private.has_permission(batch.organisation_id, 'payroll.prepare')
  )
$$;
revoke all on function private.authorised_payroll_import_batch(uuid)
  from public, anon, authenticated, service_role;

alter function public.save_commercial_payroll_import_review_row(
  uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, date, text, boolean
) rename to save_commercial_payroll_import_review_row_authorised_internal;
alter function public.update_commercial_payroll_import_batch_date(uuid, date, boolean)
  rename to update_commercial_payroll_import_batch_date_authorised_internal;
alter function public.mark_commercial_payroll_import_batch_ready(uuid, uuid)
  rename to mark_commercial_payroll_import_batch_ready_authorised_internal;
alter function public.commit_commercial_payroll_import_batch(uuid, uuid)
  rename to commit_commercial_payroll_import_batch_authorised_internal;

revoke all on function public.save_commercial_payroll_import_review_row_authorised_internal(
  uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, date, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.update_commercial_payroll_import_batch_date_authorised_internal(uuid, date, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_commercial_payroll_import_batch_ready_authorised_internal(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_commercial_payroll_import_batch_authorised_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.save_commercial_payroll_import_review_row(
  target_batch_id uuid, target_row_id uuid, target_resolution text,
  target_selected_staff_id text, target_pay_type text, target_hourly_rate numeric,
  target_annual_salary numeric, target_monthly_salary numeric,
  target_contracted_weekly_hours numeric, target_hours_basis text,
  target_effective_from date, target_manager_notes text,
  target_duplicate_mapping_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if not private.authorised_payroll_import_batch(target_batch_id) then
    raise exception 'Payroll import is not authorised';
  end if;
  return public.save_commercial_payroll_import_review_row_authorised_internal(
    target_batch_id, target_row_id, target_resolution, target_selected_staff_id,
    target_pay_type, target_hourly_rate, target_annual_salary, target_monthly_salary,
    target_contracted_weekly_hours, target_hours_basis, target_effective_from,
    target_manager_notes, target_duplicate_mapping_confirmed
  );
end
$$;

create or replace function public.update_commercial_payroll_import_batch_date(
  target_batch_id uuid, target_proposed_effective_date date,
  target_global_effective_date_confirmed boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if not private.authorised_payroll_import_batch(target_batch_id) then
    raise exception 'Payroll import is not authorised';
  end if;
  return public.update_commercial_payroll_import_batch_date_authorised_internal(
    target_batch_id, target_proposed_effective_date, target_global_effective_date_confirmed
  );
end
$$;

create or replace function public.mark_commercial_payroll_import_batch_ready(
  target_batch_id uuid, target_operation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if not private.authorised_payroll_import_batch(target_batch_id) then
    raise exception 'Payroll import is not authorised';
  end if;
  return public.mark_commercial_payroll_import_batch_ready_authorised_internal(
    target_batch_id, target_operation_id
  );
end
$$;

create or replace function public.commit_commercial_payroll_import_batch(
  target_batch_id uuid, target_operation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'AAL2 is required'; end if;
  if not private.authorised_payroll_import_batch(target_batch_id) then
    raise exception 'Payroll import is not authorised';
  end if;
  return public.commit_commercial_payroll_import_batch_authorised_internal(
    target_batch_id, target_operation_id
  );
end
$$;

revoke all on function public.save_commercial_payroll_import_review_row(
  uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, date, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.save_commercial_payroll_import_review_row(
  uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, date, text, boolean
) to authenticated;
revoke all on function public.update_commercial_payroll_import_batch_date(uuid, date, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.update_commercial_payroll_import_batch_date(uuid, date, boolean)
  to authenticated;
revoke all on function public.mark_commercial_payroll_import_batch_ready(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_commercial_payroll_import_batch_ready(uuid, uuid)
  to authenticated;
revoke all on function public.commit_commercial_payroll_import_batch(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_commercial_payroll_import_batch(uuid, uuid)
  to authenticated;
