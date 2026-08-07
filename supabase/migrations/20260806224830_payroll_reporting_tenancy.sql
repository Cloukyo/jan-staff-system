-- Commercial Workstream 6: additive payroll reporting tenancy foundation.
-- Existing Jan payroll import rows remain unowned and retain their legacy path.

create type public.payroll_period_status as enum ('open', 'closed');
create type public.payroll_preparation_status as enum ('draft', 'needs_review', 'ready', 'approved', 'superseded');
create type public.payroll_adjustment_status as enum ('active', 'superseded', 'voided');
create type public.payroll_approval_status as enum ('approved', 'reopened');
create type public.payroll_export_format as enum ('xlsx', 'csv');

alter table public.staff_pay_arrangements
  add column site_id uuid,
  add column created_by_membership_id uuid,
  add column updated_by_membership_id uuid,
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add constraint staff_pay_arrangements_organisation_id_id_key unique (organisation_id, id),
  add constraint staff_pay_arrangements_org_site_fk foreign key (organisation_id, site_id)
    references public.organisation_sites(organisation_id, id) on delete restrict,
  add constraint staff_pay_arrangements_creator_membership_fk
    foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint staff_pay_arrangements_updater_membership_fk
    foreign key (organisation_id, updated_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict;

alter table public.payroll_import_batches
  add column organisation_id uuid,
  add column site_id uuid,
  add column created_by_membership_id uuid,
  add column approved_by_membership_id uuid,
  add column imported_by_membership_id uuid,
  add column preview_operation_id uuid,
  add column preview_request_digest text,
  add column ready_operation_id uuid,
  add column ready_request_digest text,
  add column commit_operation_id uuid,
  add column commit_request_digest text,
  alter column created_by drop not null;

alter table public.payroll_import_review_rows
  add column organisation_id uuid,
  add column site_id uuid,
  add column created_by_membership_id uuid,
  add column updated_by_membership_id uuid,
  alter column created_by drop not null,
  alter column updated_by drop not null;

alter table public.payroll_import_batches
  add constraint payroll_import_batches_org_id_key unique (organisation_id, id),
  add constraint payroll_import_batches_org_fk foreign key (organisation_id)
    references public.organisations(id) on delete restrict,
  add constraint payroll_import_batches_org_site_fk foreign key (organisation_id, site_id)
    references public.organisation_sites(organisation_id, id) on delete restrict,
  add constraint payroll_import_batches_creator_membership_fk
    foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint payroll_import_batches_approver_membership_fk
    foreign key (organisation_id, approved_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint payroll_import_batches_importer_membership_fk
    foreign key (organisation_id, imported_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint payroll_import_batches_site_requires_org check (site_id is null or organisation_id is not null) not valid,
  add constraint payroll_import_batches_preview_digest check (
    preview_request_digest is null or preview_request_digest ~ '^[0-9a-f]{64}$'
  ),
  add constraint payroll_import_batches_ready_digest check (
    ready_request_digest is null or ready_request_digest ~ '^[0-9a-f]{64}$'
  ),
  add constraint payroll_import_batches_commit_digest check (
    commit_request_digest is null or commit_request_digest ~ '^[0-9a-f]{64}$'
  );

alter table public.payroll_import_review_rows
  add constraint payroll_import_review_rows_org_id_key unique (organisation_id, id),
  add constraint payroll_import_review_rows_org_batch_fk
    foreign key (organisation_id, batch_id) references public.payroll_import_batches(organisation_id, id) on delete restrict,
  add constraint payroll_import_review_rows_org_site_fk foreign key (organisation_id, site_id)
    references public.organisation_sites(organisation_id, id) on delete restrict,
  add constraint payroll_import_review_rows_suggested_staff_fk foreign key (organisation_id, suggested_staff_id)
    references public.staff_profiles(organisation_id, id) on delete restrict,
  add constraint payroll_import_review_rows_selected_staff_fk foreign key (organisation_id, selected_staff_id)
    references public.staff_profiles(organisation_id, id) on delete restrict,
  add constraint payroll_import_review_rows_creator_membership_fk
    foreign key (organisation_id, created_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint payroll_import_review_rows_updater_membership_fk
    foreign key (organisation_id, updated_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add constraint payroll_import_review_rows_site_requires_org check (site_id is null or organisation_id is not null) not valid;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_pay_arrangements'
      and column_name = 'import_review_row_id'
  ) then
    alter table public.staff_pay_arrangements
      add constraint staff_pay_arrangements_org_import_row_fk
      foreign key (organisation_id, import_review_row_id)
      references public.payroll_import_review_rows(organisation_id, id) on delete restrict;
  end if;
end
$$;

drop trigger if exists staff_pay_arrangements_prevent_reparenting on public.staff_pay_arrangements;
create trigger staff_pay_arrangements_prevent_reparenting before update on public.staff_pay_arrangements
for each row execute function private.prevent_customer_record_reparenting('staff_id', 'site_id', 'import_review_row_id');

create unique index payroll_import_batches_org_preview_operation_idx
  on public.payroll_import_batches (organisation_id, preview_operation_id)
  where organisation_id is not null and preview_operation_id is not null;
create unique index payroll_import_batches_org_commit_operation_idx
  on public.payroll_import_batches (organisation_id, commit_operation_id)
  where organisation_id is not null and commit_operation_id is not null;
create unique index payroll_import_batches_org_ready_operation_idx
  on public.payroll_import_batches (organisation_id, ready_operation_id)
  where organisation_id is not null and ready_operation_id is not null;
create index staff_pay_arrangements_org_site_idx
  on public.staff_pay_arrangements (organisation_id, site_id, effective_from)
  where organisation_id is not null and site_id is not null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payroll_import_batches' and column_name = 'approved_by'
  ) then
    alter table public.payroll_import_batches drop constraint if exists payroll_import_batch_approval;
    alter table public.payroll_import_batches add constraint payroll_import_batch_approval check (
      (
        status = 'draft'
        and approved_by is null and approved_by_membership_id is null and approved_at is null
        and imported_by is null and imported_by_membership_id is null and imported_at is null
      ) or (
        status = 'ready' and approved_at is not null
        and ((organisation_id is null and approved_by is not null and approved_by_membership_id is null)
          or (organisation_id is not null and approved_by is null and approved_by_membership_id is not null))
        and imported_by is null and imported_by_membership_id is null and imported_at is null
      ) or (
        status = 'imported' and approved_at is not null and imported_at is not null
        and ((organisation_id is null and approved_by is not null and imported_by is not null
              and approved_by_membership_id is null and imported_by_membership_id is null)
          or (organisation_id is not null and approved_by is null and imported_by is null
              and approved_by_membership_id is not null and imported_by_membership_id is not null))
      ) or (
        status = 'cancelled' and imported_by is null and imported_by_membership_id is null and imported_at is null
      )
    );
  end if;
end
$$;

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status public.payroll_period_status not null default 'open',
  revision integer not null default 1,
  operation_id uuid not null,
  request_digest text not null,
  created_by_membership_id uuid not null,
  closed_by_membership_id uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, period_start, period_end),
  unique (organisation_id, operation_id),
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  foreign key (organisation_id, closed_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  constraint payroll_period_dates check (period_end >= period_start and period_end - period_start <= 365),
  constraint payroll_period_revision check (revision > 0),
  constraint payroll_period_request_digest check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint payroll_period_closure check (
    (status = 'open' and closed_by_membership_id is null and closed_at is null)
    or (status = 'closed' and closed_by_membership_id is not null and closed_at is not null)
  )
);

create table public.payroll_preparation_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  period_id uuid not null,
  revision integer not null,
  status public.payroll_preparation_status not null default 'draft',
  operation_id uuid not null,
  request_expected_revision integer not null,
  request_digest text not null,
  input_fingerprint text not null,
  attendance_fingerprint text not null,
  pay_arrangement_fingerprint text not null,
  authoritative_attendance_fingerprint text not null,
  authoritative_pay_arrangement_fingerprint text not null,
  blocker_count integer not null default 0,
  warning_count integer not null default 0,
  informational_count integer not null default 0,
  readiness jsonb not null default '{}'::jsonb,
  site_filter_id uuid,
  warning_acknowledgement_operation_id uuid,
  warning_acknowledgement_expected_revision integer,
  warning_acknowledgement_request_digest text,
  warning_acknowledged_codes text[],
  warning_acknowledgement_note text,
  warning_acknowledged_by_membership_id uuid,
  warning_acknowledged_at timestamptz,
  supersedes_run_id uuid,
  supersedes_revision integer,
  prepared_by_membership_id uuid not null,
  prepared_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, period_id, revision),
  unique (organisation_id, period_id, id),
  unique (organisation_id, period_id, id, revision),
  unique (organisation_id, operation_id),
  unique (organisation_id, warning_acknowledgement_operation_id),
  foreign key (organisation_id, period_id) references public.payroll_periods(organisation_id, id) on delete restrict,
  foreign key (organisation_id, site_filter_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, period_id, supersedes_run_id, supersedes_revision)
    references public.payroll_preparation_runs(organisation_id, period_id, id, revision) on delete restrict,
  foreign key (organisation_id, prepared_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  foreign key (organisation_id, warning_acknowledged_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  constraint payroll_preparation_run_revision check (revision > 0),
  constraint payroll_preparation_run_request_revision check (request_expected_revision > 0),
  constraint payroll_preparation_run_request_digest check (
    request_digest ~ '^[0-9a-f]{64}$'
    and (warning_acknowledgement_request_digest is null
      or warning_acknowledgement_request_digest ~ '^[0-9a-f]{64}$')
  ),
  constraint payroll_preparation_run_supersession check (
    (supersedes_run_id is null and supersedes_revision is null and revision = 1)
    or (supersedes_run_id is not null and supersedes_revision is not null
      and supersedes_run_id <> id and supersedes_revision = revision - 1 and revision > 1
    )
  ),
  constraint payroll_preparation_run_fingerprints check (
    input_fingerprint ~ '^[0-9a-f]{64}$'
    and attendance_fingerprint ~ '^[0-9a-f]{64}$'
    and pay_arrangement_fingerprint ~ '^[0-9a-f]{64}$'
    and authoritative_attendance_fingerprint ~ '^[0-9a-f]{64}$'
    and authoritative_pay_arrangement_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint payroll_preparation_run_counts check (
    blocker_count >= 0 and warning_count >= 0 and informational_count >= 0
  ),
  constraint payroll_preparation_run_readiness check (jsonb_typeof(readiness) = 'object'),
  constraint payroll_preparation_run_warning_acknowledgement check (
    (
      warning_acknowledgement_operation_id is null
      and warning_acknowledgement_expected_revision is null
      and warning_acknowledgement_request_digest is null
      and warning_acknowledged_codes is null
      and warning_acknowledgement_note is null
      and warning_acknowledged_by_membership_id is null
      and warning_acknowledged_at is null
    ) or (
      warning_acknowledgement_operation_id is not null
      and warning_acknowledgement_expected_revision is not null
      and warning_acknowledgement_request_digest is not null
      and warning_acknowledgement_expected_revision > 0
      and warning_acknowledged_codes is not null
      and cardinality(warning_acknowledged_codes) > 0
      and warning_acknowledgement_note is not null
      and length(btrim(warning_acknowledgement_note)) between 5 and 2000
      and warning_acknowledged_by_membership_id is not null
      and warning_acknowledged_at is not null
    )
  )
);

create table public.payroll_preparation_rows (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  run_id uuid not null,
  staff_id text not null,
  site_id uuid,
  pay_arrangement_id uuid,
  operational_date date not null,
  source_key text not null check (length(btrim(source_key)) between 1 and 255),
  pay_type public.payroll_pay_type,
  pay_regime_key text not null check (length(btrim(pay_regime_key)) between 1 and 255),
  ordinary_minutes_limit integer check (ordinary_minutes_limit is null or ordinary_minutes_limit >= 0),
  raw_minutes integer not null default 0,
  adjustment_minutes integer not null default 0,
  payable_minutes integer not null default 0,
  ordinary_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  hourly_rate numeric(10,2),
  annual_salary numeric(12,2),
  monthly_salary numeric(12,2),
  overtime_multiplier numeric(5,2),
  estimated_gross_value numeric(14,2),
  currency_code text not null default 'GBP',
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, run_id, source_key),
  foreign key (organisation_id, run_id) references public.payroll_preparation_runs(organisation_id, id) on delete restrict,
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, pay_arrangement_id) references public.staff_pay_arrangements(organisation_id, id) on delete restrict,
  constraint payroll_preparation_row_minutes check (
    raw_minutes >= 0
    and adjustment_minutes between -10080 and 10080
    and raw_minutes + adjustment_minutes >= 0
    and payable_minutes >= 0
    and payable_minutes = raw_minutes + adjustment_minutes
    and ordinary_minutes >= 0
    and overtime_minutes >= 0
    and ordinary_minutes + overtime_minutes = payable_minutes
  ),
  constraint payroll_preparation_row_values check (
    hourly_rate is null or hourly_rate > 0
  ),
  constraint payroll_preparation_row_salary_values check (
    (annual_salary is null or annual_salary > 0)
    and (monthly_salary is null or monthly_salary > 0)
    and (estimated_gross_value is null or estimated_gross_value >= 0)
    and (overtime_multiplier is null or overtime_multiplier between 1 and 5)
  ),
  constraint payroll_preparation_row_currency check (currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_preparation_row_warnings check (jsonb_typeof(warnings) = 'array')
);

create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  period_id uuid not null,
  run_id uuid not null,
  revision integer not null,
  staff_id text not null,
  site_id uuid,
  operation_id uuid not null,
  request_expected_revision integer not null,
  request_digest text not null,
  source_key text not null,
  adjustment_minutes integer not null,
  reason text not null,
  status public.payroll_adjustment_status not null default 'active',
  supersedes_adjustment_id uuid,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, operation_id),
  unique (organisation_id, period_id, run_id, revision, staff_id, id),
  foreign key (organisation_id, period_id, run_id, revision)
    references public.payroll_preparation_runs(organisation_id, period_id, id, revision) on delete restrict,
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, period_id, run_id, revision, staff_id, supersedes_adjustment_id)
    references public.payroll_adjustments(organisation_id, period_id, run_id, revision, staff_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  constraint payroll_adjustment_revision check (revision > 0),
  constraint payroll_adjustment_request_revision check (request_expected_revision > 0),
  constraint payroll_adjustment_request_digest check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint payroll_adjustment_source_key check (length(btrim(source_key)) between 1 and 255),
  constraint payroll_adjustment_value check (adjustment_minutes <> 0 and adjustment_minutes between -10080 and 10080),
  constraint payroll_adjustment_reason check (length(btrim(reason)) between 5 and 2000),
  constraint payroll_adjustment_supersession check (
    supersedes_adjustment_id is null or supersedes_adjustment_id <> id
  )
);

create table public.payroll_approvals (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  period_id uuid not null,
  run_id uuid not null,
  revision integer not null,
  operation_id uuid not null,
  request_expected_revision integer not null,
  request_digest text not null,
  status public.payroll_approval_status not null,
  acknowledged_warning_codes text[] not null default '{}',
  acknowledgement_note text,
  reason text,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, operation_id),
  unique (organisation_id, period_id, run_id, revision, id),
  foreign key (organisation_id, period_id, run_id, revision)
    references public.payroll_preparation_runs(organisation_id, period_id, id, revision) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  constraint payroll_approval_revision check (revision > 0),
  constraint payroll_approval_request_revision check (request_expected_revision > 0),
  constraint payroll_approval_request_digest check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint payroll_approval_acknowledgement check (
    (cardinality(acknowledged_warning_codes) = 0 and acknowledgement_note is null)
    or (
      cardinality(acknowledged_warning_codes) > 0
      and acknowledgement_note is not null
      and length(btrim(acknowledgement_note)) between 5 and 2000
    )
  ),
  constraint payroll_approval_lifecycle_reason check (
    (status = 'approved' and reason is null)
    or (status = 'reopened' and reason is not null and length(btrim(reason)) between 5 and 2000)
  )
);

create table public.payroll_export_audits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  period_id uuid not null,
  run_id uuid not null,
  approval_id uuid not null,
  revision integer not null,
  operation_id uuid not null,
  request_expected_revision integer not null,
  request_digest text not null,
  export_format public.payroll_export_format not null,
  site_id uuid,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count >= 0),
  filter_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(filter_metadata) = 'object'),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, operation_id),
  foreign key (organisation_id, period_id, run_id, revision, approval_id)
    references public.payroll_approvals(organisation_id, period_id, run_id, revision, id) on delete restrict,
  foreign key (organisation_id, site_id) references public.organisation_sites(organisation_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  constraint payroll_export_audit_revision check (revision > 0),
  constraint payroll_export_audit_request_revision check (request_expected_revision > 0),
  constraint payroll_export_audit_request_digest check (request_digest ~ '^[0-9a-f]{64}$')
);

alter table public.payroll_periods enable row level security;
alter table public.payroll_preparation_runs enable row level security;
alter table public.payroll_preparation_rows enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_approvals enable row level security;
alter table public.payroll_export_audits enable row level security;

create index payroll_import_batches_org_site_idx on public.payroll_import_batches (organisation_id, site_id, created_at desc) where organisation_id is not null;
create index payroll_import_review_rows_org_batch_idx on public.payroll_import_review_rows (organisation_id, batch_id, source_row_index) where organisation_id is not null;
create index payroll_import_review_rows_org_site_idx on public.payroll_import_review_rows (organisation_id, site_id) where site_id is not null;
create index payroll_import_review_rows_org_staff_idx on public.payroll_import_review_rows (organisation_id, selected_staff_id) where selected_staff_id is not null;
create index payroll_import_review_rows_org_suggested_staff_idx on public.payroll_import_review_rows (organisation_id, suggested_staff_id) where suggested_staff_id is not null;
create index payroll_periods_reporting_idx on public.payroll_periods (organisation_id, status, period_start desc, period_end desc);
create index payroll_periods_creator_idx on public.payroll_periods (organisation_id, created_by_membership_id);
create index payroll_periods_closer_idx on public.payroll_periods (organisation_id, closed_by_membership_id) where closed_by_membership_id is not null;
create index payroll_preparation_runs_period_idx on public.payroll_preparation_runs (organisation_id, period_id, revision desc, status);
create index payroll_preparation_runs_supersedes_idx on public.payroll_preparation_runs (organisation_id, period_id, supersedes_run_id, supersedes_revision) where supersedes_run_id is not null;
create index payroll_preparation_runs_preparer_idx on public.payroll_preparation_runs (organisation_id, prepared_by_membership_id);
create index payroll_preparation_runs_site_filter_idx on public.payroll_preparation_runs (organisation_id, site_filter_id) where site_filter_id is not null;
create index payroll_preparation_runs_warning_actor_idx on public.payroll_preparation_runs (organisation_id, warning_acknowledged_by_membership_id) where warning_acknowledged_by_membership_id is not null;
create index payroll_preparation_rows_run_idx on public.payroll_preparation_rows (organisation_id, run_id, operational_date, staff_id);
create index payroll_preparation_rows_staff_idx on public.payroll_preparation_rows (organisation_id, staff_id, operational_date);
create index payroll_preparation_rows_site_idx on public.payroll_preparation_rows (organisation_id, site_id, operational_date) where site_id is not null;
create index payroll_preparation_rows_arrangement_idx on public.payroll_preparation_rows (organisation_id, pay_arrangement_id) where pay_arrangement_id is not null;
create index payroll_adjustments_run_idx on public.payroll_adjustments (organisation_id, run_id, revision, status);
create index payroll_adjustments_period_staff_idx on public.payroll_adjustments (organisation_id, period_id, staff_id);
create index payroll_adjustments_staff_idx on public.payroll_adjustments (organisation_id, staff_id);
create index payroll_adjustments_site_idx on public.payroll_adjustments (organisation_id, site_id) where site_id is not null;
create index payroll_adjustments_supersedes_idx on public.payroll_adjustments (organisation_id, supersedes_adjustment_id) where supersedes_adjustment_id is not null;
create index payroll_adjustments_creator_idx on public.payroll_adjustments (organisation_id, created_by_membership_id);
create index payroll_approvals_run_idx on public.payroll_approvals (organisation_id, run_id, revision, created_at desc);
create index payroll_approvals_period_idx on public.payroll_approvals (organisation_id, period_id, created_at desc);
create index payroll_approvals_creator_idx on public.payroll_approvals (organisation_id, created_by_membership_id);
create index payroll_export_audits_approval_idx on public.payroll_export_audits (organisation_id, approval_id, created_at desc);
create index payroll_export_audits_run_idx on public.payroll_export_audits (organisation_id, run_id, revision, created_at desc);
create index payroll_export_audits_period_idx on public.payroll_export_audits (organisation_id, period_id, created_at desc);
create index payroll_export_audits_site_idx on public.payroll_export_audits (organisation_id, site_id, created_at desc) where site_id is not null;
create index payroll_export_audits_creator_idx on public.payroll_export_audits (organisation_id, created_by_membership_id);

create or replace function private.prevent_payroll_record_reparenting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  argument_index integer;
begin
  if old.organisation_id is distinct from new.organisation_id then
    raise exception 'payroll record organisation ownership is immutable';
  end if;
  if tg_nargs > 0 then
    for argument_index in 0..tg_nargs - 1 loop
      if (to_jsonb(old) -> tg_argv[argument_index]) is distinct from (to_jsonb(new) -> tg_argv[argument_index]) then
        raise exception 'payroll record parent ownership is immutable';
      end if;
    end loop;
  end if;
  return new;
end
$$;

create or replace function public.approve_commercial_payroll_preparation(
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
  drift_code text;
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
  if not found then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || command_context.organisation_id::text || ':'
      || coalesce(target_operation_id::text, ''), 0
  ));
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id,
    'expectedRevision', expected_revision,
    'command', 'approve'
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
      'ok', true,
      'code', 'approval_reused',
      'reused', true,
      'organisationId', existing_approval.organisation_id,
      'periodId', existing_approval.period_id,
      'runId', existing_approval.run_id,
      'approvalId', existing_approval.id,
      'revision', existing_approval.revision,
      'status', existing_approval.status
    );
  end if;
  if expected_revision is null or target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id and period.id = target_period_id
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
    and run.period_id = target_period.id
    and run.revision = target_period.revision
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'preparation_required');
  end if;
  if target_run.blocker_count > 0 then
    return jsonb_build_object('ok', false, 'code', 'blockers_present');
  end if;
  if target_run.warning_count > 0 and target_run.warning_acknowledgement_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'warning_acknowledgement_required');
  end if;

  drift_code := private.payroll_run_evidence_drift(target_period.organisation_id, target_run.id);
  if drift_code is not null then
    return jsonb_build_object('ok', false, 'code', drift_code);
  end if;

  insert into public.payroll_approvals (
    organisation_id, period_id, run_id, revision, operation_id, request_expected_revision,
    request_digest, status,
    acknowledged_warning_codes, acknowledgement_note, created_by_membership_id
  ) values (
    target_period.organisation_id, target_period.id, target_run.id, target_run.revision,
    target_operation_id, expected_revision, command_request_digest, 'approved',
    coalesce(target_run.warning_acknowledged_codes, '{}'),
    target_run.warning_acknowledgement_note, command_context.membership_id
  ) returning * into created_approval;

  update public.payroll_preparation_runs run
  set status = 'approved'
  where run.organisation_id = target_run.organisation_id and run.id = target_run.id;
  update public.payroll_periods period
  set status = 'closed',
      closed_by_membership_id = command_context.membership_id,
      closed_at = now(),
      updated_at = now()
  where period.organisation_id = target_period.organisation_id and period.id = target_period.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'preparation_approved',
    'reused', false,
    'organisationId', created_approval.organisation_id,
    'periodId', created_approval.period_id,
    'runId', created_approval.run_id,
    'approvalId', created_approval.id,
    'revision', created_approval.revision,
    'status', created_approval.status
  );
end
$$;

create or replace function public.reopen_commercial_payroll_preparation(
  target_period_id uuid,
  expected_revision integer,
  target_operation_id uuid,
  reopen_reason text
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
  reopened_run public.payroll_preparation_runs%rowtype;
  existing_reopen public.payroll_approvals%rowtype;
  approved_record public.payroll_approvals%rowtype;
  reopened_run_id uuid;
  next_revision integer;
  next_status public.payroll_preparation_status;
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
  if not found then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || command_context.organisation_id::text || ':'
      || coalesce(target_operation_id::text, ''), 0
  ));
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id,
    'expectedRevision', expected_revision,
    'reason', case when reopen_reason is null then null else btrim(reopen_reason) end,
    'command', 'reopen'
  ));

  select approval.* into existing_reopen
  from public.payroll_approvals approval
  where approval.organisation_id = command_context.organisation_id
    and approval.operation_id = target_operation_id;
  if found then
    if existing_reopen.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    select run.* into reopened_run
    from public.payroll_preparation_runs run
    where run.organisation_id = existing_reopen.organisation_id
      and run.period_id = existing_reopen.period_id
      and run.operation_id = target_operation_id;
    return jsonb_build_object(
      'ok', true,
      'code', 'reopen_reused',
      'reused', true,
      'organisationId', reopened_run.organisation_id,
      'periodId', reopened_run.period_id,
      'runId', reopened_run.id,
      'revision', reopened_run.revision,
      'status', reopened_run.status
    );
  end if;
  if expected_revision is null or target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  if length(btrim(coalesce(reopen_reason, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_reason');
  end if;
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id and period.id = target_period_id
  for update;
  if target_period.revision <> expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision
    );
  end if;
  if target_period.status <> 'closed' then
    return jsonb_build_object('ok', false, 'code', 'period_not_approved');
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id
    and run.revision = target_period.revision
  for update;
  if not found or target_run.status <> 'approved' then
    return jsonb_build_object('ok', false, 'code', 'period_not_approved');
  end if;
  select approval.* into approved_record
  from public.payroll_approvals approval
  where approval.organisation_id = target_run.organisation_id
    and approval.period_id = target_run.period_id
    and approval.run_id = target_run.id
    and approval.revision = target_run.revision
    and approval.status = 'approved'
  order by approval.created_at desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'period_not_approved');
  end if;

  insert into public.payroll_approvals (
    organisation_id, period_id, run_id, revision, operation_id, request_expected_revision,
    request_digest, status,
    acknowledged_warning_codes, acknowledgement_note, reason, created_by_membership_id
  ) values (
    target_run.organisation_id, target_run.period_id, target_run.id, target_run.revision,
    target_operation_id, expected_revision, command_request_digest, 'reopened',
    approved_record.acknowledged_warning_codes,
    approved_record.acknowledgement_note, btrim(reopen_reason), command_context.membership_id
  );

  next_revision := target_period.revision + 1;
  next_status := case when target_run.blocker_count > 0 then 'needs_review'::public.payroll_preparation_status
    else 'ready'::public.payroll_preparation_status end;
  reopened_run_id := private.clone_payroll_run(
    target_run, next_revision, target_operation_id, command_request_digest,
    command_context.membership_id, next_status
  );
  update public.payroll_preparation_runs run
  set status = 'superseded'
  where run.organisation_id = target_run.organisation_id and run.id = target_run.id;
  update public.payroll_periods period
  set status = 'open',
      revision = next_revision,
      closed_by_membership_id = null,
      closed_at = null,
      updated_at = now()
  where period.organisation_id = target_period.organisation_id and period.id = target_period.id;
  select run.* into reopened_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_run.organisation_id and run.id = reopened_run_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'preparation_reopened',
    'reused', false,
    'organisationId', reopened_run.organisation_id,
    'periodId', reopened_run.period_id,
    'runId', reopened_run.id,
    'revision', reopened_run.revision,
    'status', reopened_run.status
  );
end
$$;

create or replace function public.create_commercial_payroll_adjustment(
  target_period_id uuid,
  expected_revision integer,
  target_operation_id uuid,
  target_staff_id text,
  target_site_id uuid,
  signed_adjustment_minutes integer,
  adjustment_reason text
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
  adjusted_run public.payroll_preparation_runs%rowtype;
  existing_adjustment public.payroll_adjustments%rowtype;
  created_adjustment public.payroll_adjustments%rowtype;
  target_source_row public.payroll_preparation_rows%rowtype;
  target_row_id uuid;
  adjusted_run_id uuid;
  next_revision integer;
  command_request_digest text;
  adjusted_preparation_rows jsonb;
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
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id,
    'expectedRevision', expected_revision,
    'staffId', target_staff_id,
    'siteId', target_site_id,
    'adjustmentMinutes', signed_adjustment_minutes,
    'reason', case when adjustment_reason is null then null else btrim(adjustment_reason) end,
    'command', 'adjust'
  ));

  select adjustment.* into existing_adjustment
  from public.payroll_adjustments adjustment
  where adjustment.organisation_id = command_context.organisation_id
    and adjustment.operation_id = target_operation_id;
  if found then
    if existing_adjustment.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    select run.* into adjusted_run
    from public.payroll_preparation_runs run
    where run.organisation_id = existing_adjustment.organisation_id
      and run.id = existing_adjustment.run_id;
    return jsonb_build_object(
      'ok', true,
      'code', 'adjustment_reused',
      'reused', true,
      'organisationId', existing_adjustment.organisation_id,
      'periodId', existing_adjustment.period_id,
      'runId', existing_adjustment.run_id,
      'adjustmentId', existing_adjustment.id,
      'revision', existing_adjustment.revision,
      'status', adjusted_run.status,
      'adjustmentMinutes', existing_adjustment.adjustment_minutes
    );
  end if;
  if expected_revision is null or target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  if signed_adjustment_minutes is null
     or signed_adjustment_minutes = 0
     or signed_adjustment_minutes not between -10080 and 10080 then
    return jsonb_build_object('ok', false, 'code', 'invalid_adjustment');
  end if;
  if length(btrim(coalesce(adjustment_reason, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_reason');
  end if;
  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id and period.id = target_period_id
  for update;
  if target_period.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'period_closed');
  end if;
  if target_period.revision <> expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision
    );
  end if;
  if not exists (
    select 1 from public.staff_profiles staff
    where staff.organisation_id = target_period.organisation_id and staff.id = target_staff_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_staff');
  end if;
  if target_site_id is not null and not exists (
    select 1 from public.organisation_sites site
    where site.organisation_id = target_period.organisation_id and site.id = target_site_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site');
  end if;

  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id
    and run.revision = target_period.revision
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'preparation_required');
  end if;
  select row_value.* into target_source_row
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_run.organisation_id
    and row_value.run_id = target_run.id
    and row_value.staff_id = target_staff_id
    and (target_site_id is null or row_value.site_id = target_site_id)
  order by row_value.operational_date, row_value.source_key, row_value.id
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_staff');
  end if;
  if target_source_row.payable_minutes + signed_adjustment_minutes < 0 then
    return jsonb_build_object('ok', false, 'code', 'adjustment_exceeds_source');
  end if;
  if target_source_row.adjustment_minutes + signed_adjustment_minutes
     not between -10080 and 10080 then
    return jsonb_build_object('ok', false, 'code', 'adjustment_out_of_range');
  end if;

  next_revision := target_period.revision + 1;
  adjusted_run_id := private.clone_payroll_run(
    target_run,
    next_revision,
    target_operation_id,
    command_request_digest,
    command_context.membership_id,
    case when target_run.blocker_count > 0 then 'needs_review'::public.payroll_preparation_status
      else 'ready'::public.payroll_preparation_status end
  );
  select row_value.id into target_row_id
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_run.organisation_id
    and row_value.run_id = adjusted_run_id
    and row_value.source_key = target_source_row.source_key;

  update public.payroll_preparation_rows row_value
  set adjustment_minutes = row_value.adjustment_minutes + signed_adjustment_minutes,
      payable_minutes = row_value.payable_minutes + signed_adjustment_minutes,
      ordinary_minutes = case
        when signed_adjustment_minutes > 0 then row_value.ordinary_minutes + signed_adjustment_minutes
        else row_value.ordinary_minutes
          - greatest(0, -signed_adjustment_minutes - row_value.overtime_minutes)
      end,
      overtime_minutes = case
        when signed_adjustment_minutes > 0 then row_value.overtime_minutes
        else greatest(0, row_value.overtime_minutes + signed_adjustment_minutes)
      end,
      estimated_gross_value = case
        when row_value.hourly_rate is null then row_value.estimated_gross_value
        else round(
          (
            (case when signed_adjustment_minutes > 0
              then row_value.ordinary_minutes + signed_adjustment_minutes
              else row_value.ordinary_minutes - greatest(0, -signed_adjustment_minutes - row_value.overtime_minutes)
            end)::numeric / 60 * row_value.hourly_rate
          ) + (
            (case when signed_adjustment_minutes > 0
              then row_value.overtime_minutes
              else greatest(0, row_value.overtime_minutes + signed_adjustment_minutes)
            end)::numeric / 60 * row_value.hourly_rate * coalesce(row_value.overtime_multiplier, 1)
          ),
          2
        )
      end
  where row_value.organisation_id = target_run.organisation_id and row_value.id = target_row_id;

  select jsonb_agg(jsonb_build_object(
    'sourceKey', row_value.source_key,
    'staffId', row_value.staff_id,
    'siteId', row_value.site_id,
    'payArrangementId', row_value.pay_arrangement_id,
    'operationalDate', row_value.operational_date,
    'payableMinutes', row_value.payable_minutes,
    'payType', row_value.pay_type,
    'payRegimeKey', row_value.pay_regime_key,
    'ordinaryMinutesLimit', row_value.ordinary_minutes_limit,
    'hourlyRate', row_value.hourly_rate,
    'overtimeMultiplier', row_value.overtime_multiplier
  ) order by row_value.staff_id, row_value.operational_date,
    coalesce(row_value.site_id::text, ''), row_value.source_key)
    into adjusted_preparation_rows
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_run.organisation_id
    and row_value.run_id = adjusted_run_id;

  update public.payroll_preparation_rows row_value
  set ordinary_minutes = canonical.ordinary_minutes,
      overtime_minutes = canonical.overtime_minutes,
      estimated_gross_value = canonical.estimated_gross_value
  from private.payroll_snapshot_arithmetic(adjusted_preparation_rows) canonical
  where row_value.organisation_id = target_run.organisation_id
    and row_value.run_id = adjusted_run_id
    and row_value.source_key = canonical.source_key;

  insert into public.payroll_adjustments (
    organisation_id, period_id, run_id, revision, staff_id, site_id,
    operation_id, request_expected_revision, request_digest, source_key,
    adjustment_minutes, reason, created_by_membership_id
  ) values (
    target_run.organisation_id, target_run.period_id, adjusted_run_id, next_revision,
    target_staff_id, target_site_id, target_operation_id, expected_revision,
    command_request_digest,
    target_source_row.source_key, signed_adjustment_minutes,
    btrim(adjustment_reason), command_context.membership_id
  ) returning * into created_adjustment;

  update public.payroll_preparation_runs run
  set status = 'superseded'
  where run.organisation_id = target_run.organisation_id and run.id = target_run.id;
  update public.payroll_periods period
  set revision = next_revision, updated_at = now()
  where period.organisation_id = target_period.organisation_id and period.id = target_period.id;
  select run.* into adjusted_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_run.organisation_id and run.id = adjusted_run_id;

  return jsonb_build_object(
    'ok', true,
    'code', 'adjustment_created',
    'reused', false,
    'organisationId', created_adjustment.organisation_id,
    'periodId', created_adjustment.period_id,
    'runId', adjusted_run.id,
    'adjustmentId', created_adjustment.id,
    'revision', adjusted_run.revision,
    'status', adjusted_run.status,
    'adjustmentMinutes', created_adjustment.adjustment_minutes
  );
end
$$;

create or replace function public.record_commercial_payroll_export(
  target_period_id uuid,
  target_approval_id uuid,
  expected_revision integer,
  target_operation_id uuid,
  target_export_format public.payroll_export_format,
  target_site_id uuid,
  target_file_name text,
  target_file_sha256 text,
  target_row_count integer,
  target_filter_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_context record;
  target_period public.payroll_periods%rowtype;
  target_approval public.payroll_approvals%rowtype;
  target_run public.payroll_preparation_runs%rowtype;
  existing_export public.payroll_export_audits%rowtype;
  created_export public.payroll_export_audits%rowtype;
  command_request_digest text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return jsonb_build_object('ok', false, 'code', 'mfa_required');
  end if;
  select * into command_context
  from private.authorised_payroll_period(target_period_id, 'payroll.export');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || command_context.organisation_id::text || ':'
      || coalesce(target_operation_id::text, ''), 0
  ));
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id,
    'approvalId', target_approval_id,
    'expectedRevision', expected_revision,
    'exportFormat', target_export_format,
    'siteId', target_site_id,
    'fileName', case when target_file_name is null then null else btrim(target_file_name) end,
    'fileSha256', target_file_sha256,
    'rowCount', target_row_count,
    'filterMetadata', target_filter_metadata,
    'command', 'export'
  ));

  select audit.* into existing_export
  from public.payroll_export_audits audit
  where audit.organisation_id = command_context.organisation_id
    and audit.operation_id = target_operation_id;
  if found then
    if existing_export.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'export_reused',
      'reused', true,
      'organisationId', existing_export.organisation_id,
      'periodId', existing_export.period_id,
      'runId', existing_export.run_id,
      'approvalId', existing_export.approval_id,
      'exportAuditId', existing_export.id,
      'revision', existing_export.revision
    );
  end if;
  if expected_revision is null or target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id and period.id = target_period_id
  for update;
  if target_period.revision <> expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_revision', 'currentRevision', target_period.revision
    );
  end if;
  if target_period.status <> 'closed' then
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;
  select approval.* into target_approval
  from public.payroll_approvals approval
  where approval.organisation_id = target_period.organisation_id
    and approval.period_id = target_period.id
    and approval.id = target_approval_id
    and approval.revision = target_period.revision
    and approval.status = 'approved';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'approval_required');
  end if;
  select run.* into target_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_approval.organisation_id
    and run.period_id = target_approval.period_id
    and run.id = target_approval.run_id
    and run.revision = target_approval.revision;
  if not found or target_run.site_filter_id is distinct from target_site_id then
    return jsonb_build_object('ok', false, 'code', 'invalid_site');
  end if;
  if target_site_id is not null and not exists (
    select 1 from public.organisation_sites site
    where site.organisation_id = target_period.organisation_id and site.id = target_site_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site');
  end if;
  if target_site_id is not null and not exists (
    select 1 from public.payroll_preparation_rows row_value
    where row_value.organisation_id = target_period.organisation_id
      and row_value.run_id = target_approval.run_id
      and row_value.site_id = target_site_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site');
  end if;
  if length(btrim(coalesce(target_file_name, ''))) not between 1 and 255
     or target_file_sha256 !~ '^[0-9a-f]{64}$'
     or target_row_count < 0
     or jsonb_typeof(target_filter_metadata) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_export');
  end if;

  insert into public.payroll_export_audits (
    organisation_id, period_id, run_id, approval_id, revision, operation_id,
    request_expected_revision, request_digest,
    export_format, site_id, file_name, file_sha256, row_count, filter_metadata,
    created_by_membership_id
  ) values (
    target_period.organisation_id, target_period.id, target_approval.run_id,
    target_approval.id, target_approval.revision, target_operation_id, expected_revision,
    command_request_digest,
    target_export_format, target_site_id, btrim(target_file_name), target_file_sha256,
    target_row_count, target_filter_metadata, command_context.membership_id
  ) returning * into created_export;

  return jsonb_build_object(
    'ok', true,
    'code', 'export_recorded',
    'reused', false,
    'organisationId', created_export.organisation_id,
    'periodId', created_export.period_id,
    'runId', created_export.run_id,
    'approvalId', created_export.approval_id,
    'exportAuditId', created_export.id,
    'revision', created_export.revision
  );
end
$$;

revoke all on function private.prevent_payroll_record_reparenting() from public, anon, authenticated, service_role;

create trigger payroll_import_batches_prevent_reparenting before update on public.payroll_import_batches
for each row execute function private.prevent_payroll_record_reparenting('site_id');
create trigger payroll_import_review_rows_prevent_reparenting before update on public.payroll_import_review_rows
for each row execute function private.prevent_payroll_record_reparenting('batch_id', 'site_id');
create trigger payroll_periods_prevent_reparenting before update on public.payroll_periods
for each row execute function private.prevent_payroll_record_reparenting(
  'period_start', 'period_end', 'operation_id', 'request_digest'
);
create trigger payroll_preparation_runs_prevent_reparenting before update on public.payroll_preparation_runs
for each row execute function private.prevent_payroll_record_reparenting(
  'period_id', 'revision', 'operation_id', 'input_fingerprint', 'attendance_fingerprint',
  'pay_arrangement_fingerprint', 'authoritative_attendance_fingerprint',
  'authoritative_pay_arrangement_fingerprint', 'request_expected_revision', 'request_digest',
  'site_filter_id',
  'supersedes_run_id', 'supersedes_revision'
);
create trigger payroll_preparation_rows_prevent_reparenting before update on public.payroll_preparation_rows
for each row execute function private.prevent_payroll_record_reparenting(
  'run_id', 'staff_id', 'site_id', 'pay_arrangement_id', 'operational_date', 'source_key'
);
create trigger payroll_adjustments_prevent_reparenting before update on public.payroll_adjustments
for each row execute function private.prevent_payroll_record_reparenting(
  'period_id', 'run_id', 'revision', 'staff_id', 'site_id', 'operation_id',
  'request_expected_revision', 'request_digest', 'source_key', 'supersedes_adjustment_id'
);
create trigger payroll_approvals_prevent_reparenting before update on public.payroll_approvals
for each row execute function private.prevent_payroll_record_reparenting(
  'period_id', 'run_id', 'revision', 'operation_id', 'request_expected_revision', 'request_digest'
);
create trigger payroll_export_audits_prevent_reparenting before update on public.payroll_export_audits
for each row execute function private.prevent_payroll_record_reparenting(
  'period_id', 'run_id', 'approval_id', 'revision', 'operation_id',
  'request_expected_revision', 'request_digest', 'site_id', 'file_sha256'
);

drop policy if exists "Managers can manage payroll import batches" on public.payroll_import_batches;
drop policy if exists "Managers can manage payroll import review rows" on public.payroll_import_review_rows;

create policy payroll_import_batches_legacy_manage on public.payroll_import_batches for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role() = 'manager');
create policy payroll_import_batches_commercial_read on public.payroll_import_batches for select to authenticated
  using (organisation_id is not null and private.has_permission(organisation_id, 'payroll.read'));
create policy payroll_import_review_rows_legacy_manage on public.payroll_import_review_rows for all to authenticated
  using (organisation_id is null and public.current_staff_role() = 'manager')
  with check (organisation_id is null and site_id is null and public.current_staff_role() = 'manager');
create policy payroll_import_review_rows_commercial_read on public.payroll_import_review_rows for select to authenticated
  using (organisation_id is not null and private.has_permission(organisation_id, 'payroll.read'));

create policy payroll_periods_read on public.payroll_periods for select to authenticated
  using (private.has_permission(organisation_id, 'payroll.read'));
create policy payroll_preparation_runs_read on public.payroll_preparation_runs for select to authenticated
  using (private.has_permission(organisation_id, 'payroll.read'));
create policy payroll_preparation_rows_read on public.payroll_preparation_rows for select to authenticated
  using (private.has_permission(organisation_id, 'payroll.read'));
create policy payroll_adjustments_read on public.payroll_adjustments for select to authenticated
  using (private.has_permission(organisation_id, 'payroll.read'));
create policy payroll_approvals_read on public.payroll_approvals for select to authenticated
  using (private.has_permission(organisation_id, 'payroll.read'));
create policy payroll_export_audits_read on public.payroll_export_audits for select to authenticated
  using (private.has_permission(organisation_id, 'payroll.read'));

revoke all on
  public.payroll_periods,
  public.payroll_preparation_runs,
  public.payroll_preparation_rows,
  public.payroll_adjustments,
  public.payroll_approvals,
  public.payroll_export_audits
from anon, authenticated;
grant select on
  public.payroll_periods,
  public.payroll_preparation_runs,
  public.payroll_preparation_rows,
  public.payroll_adjustments,
  public.payroll_approvals,
  public.payroll_export_audits
to authenticated;
revoke insert, update, delete on
  public.payroll_periods,
  public.payroll_preparation_runs,
  public.payroll_preparation_rows,
  public.payroll_adjustments,
  public.payroll_approvals,
  public.payroll_export_audits
from authenticated;
grant select, insert, update, delete on
  public.payroll_periods,
  public.payroll_preparation_runs,
  public.payroll_preparation_rows,
  public.payroll_adjustments,
  public.payroll_approvals,
  public.payroll_export_audits
to service_role;

-- Legacy Jan imports remain directly manager-managed only while unowned.
revoke all on public.payroll_import_batches, public.payroll_import_review_rows from anon, authenticated;
grant select, insert, update, delete on public.payroll_import_batches, public.payroll_import_review_rows to authenticated;
grant select, insert, update, delete on public.payroll_import_batches, public.payroll_import_review_rows to service_role;

-- Commercial payroll writes are exposed only through the guarded commands below.
create or replace function private.payroll_command_actor(
  target_organisation_id uuid,
  requested_permission text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id
  from public.organisation_memberships membership
  where auth.uid() is not null
    and membership.organisation_id = target_organisation_id
    and membership.auth_user_id = auth.uid()
    and membership.status = 'active'
    and exists (
      select 1
      from public.membership_role_assignments assignment
      join private.role_permissions permission
        on permission.role = assignment.role
       and permission.permission = requested_permission
      where assignment.organisation_id = membership.organisation_id
        and assignment.membership_id = membership.id
        and assignment.scope_type = 'organisation'
        and assignment.site_id is null
        and assignment.revoked_at is null
    )
  limit 1
$$;

create or replace function private.authorised_payroll_period(
  target_period_id uuid,
  requested_permission text
)
returns table (
  organisation_id uuid,
  membership_id uuid,
  revision integer,
  status public.payroll_period_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select period.organisation_id, membership.id, period.revision, period.status
  from public.payroll_periods period
  join public.organisation_memberships membership
    on membership.organisation_id = period.organisation_id
   and membership.auth_user_id = auth.uid()
   and membership.status = 'active'
  where auth.uid() is not null
    and period.id = target_period_id
    and exists (
      select 1
      from public.membership_role_assignments assignment
      join private.role_permissions permission
        on permission.role = assignment.role
       and permission.permission = requested_permission
      where assignment.organisation_id = membership.organisation_id
        and assignment.membership_id = membership.id
        and assignment.scope_type = 'organisation'
        and assignment.site_id is null
        and assignment.revoked_at is null
    )
  limit 1
$$;

create or replace function private.payroll_request_digest(request_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(request_payload::text, 'sha256'), 'hex')
$$;

create or replace function private.payroll_attendance_evidence(
  target_organisation_id uuid,
  target_site_id uuid,
  target_staff_id text,
  target_date date
)
returns table (
  effective_minutes integer,
  is_malformed boolean,
  has_manager_correction boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  effective_event record;
  pending_clock_in timestamptz;
  pending_clock_in_site_id uuid;
begin
  effective_minutes := 0;
  is_malformed := false;
  has_manager_correction := false;

  for effective_event in
    select event.site_id, event.event_type, event.event_timestamp, event.source,
      event.event_order_key, event.event_id
    from public.organisation_sites site
    cross join lateral private.get_commercial_effective_clock_events(
      target_organisation_id,
      site.id,
      target_date,
      target_date,
      target_staff_id
    ) event
    where site.organisation_id = target_organisation_id
    order by event.event_timestamp, event.event_order_key, event.event_id
  loop
    has_manager_correction := has_manager_correction
      or (effective_event.site_id = target_site_id and effective_event.source = 'manager_correction');
    if effective_event.event_type = 'clock_in' then
      if pending_clock_in is not null then
        is_malformed := true;
      else
        pending_clock_in := effective_event.event_timestamp;
        pending_clock_in_site_id := effective_event.site_id;
      end if;
    elsif pending_clock_in is null
       or effective_event.event_timestamp <= pending_clock_in
       or effective_event.site_id <> pending_clock_in_site_id then
      is_malformed := true;
    else
      if pending_clock_in_site_id = target_site_id then
        effective_minutes := effective_minutes
          + floor(extract(epoch from (effective_event.event_timestamp - pending_clock_in)) / 60)::integer;
      end if;
      pending_clock_in := null;
      pending_clock_in_site_id := null;
    end if;
  end loop;

  if pending_clock_in is not null then
    is_malformed := true;
  end if;
  if is_malformed then
    effective_minutes := 0;
  end if;
  return next;
end
$$;

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
  with row_input as (
    select distinct row_value ->> 'staffId' staff_id,
      (row_value ->> 'operationalDate')::date operational_date
    from jsonb_array_elements(preparation_rows) row_value
  )
  select encode(extensions.digest(coalesce(string_agg(
    to_jsonb(event)::text, E'\n'
    order by event.recorded_date, event.staff_id, event.site_id,
      event.event_timestamp, event.event_order_key, event.event_id
  ), '') || '|site-filter:' || coalesce(target_site_filter_id::text, 'all'), 'sha256'), 'hex')
  from public.organisation_sites site
  cross join lateral private.get_commercial_effective_clock_events(
    target_organisation_id, site.id, period_start, period_end, null
  ) event
  join row_input row_value
    on row_value.staff_id = event.staff_id and row_value.operational_date = event.recorded_date
  where site.organisation_id = target_organisation_id
$$;

create or replace function private.payroll_pay_arrangement_fingerprint(
  target_organisation_id uuid,
  target_arrangement_ids uuid[]
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(string_agg(
    to_jsonb(arrangement)::text, E'\n' order by arrangement.id
  ), ''), 'sha256'), 'hex')
  from public.staff_pay_arrangements arrangement
  where arrangement.organisation_id = target_organisation_id
    and arrangement.id = any(coalesce(target_arrangement_ids, '{}'::uuid[]))
$$;

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
  with row_input as (
    select row_value ->> 'staffId' staff_id,
      nullif(row_value ->> 'siteId', '')::uuid site_id,
      nullif(row_value ->> 'payArrangementId', '')::uuid pay_arrangement_id,
      (row_value ->> 'operationalDate')::date operational_date
    from jsonb_array_elements(preparation_rows) row_value
  ), row_evidence as (
    select row_value.*, evidence.effective_minutes, evidence.is_malformed,
      evidence.has_manager_correction
    from row_input row_value
    left join lateral private.payroll_attendance_evidence(
      target_organisation_id, row_value.site_id, row_value.staff_id, row_value.operational_date
    ) evidence on row_value.site_id is not null
  ), issue_values as (
    select 'malformed_sequence'::text code, 'blocker'::text severity,
      row_value.staff_id, row_value.site_id, row_value.operational_date,
      null::text source_id
    from row_evidence row_value where coalesce(row_value.is_malformed, false)
    union all
    select 'long_shift', 'warning', row_value.staff_id, row_value.site_id,
      row_value.operational_date, null::text
    from row_evidence row_value where coalesce(row_value.effective_minutes, 0) > 720
    union all
    select 'site_attribution', 'blocker', row_value.staff_id, row_value.site_id,
      row_value.operational_date, null::text
    from row_input row_value where row_value.site_id is null
    union all
    select 'missing_pay_arrangement', 'blocker', row_value.staff_id, row_value.site_id,
      row_value.operational_date, null::text
    from row_input row_value where row_value.pay_arrangement_id is null
    union all
    select 'unreviewed_day', 'warning', row_value.staff_id, row_value.site_id,
      row_value.operational_date, null::text
    from row_input row_value
    where row_value.site_id is not null and not exists (
      select 1 from public.attendance_day_reviews review
      where review.organisation_id = target_organisation_id
        and review.site_id = row_value.site_id
        and review.staff_id = row_value.staff_id
        and review.review_date = row_value.operational_date
    )
    union all
    select 'manager_correction', 'informational', row_value.staff_id, row_value.site_id,
      row_value.operational_date, event.correction_id::text
    from row_input row_value
    cross join lateral private.get_commercial_effective_clock_events(
      target_organisation_id, row_value.site_id, row_value.operational_date,
      row_value.operational_date, row_value.staff_id
    ) event
    where row_value.site_id is not null and event.correction_id is not null
    union all
    select 'unresolved_exception', 'blocker', exception.staff_id, exception.site_id,
      exception.operational_date, exception.id::text
    from public.attendance_exceptions exception
    where exception.organisation_id = target_organisation_id
      and exception.operational_date between period_start and period_end
      and exception.status in ('open', 'under_review')
      and (target_site_filter_id is null or exception.site_id = target_site_filter_id)
    union all
    select 'pending_request', 'blocker', request.staff_id, request.site_id,
      request.attendance_date, request.id::text
    from public.attendance_correction_requests request
    where request.organisation_id = target_organisation_id
      and request.attendance_date between period_start and period_end
      and request.status = 'pending'
      and (target_site_filter_id is null or request.site_id = target_site_filter_id)
  ), issues as (
    select distinct jsonb_build_object(
      'code', issue.code,
      'severity', issue.severity,
      'organisationId', target_organisation_id,
      'staffId', issue.staff_id,
      'siteId', issue.site_id,
      'operationalDate', issue.operational_date,
      'sourceId', issue.source_id
    ) issue
    from issue_values issue
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

create or replace function private.payroll_canonical_arithmetic(
  target_organisation_id uuid,
  period_start date,
  period_end date,
  preparation_rows jsonb
)
returns table (
  source_key text,
  pay_regime_key text,
  ordinary_minutes_limit integer,
  ordinary_minutes integer,
  overtime_minutes integer,
  estimated_gross_value numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive row_input as (
    select row_value ->> 'sourceKey' source_key,
      row_value ->> 'staffId' staff_id,
      nullif(row_value ->> 'siteId', '')::uuid site_id,
      nullif(row_value ->> 'payArrangementId', '')::uuid pay_arrangement_id,
      (row_value ->> 'operationalDate')::date operational_date,
      (row_value ->> 'payableMinutes')::integer payable_minutes
    from jsonb_array_elements(preparation_rows) row_value
  ), arrangement_segments as (
    select arrangement.id, arrangement.staff_id, arrangement.pay_type,
      arrangement.contracted_weekly_hours, arrangement.hours_basis,
      arrangement.hourly_rate, arrangement.overtime_multiplier,
      greatest(arrangement.effective_from, period_start) segment_start,
      least(coalesce(arrangement.effective_to, period_end), period_end) segment_end
    from public.staff_pay_arrangements arrangement
    where arrangement.organisation_id = target_organisation_id
      and arrangement.is_active
      and arrangement.effective_from <= period_end
      and coalesce(arrangement.effective_to, period_end) >= period_start
  ), arrangement_boundaries as (
    select segment.*,
      case when lag(segment.segment_end) over staff_order + 1 = segment.segment_start
        and lag(segment.pay_type) over staff_order is not distinct from segment.pay_type
        and lag(segment.contracted_weekly_hours) over staff_order
          is not distinct from segment.contracted_weekly_hours
        and lag(segment.hours_basis) over staff_order is not distinct from segment.hours_basis
      then 0 else 1 end regime_boundary
    from arrangement_segments segment
    window staff_order as (
      partition by segment.staff_id order by segment.segment_start, segment.segment_end, segment.id
    )
  ), arrangement_regimes as (
    select boundary.*,
      sum(boundary.regime_boundary) over (
        partition by boundary.staff_id
        order by boundary.segment_start, boundary.segment_end, boundary.id
      ) regime_number
    from arrangement_boundaries boundary
  ), regime_details as (
    select regime.staff_id, regime.regime_number,
      min(regime.segment_start) regime_start, max(regime.segment_end) regime_end,
      min(regime.pay_type::text)::public.payroll_pay_type pay_type,
      min(regime.contracted_weekly_hours) contracted_weekly_hours
    from arrangement_regimes regime
    group by regime.staff_id, regime.regime_number
  ), attributed_rows as (
    select input.*,
      arrangement.regime_number,
      input.staff_id || ':' || coalesce(arrangement.regime_number::text, 'missing')
        pay_regime_key,
      coalesce(regime.pay_type, arrangement.pay_type) pay_type,
      coalesce(regime.contracted_weekly_hours, arrangement.contracted_weekly_hours)
        contracted_weekly_hours,
      coalesce(regime.regime_start, period_start) regime_start,
      coalesce(regime.regime_end, period_end) regime_end,
      arrangement.hourly_rate,
      arrangement.overtime_multiplier
    from row_input input
    left join arrangement_regimes arrangement on arrangement.id = input.pay_arrangement_id
    left join regime_details regime
      on regime.staff_id = arrangement.staff_id and regime.regime_number = arrangement.regime_number
  ), regime_totals as (
    select row_value.*,
      case
        when row_value.pay_type = 'hourly' and row_value.contracted_weekly_hours is not null
          then round(row_value.contracted_weekly_hours * 60
            * (row_value.regime_end - row_value.regime_start + 1)::numeric / 7)::integer
        else null
      end ordinary_minutes_limit,
      sum(row_value.payable_minutes) over (
        partition by row_value.staff_id, row_value.pay_regime_key
      ) regime_payable_minutes,
      coalesce(sum(row_value.payable_minutes) over (
        partition by row_value.staff_id, row_value.pay_regime_key
        order by row_value.operational_date, coalesce(row_value.site_id::text, ''), row_value.source_key
        rows between unbounded preceding and 1 preceding
      ), 0)::integer prior_payable_minutes
    from attributed_rows row_value
  ), split_rows as (
    select row_value.*,
      least(
        row_value.payable_minutes,
        greatest(0,
          coalesce(row_value.ordinary_minutes_limit, row_value.regime_payable_minutes::integer)
            - row_value.prior_payable_minutes
        )
      )::integer canonical_ordinary_minutes
    from regime_totals row_value
  ), exact_values as (
    select row_value.*,
      row_value.payable_minutes - row_value.canonical_ordinary_minutes canonical_overtime_minutes,
      case when row_value.pay_type = 'hourly' and row_value.hourly_rate is not null then
        row_value.canonical_ordinary_minutes::numeric / 60 * row_value.hourly_rate
        + (row_value.payable_minutes - row_value.canonical_ordinary_minutes)::numeric / 60
          * row_value.hourly_rate * coalesce(row_value.overtime_multiplier, 1)
      else null end exact_gross
    from split_rows row_value
  ), gross_values as (
    select row_value.*,
      round(sum(row_value.exact_gross) over (
        partition by row_value.pay_arrangement_id
      ), 2) arrangement_gross,
      row_number() over (
        partition by row_value.pay_arrangement_id
        order by row_value.operational_date desc, coalesce(row_value.site_id::text, '') desc,
          row_value.source_key desc
      ) reverse_row_number,
      coalesce(sum(round(row_value.exact_gross, 2)) over (
        partition by row_value.pay_arrangement_id
        order by row_value.operational_date, coalesce(row_value.site_id::text, ''), row_value.source_key
        rows between unbounded preceding and 1 preceding
      ), 0) prior_rounded_gross
    from exact_values row_value
  )
  select row_value.source_key,
    row_value.pay_regime_key,
    row_value.ordinary_minutes_limit,
    row_value.canonical_ordinary_minutes,
    row_value.canonical_overtime_minutes,
    case when row_value.exact_gross is null then null
      when row_value.reverse_row_number = 1
        then row_value.arrangement_gross - row_value.prior_rounded_gross
      else round(row_value.exact_gross, 2)
    end estimated_gross_value
  from gross_values row_value
  order by row_value.source_key
$$;

create or replace function private.payroll_snapshot_arithmetic(
  preparation_rows jsonb
)
returns table (
  source_key text,
  ordinary_minutes integer,
  overtime_minutes integer,
  estimated_gross_value numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with row_input as (
    select row_value ->> 'sourceKey' source_key,
      row_value ->> 'staffId' staff_id,
      nullif(row_value ->> 'siteId', '')::uuid site_id,
      nullif(row_value ->> 'payArrangementId', '')::uuid pay_arrangement_id,
      (row_value ->> 'operationalDate')::date operational_date,
      (row_value ->> 'payableMinutes')::integer payable_minutes,
      nullif(row_value ->> 'payType', '')::public.payroll_pay_type pay_type,
      row_value ->> 'payRegimeKey' pay_regime_key,
      nullif(row_value ->> 'ordinaryMinutesLimit', '')::integer ordinary_minutes_limit,
      nullif(row_value ->> 'hourlyRate', '')::numeric hourly_rate,
      nullif(row_value ->> 'overtimeMultiplier', '')::numeric overtime_multiplier
    from jsonb_array_elements(preparation_rows) row_value
  ), regime_totals as (
    select row_value.*,
      sum(row_value.payable_minutes) over (
        partition by row_value.staff_id, row_value.pay_regime_key
      ) regime_payable_minutes,
      coalesce(sum(row_value.payable_minutes) over (
        partition by row_value.staff_id, row_value.pay_regime_key
        order by row_value.operational_date, coalesce(row_value.site_id::text, ''), row_value.source_key
        rows between unbounded preceding and 1 preceding
      ), 0)::integer prior_payable_minutes
    from row_input row_value
  ), split_rows as (
    select row_value.*,
      least(
        row_value.payable_minutes,
        greatest(0,
          coalesce(row_value.ordinary_minutes_limit, row_value.regime_payable_minutes::integer)
            - row_value.prior_payable_minutes
        )
      )::integer canonical_ordinary_minutes
    from regime_totals row_value
  ), exact_values as (
    select row_value.*,
      row_value.payable_minutes - row_value.canonical_ordinary_minutes canonical_overtime_minutes,
      case when row_value.pay_type = 'hourly' and row_value.hourly_rate is not null then
        row_value.canonical_ordinary_minutes::numeric / 60 * row_value.hourly_rate
        + (row_value.payable_minutes - row_value.canonical_ordinary_minutes)::numeric / 60
          * row_value.hourly_rate * coalesce(row_value.overtime_multiplier, 1)
      else null end exact_gross
    from split_rows row_value
  ), gross_values as (
    select row_value.*,
      round(sum(row_value.exact_gross) over (
        partition by row_value.pay_arrangement_id
      ), 2) arrangement_gross,
      row_number() over (
        partition by row_value.pay_arrangement_id
        order by row_value.operational_date desc, coalesce(row_value.site_id::text, '') desc,
          row_value.source_key desc
      ) reverse_row_number,
      coalesce(sum(round(row_value.exact_gross, 2)) over (
        partition by row_value.pay_arrangement_id
        order by row_value.operational_date, coalesce(row_value.site_id::text, ''), row_value.source_key
        rows between unbounded preceding and 1 preceding
      ), 0) prior_rounded_gross
    from exact_values row_value
  )
  select row_value.source_key,
    row_value.canonical_ordinary_minutes,
    row_value.canonical_overtime_minutes,
    case when row_value.exact_gross is null then null
      when row_value.reverse_row_number = 1
        then row_value.arrangement_gross - row_value.prior_rounded_gross
      else round(row_value.exact_gross, 2)
    end estimated_gross_value
  from gross_values row_value
  order by row_value.source_key
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
  preparation_row jsonb;
  readiness_issue jsonb;
  evidence_group record;
  evidence record;
  arrangement public.staff_pay_arrangements%rowtype;
  row_staff_id text;
  row_site_id uuid;
  row_arrangement_id uuid;
  row_date date;
  authoritative_readiness jsonb;
  normalised_readiness_issues jsonb;
  blocker_count integer := 0;
  warning_count integer := 0;
  informational_count integer := 0;
begin
  if jsonb_typeof(preparation_rows) <> 'array'
     or jsonb_array_length(preparation_rows) = 0
     or jsonb_typeof(preparation_readiness) <> 'object'
     or jsonb_typeof(preparation_readiness -> 'issues') <> 'array'
     or jsonb_typeof(preparation_readiness -> 'counts') <> 'object' then
    return 'invalid_snapshot';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(preparation_rows) row_value
    group by row_value ->> 'staffId', row_value ->> 'siteId', row_value ->> 'operationalDate'
    having count(*) > 1
  ) then
    return 'duplicate_evidence';
  end if;

  for readiness_issue in select value from jsonb_array_elements(preparation_readiness -> 'issues')
  loop
    if readiness_issue ->> 'organisationId' is distinct from target_organisation_id::text then
      return 'invalid_readiness';
    end if;
    if readiness_issue ->> 'severity' = 'blocker' then
      blocker_count := blocker_count + 1;
    elsif readiness_issue ->> 'severity' = 'warning' then
      warning_count := warning_count + 1;
    elsif readiness_issue ->> 'severity' = 'informational' then
      informational_count := informational_count + 1;
    else
      return 'invalid_readiness';
    end if;

    if readiness_issue ->> 'staffId' is not null and not exists (
      select 1 from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id
        and staff.id = readiness_issue ->> 'staffId'
    ) then
      return 'invalid_readiness';
    end if;
    if readiness_issue ->> 'siteId' is not null and not exists (
      select 1 from public.organisation_sites site
      where site.organisation_id = target_organisation_id
        and site.id = (readiness_issue ->> 'siteId')::uuid
    ) then
      return 'invalid_readiness';
    end if;
    if target_site_filter_id is not null
       and readiness_issue ->> 'siteId' is not null
       and (readiness_issue ->> 'siteId')::uuid <> target_site_filter_id then
      return 'invalid_readiness';
    end if;
    if readiness_issue ->> 'operationalDate' is not null
       and (readiness_issue ->> 'operationalDate')::date not between period_start and period_end then
      return 'invalid_readiness';
    end if;
  end loop;

  if blocker_count <> coalesce((preparation_readiness #>> '{counts,blocker}')::integer, -1)
     or warning_count <> coalesce((preparation_readiness #>> '{counts,warning}')::integer, -1)
     or informational_count <> coalesce((preparation_readiness #>> '{counts,informational}')::integer, -1) then
    return 'invalid_readiness';
  end if;

  for preparation_row in select value from jsonb_array_elements(preparation_rows)
  loop
    if jsonb_typeof(preparation_row) <> 'object'
       or length(btrim(coalesce(preparation_row ->> 'sourceKey', ''))) not between 1 and 255 then
      return 'invalid_snapshot';
    end if;
    row_staff_id := preparation_row ->> 'staffId';
    row_site_id := nullif(preparation_row ->> 'siteId', '')::uuid;
    row_arrangement_id := nullif(preparation_row ->> 'payArrangementId', '')::uuid;
    row_date := (preparation_row ->> 'operationalDate')::date;
    arrangement := null;

    if row_date not between period_start and period_end then
      return 'invalid_snapshot';
    end if;
    if not exists (
      select 1 from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id and staff.id = row_staff_id
    ) then
      return 'invalid_staff';
    end if;
    if row_site_id is not null and not exists (
      select 1 from public.organisation_sites site
      where site.organisation_id = target_organisation_id and site.id = row_site_id
    ) then
      return 'invalid_site';
    end if;
    if target_site_filter_id is not null and row_site_id is distinct from target_site_filter_id then
      return 'invalid_site';
    end if;
    if row_site_id is not null and not exists (
      select 1 from public.staff_site_assignments assignment
      where assignment.organisation_id = target_organisation_id
        and assignment.staff_id = row_staff_id
        and assignment.site_id = row_site_id
        and assignment.effective_from <= row_date
        and (assignment.effective_to is null or assignment.effective_to >= row_date)
    ) then
      return 'invalid_site_attribution';
    end if;

    if preparation_row ->> 'sourceKey' is distinct from (
      target_organisation_id::text || ':' || row_staff_id || ':' || row_date::text || ':'
        || coalesce(row_site_id::text, 'unattributed')
    ) then
      return 'invalid_source_key';
    end if;

    if row_arrangement_id is null then
      if preparation_row ->> 'payType' is not null
         or preparation_row ->> 'hourlyRate' is not null
         or preparation_row ->> 'annualSalary' is not null
         or preparation_row ->> 'monthlySalary' is not null
         or not exists (
           select 1 from jsonb_array_elements(preparation_readiness -> 'issues') issue
           where issue ->> 'code' = 'missing_pay_arrangement'
             and issue ->> 'severity' = 'blocker'
             and issue ->> 'staffId' = row_staff_id
         ) then
        return 'invalid_pay_arrangement';
      end if;
    else
      select candidate.* into arrangement
      from public.staff_pay_arrangements candidate
      where candidate.organisation_id = target_organisation_id
        and candidate.id = row_arrangement_id
        and candidate.staff_id = row_staff_id
        and candidate.is_active
        and candidate.effective_from <= row_date
        and (candidate.effective_to is null or candidate.effective_to >= row_date);
      if not found then
        return 'invalid_pay_arrangement';
      end if;
      if preparation_row ->> 'payType' is distinct from arrangement.pay_type::text
         or nullif(preparation_row ->> 'hourlyRate', '')::numeric is distinct from arrangement.hourly_rate
         or nullif(preparation_row ->> 'annualSalary', '')::numeric is distinct from arrangement.annual_salary
         or nullif(preparation_row ->> 'monthlySalary', '')::numeric is distinct from arrangement.monthly_salary
         or nullif(preparation_row ->> 'overtimeMultiplier', '')::numeric is distinct from arrangement.overtime_multiplier then
        return 'invalid_pay_arrangement';
      end if;
    end if;

    if coalesce((preparation_row ->> 'adjustmentMinutes')::integer, 0) <> 0
       or (preparation_row ->> 'rawMinutes')::integer < 0
       or (preparation_row ->> 'payableMinutes')::integer
          <> (preparation_row ->> 'rawMinutes')::integer + (preparation_row ->> 'adjustmentMinutes')::integer
       or (preparation_row ->> 'ordinaryMinutes')::integer + (preparation_row ->> 'overtimeMinutes')::integer
          <> (preparation_row ->> 'payableMinutes')::integer
       or jsonb_typeof(preparation_row -> 'warnings') <> 'array'
       or preparation_row ->> 'currencyCode' <> 'GBP' then
      return 'invalid_snapshot';
    end if;

    if row_site_id is null then
      if (preparation_row ->> 'rawMinutes')::integer <> 0 then
        return 'attendance_evidence_mismatch';
      end if;
    else
      select * into evidence
      from private.payroll_attendance_evidence(
        target_organisation_id, row_site_id, row_staff_id, row_date
      );
      if (preparation_row ->> 'rawMinutes')::integer <> evidence.effective_minutes then
        return 'attendance_evidence_mismatch';
      end if;
      if evidence.is_malformed and not exists (
        select 1 from jsonb_array_elements(preparation_readiness -> 'issues') issue
        where issue ->> 'code' = 'malformed_sequence'
          and issue ->> 'severity' = 'blocker'
          and issue ->> 'staffId' = row_staff_id
          and (issue ->> 'siteId')::uuid = row_site_id
          and (issue ->> 'operationalDate')::date = row_date
      ) then
        return 'invalid_readiness';
      end if;
      if evidence.has_manager_correction and not exists (
        select 1 from jsonb_array_elements(preparation_readiness -> 'issues') issue
        where issue ->> 'code' = 'manager_correction'
          and issue ->> 'severity' = 'informational'
          and issue ->> 'staffId' = row_staff_id
          and (issue ->> 'siteId')::uuid = row_site_id
          and (issue ->> 'operationalDate')::date = row_date
      ) then
        return 'invalid_readiness';
      end if;
    end if;

  end loop;

  if exists (
    select 1
    from jsonb_array_elements(preparation_rows) supplied
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

  for evidence_group in
    select grouped_evidence.site_id, grouped_evidence.staff_id, grouped_evidence.recorded_date
    from (
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
    ) grouped_evidence
  loop
    if not exists (
      select 1 from jsonb_array_elements(preparation_rows) row_value
      where row_value ->> 'staffId' = evidence_group.staff_id
        and (row_value ->> 'siteId')::uuid = evidence_group.site_id
        and (row_value ->> 'operationalDate')::date = evidence_group.recorded_date
    ) then
      return 'attendance_evidence_mismatch';
    end if;
  end loop;

  authoritative_readiness := private.payroll_authoritative_readiness(
    target_organisation_id, period_start, period_end, target_site_filter_id, preparation_rows
  );
  select coalesce(jsonb_agg(issue order by issue::text), '[]'::jsonb)
    into normalised_readiness_issues
  from (
    select distinct value issue
    from jsonb_array_elements(preparation_readiness -> 'issues')
  ) supplied_issues;
  if jsonb_build_object(
    'issues', normalised_readiness_issues,
    'counts', preparation_readiness -> 'counts'
  ) <> authoritative_readiness then
    return 'invalid_readiness';
  end if;

  return null;
exception
  when others then
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
  select run.* into stored_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_organisation_id and run.id = target_run_id;
  if not found then
    return 'stale_attendance_evidence';
  end if;

  select period.* into stored_period
  from public.payroll_periods period
  where period.organisation_id = target_organisation_id and period.id = stored_run.period_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'staffId', row_value.staff_id,
    'siteId', row_value.site_id,
    'payArrangementId', row_value.pay_arrangement_id,
    'operationalDate', row_value.operational_date
  ) order by row_value.staff_id, row_value.operational_date, row_value.source_key), '[]'::jsonb)
    into fingerprint_rows
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_organisation_id and row_value.run_id = target_run_id;
  if stored_run.authoritative_attendance_fingerprint <> private.payroll_attendance_fingerprint(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id, fingerprint_rows
  ) then
    return 'stale_attendance_fingerprint';
  end if;
  select array_agg(distinct row_value.pay_arrangement_id order by row_value.pay_arrangement_id)
    filter (where row_value.pay_arrangement_id is not null)
    into arrangement_ids
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = target_organisation_id and row_value.run_id = target_run_id;
  if stored_run.authoritative_pay_arrangement_fingerprint <> private.payroll_pay_arrangement_fingerprint(
    target_organisation_id, arrangement_ids
  ) then
    return 'stale_pay_arrangement_fingerprint';
  end if;
  current_readiness := private.payroll_authoritative_readiness(
    target_organisation_id, stored_period.period_start, stored_period.period_end,
    stored_run.site_filter_id, fingerprint_rows
  );
  if stored_run.readiness is distinct from current_readiness then
    return 'stale_readiness';
  end if;

  for stored_row in
    select row_value.* from public.payroll_preparation_rows row_value
    where row_value.organisation_id = target_organisation_id and row_value.run_id = target_run_id
  loop
    if stored_row.pay_arrangement_id is not null and not exists (
      select 1 from public.staff_pay_arrangements arrangement
      where arrangement.organisation_id = target_organisation_id
        and arrangement.id = stored_row.pay_arrangement_id
        and arrangement.staff_id = stored_row.staff_id
        and arrangement.is_active
        and arrangement.effective_from <= stored_row.operational_date
        and (arrangement.effective_to is null or arrangement.effective_to >= stored_row.operational_date)
        and arrangement.pay_type is not distinct from stored_row.pay_type
        and arrangement.hourly_rate is not distinct from stored_row.hourly_rate
        and arrangement.annual_salary is not distinct from stored_row.annual_salary
        and arrangement.monthly_salary is not distinct from stored_row.monthly_salary
        and arrangement.overtime_multiplier is not distinct from stored_row.overtime_multiplier
    ) then
      return 'stale_pay_arrangement_evidence';
    end if;

    if stored_row.site_id is not null then
      select * into evidence
      from private.payroll_attendance_evidence(
        target_organisation_id,
        stored_row.site_id,
        stored_row.staff_id,
        stored_row.operational_date
      );
      if stored_row.raw_minutes <> evidence.effective_minutes then
        return 'stale_attendance_evidence';
      end if;
    elsif stored_row.raw_minutes <> 0 then
      return 'stale_attendance_evidence';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select event.site_id, event.staff_id, event.recorded_date
      from public.clock_events event
      where event.organisation_id = target_organisation_id
        and event.recorded_date between (
          select period.period_start from public.payroll_periods period
          where period.organisation_id = target_organisation_id and period.id = stored_run.period_id
        ) and (
          select period.period_end from public.payroll_periods period
          where period.organisation_id = target_organisation_id and period.id = stored_run.period_id
        )
        and (stored_run.site_filter_id is null or event.site_id = stored_run.site_filter_id)
      union
      select correction.site_id, correction.staff_id, correction.recorded_date
      from public.clock_event_corrections correction
      where correction.organisation_id = target_organisation_id
        and correction.recorded_date between (
          select period.period_start from public.payroll_periods period
          where period.organisation_id = target_organisation_id and period.id = stored_run.period_id
        ) and (
          select period.period_end from public.payroll_periods period
          where period.organisation_id = target_organisation_id and period.id = stored_run.period_id
        )
        and (stored_run.site_filter_id is null or correction.site_id = stored_run.site_filter_id)
    ) current_evidence
    where not exists (
      select 1 from public.payroll_preparation_rows row_value
      where row_value.organisation_id = target_organisation_id
        and row_value.run_id = target_run_id
        and row_value.staff_id = current_evidence.staff_id
        and row_value.site_id = current_evidence.site_id
        and row_value.operational_date = current_evidence.recorded_date
    )
  ) then
    return 'stale_attendance_evidence';
  end if;

  return null;
end
$$;

create or replace function private.clone_payroll_run(
  source_run public.payroll_preparation_runs,
  target_revision integer,
  target_operation_id uuid,
  target_request_digest text,
  actor_membership_id uuid,
  target_status public.payroll_preparation_status
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cloned_run_id uuid;
begin
  insert into public.payroll_preparation_runs (
    organisation_id, period_id, revision, status, operation_id, request_expected_revision,
    request_digest,
    input_fingerprint, attendance_fingerprint, pay_arrangement_fingerprint,
    authoritative_attendance_fingerprint, authoritative_pay_arrangement_fingerprint,
    blocker_count, warning_count, informational_count, readiness, site_filter_id,
    supersedes_run_id, supersedes_revision, prepared_by_membership_id
  ) values (
    source_run.organisation_id, source_run.period_id, target_revision, target_status, target_operation_id,
    target_revision - 1, target_request_digest,
    source_run.input_fingerprint, source_run.attendance_fingerprint, source_run.pay_arrangement_fingerprint,
    source_run.authoritative_attendance_fingerprint,
    source_run.authoritative_pay_arrangement_fingerprint,
    source_run.blocker_count, source_run.warning_count, source_run.informational_count,
    source_run.readiness, source_run.site_filter_id,
    source_run.id, source_run.revision, actor_membership_id
  ) returning id into cloned_run_id;

  insert into public.payroll_preparation_rows (
    organisation_id, run_id, staff_id, site_id, pay_arrangement_id,
    operational_date, source_key, pay_type, pay_regime_key, ordinary_minutes_limit,
    raw_minutes, adjustment_minutes,
    payable_minutes, ordinary_minutes, overtime_minutes, hourly_rate,
    annual_salary, monthly_salary, overtime_multiplier, estimated_gross_value,
    currency_code, warnings
  )
  select row_value.organisation_id, cloned_run_id, row_value.staff_id, row_value.site_id,
    row_value.pay_arrangement_id, row_value.operational_date, row_value.source_key,
    row_value.pay_type, row_value.pay_regime_key, row_value.ordinary_minutes_limit,
    row_value.raw_minutes, row_value.adjustment_minutes,
    row_value.payable_minutes, row_value.ordinary_minutes, row_value.overtime_minutes,
    row_value.hourly_rate, row_value.annual_salary, row_value.monthly_salary,
    row_value.overtime_multiplier, row_value.estimated_gross_value,
    row_value.currency_code, row_value.warnings
  from public.payroll_preparation_rows row_value
  where row_value.organisation_id = source_run.organisation_id
    and row_value.run_id = source_run.id;

  return cloned_run_id;
end
$$;

revoke all on function private.payroll_command_actor(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.authorised_payroll_period(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.payroll_request_digest(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.payroll_attendance_evidence(uuid, uuid, text, date) from public, anon, authenticated, service_role;
revoke all on function private.payroll_attendance_fingerprint(uuid, date, date, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.payroll_pay_arrangement_fingerprint(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.payroll_authoritative_readiness(uuid, date, date, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.payroll_canonical_arithmetic(uuid, date, date, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.payroll_snapshot_arithmetic(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.validate_payroll_snapshot(uuid, date, date, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.payroll_run_evidence_drift(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.clone_payroll_run(public.payroll_preparation_runs, integer, uuid, text, uuid, public.payroll_preparation_status) from public, anon, authenticated, service_role;

create or replace function public.create_commercial_payroll_period(
  target_organisation_id uuid,
  target_period_start date,
  target_period_end date,
  target_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  existing_period public.payroll_periods%rowtype;
  created_period public.payroll_periods%rowtype;
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
  if target_operation_id is null
     or target_period_start is null
     or target_period_end is null
     or target_period_end < target_period_start
     or target_period_end - target_period_start > 365 then
    return jsonb_build_object('ok', false, 'code', 'invalid_period');
  end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'organisationId', target_organisation_id,
    'periodStart', target_period_start,
    'periodEnd', target_period_end,
    'command', 'create_period'
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || target_organisation_id::text || ':' || target_operation_id::text, 0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-period:' || target_organisation_id::text || ':'
      || target_period_start::text || ':' || target_period_end::text, 0
  ));

  select period.* into existing_period
  from public.payroll_periods period
  where period.organisation_id = target_organisation_id
    and period.operation_id = target_operation_id;
  if found then
    if existing_period.request_digest is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'period_reused',
      'reused', true,
      'organisationId', existing_period.organisation_id,
      'periodId', existing_period.id,
      'revision', existing_period.revision,
      'status', existing_period.status
    );
  end if;

  select period.* into existing_period
  from public.payroll_periods period
  where period.organisation_id = target_organisation_id
    and period.period_start = target_period_start
    and period.period_end = target_period_end;
  if found then
    return jsonb_build_object(
      'ok', true,
      'code', 'period_reused',
      'reused', true,
      'organisationId', existing_period.organisation_id,
      'periodId', existing_period.id,
      'revision', existing_period.revision,
      'status', existing_period.status
    );
  end if;

  insert into public.payroll_periods (
    organisation_id, period_start, period_end, operation_id, request_digest,
    created_by_membership_id
  ) values (
    target_organisation_id, target_period_start, target_period_end,
    target_operation_id, command_request_digest, actor_membership_id
  ) returning * into created_period;

  return jsonb_build_object(
    'ok', true,
    'code', 'period_created',
    'reused', false,
    'organisationId', created_period.organisation_id,
    'periodId', created_period.id,
    'revision', created_period.revision,
    'status', created_period.status
  );
end
$$;

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

  if jsonb_typeof(preparation_rows) = 'array' then
    select coalesce(jsonb_agg(value order by value ->> 'sourceKey', value::text), '[]'::jsonb)
      into normalised_request_rows
    from jsonb_array_elements(preparation_rows);
  else
    normalised_request_rows := preparation_rows;
  end if;
  if jsonb_typeof(preparation_readiness) = 'object'
     and jsonb_typeof(preparation_readiness -> 'issues') = 'array' then
    select coalesce(jsonb_agg(issue order by issue::text), '[]'::jsonb)
      into normalised_request_issues
    from (
      select distinct value issue
      from jsonb_array_elements(preparation_readiness -> 'issues')
    ) supplied_issues;
    normalised_request_readiness := jsonb_build_object(
      'issues', normalised_request_issues,
      'counts', preparation_readiness -> 'counts'
    );
  else
    normalised_request_readiness := preparation_readiness;
  end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id,
    'siteFilterId', target_site_filter_id,
    'expectedRevision', expected_revision,
    'inputFingerprint', target_input_fingerprint,
    'attendanceFingerprint', target_attendance_fingerprint,
    'payArrangementFingerprint', target_pay_arrangement_fingerprint,
    'rows', normalised_request_rows,
    'readiness', normalised_request_readiness,
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
      'ok', true,
      'code', 'preparation_reused',
      'reused', true,
      'organisationId', existing_run.organisation_id,
      'periodId', existing_run.period_id,
      'runId', existing_run.id,
      'revision', existing_run.revision,
      'status', existing_run.status,
      'blockerCount', existing_run.blocker_count,
      'warningCount', existing_run.warning_count,
      'informationalCount', existing_run.informational_count
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
  if target_operation_id is null
     or target_input_fingerprint !~ '^[0-9a-f]{64}$'
     or target_attendance_fingerprint !~ '^[0-9a-f]{64}$'
     or target_pay_arrangement_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_fingerprint');
  end if;
  if target_site_filter_id is not null and not exists (
    select 1 from public.organisation_sites site
    where site.organisation_id = target_period.organisation_id
      and site.id = target_site_filter_id
      and site.active
      and site.archived_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_site');
  end if;

  validation_code := private.validate_payroll_snapshot(
    target_period.organisation_id,
    target_period.period_start,
    target_period.period_end,
    target_site_filter_id,
    preparation_rows,
    preparation_readiness
  );
  if validation_code is not null then
    return jsonb_build_object('ok', false, 'code', validation_code);
  end if;

  select coalesce(jsonb_object_agg(
    canonical.source_key,
    jsonb_build_object(
      'payRegimeKey', canonical.pay_regime_key,
      'ordinaryMinutesLimit', canonical.ordinary_minutes_limit
    )
  ), '{}'::jsonb)
    into canonical_pay_snapshots
  from private.payroll_canonical_arithmetic(
    target_period.organisation_id,
    target_period.period_start,
    target_period.period_end,
    preparation_rows
  ) canonical;

  authoritative_attendance_fingerprint := private.payroll_attendance_fingerprint(
    target_period.organisation_id, target_period.period_start, target_period.period_end,
    target_site_filter_id, preparation_rows
  );
  select array_agg(distinct nullif(row_value ->> 'payArrangementId', '')::uuid
    order by nullif(row_value ->> 'payArrangementId', '')::uuid)
    filter (where nullif(row_value ->> 'payArrangementId', '') is not null)
    into arrangement_ids
  from jsonb_array_elements(preparation_rows) row_value;
  authoritative_pay_arrangement_fingerprint := private.payroll_pay_arrangement_fingerprint(
    target_period.organisation_id, arrangement_ids
  );
  authoritative_readiness := private.payroll_authoritative_readiness(
    target_period.organisation_id, target_period.period_start, target_period.period_end,
    target_site_filter_id, preparation_rows
  );
  target_blocker_count := (authoritative_readiness #>> '{counts,blocker}')::integer;
  target_warning_count := (authoritative_readiness #>> '{counts,warning}')::integer;
  target_informational_count := (authoritative_readiness #>> '{counts,informational}')::integer;
  target_status := case when target_blocker_count > 0 then 'needs_review'::public.payroll_preparation_status
    else 'ready'::public.payroll_preparation_status end;

  select run.* into current_run
  from public.payroll_preparation_runs run
  where run.organisation_id = target_period.organisation_id
    and run.period_id = target_period.id
    and run.revision = target_period.revision;

  if found then
    if exists (
      select 1 from public.payroll_adjustments adjustment
      where adjustment.organisation_id = current_run.organisation_id
        and adjustment.period_id = current_run.period_id
        and adjustment.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'code', 'active_adjustments_present');
    end if;
    next_revision := target_period.revision + 1;
    update public.payroll_preparation_runs run
    set status = 'superseded'
    where run.organisation_id = current_run.organisation_id and run.id = current_run.id;
  else
    next_revision := target_period.revision;
  end if;

  insert into public.payroll_preparation_runs (
    organisation_id, period_id, revision, status, operation_id, request_expected_revision,
    request_digest,
    input_fingerprint, attendance_fingerprint, pay_arrangement_fingerprint,
    authoritative_attendance_fingerprint, authoritative_pay_arrangement_fingerprint,
    blocker_count, warning_count, informational_count, readiness, site_filter_id,
    supersedes_run_id, supersedes_revision, prepared_by_membership_id
  ) values (
    target_period.organisation_id, target_period.id, next_revision, target_status, target_operation_id,
    expected_revision, command_request_digest,
    target_input_fingerprint, target_attendance_fingerprint,
    target_pay_arrangement_fingerprint, authoritative_attendance_fingerprint,
    authoritative_pay_arrangement_fingerprint,
    target_blocker_count, target_warning_count, target_informational_count,
    authoritative_readiness, target_site_filter_id,
    current_run.id, current_run.revision, command_context.membership_id
  ) returning * into created_run;

  for preparation_row in select value from jsonb_array_elements(preparation_rows)
  loop
    insert into public.payroll_preparation_rows (
      organisation_id, run_id, staff_id, site_id, pay_arrangement_id,
      operational_date, source_key, pay_type, pay_regime_key, ordinary_minutes_limit,
      raw_minutes, adjustment_minutes,
      payable_minutes, ordinary_minutes, overtime_minutes, hourly_rate,
      annual_salary, monthly_salary, overtime_multiplier, estimated_gross_value,
      currency_code, warnings
    ) values (
      target_period.organisation_id,
      created_run.id,
      preparation_row ->> 'staffId',
      nullif(preparation_row ->> 'siteId', '')::uuid,
      nullif(preparation_row ->> 'payArrangementId', '')::uuid,
      (preparation_row ->> 'operationalDate')::date,
      preparation_row ->> 'sourceKey',
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
      preparation_row ->> 'currencyCode',
      preparation_row -> 'warnings'
    );
  end loop;

  if next_revision <> target_period.revision then
    update public.payroll_periods period
    set revision = next_revision, updated_at = now()
    where period.organisation_id = target_period.organisation_id and period.id = target_period.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'preparation_persisted',
    'reused', false,
    'organisationId', created_run.organisation_id,
    'periodId', created_run.period_id,
    'runId', created_run.id,
    'revision', created_run.revision,
    'status', created_run.status,
    'blockerCount', created_run.blocker_count,
    'warningCount', created_run.warning_count,
    'informationalCount', created_run.informational_count
  );
end
$$;

create or replace function public.acknowledge_commercial_payroll_warnings(
  target_period_id uuid,
  expected_revision integer,
  target_operation_id uuid,
  acknowledged_warning_codes text[],
  acknowledgement_note text
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
  acknowledged_run public.payroll_preparation_runs%rowtype;
  required_codes text[];
  normalised_codes text[];
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
  if not found then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-operation:' || command_context.organisation_id::text || ':'
      || coalesce(target_operation_id::text, ''), 0
  ));
  select array_agg(distinct code order by code) into normalised_codes
  from unnest(acknowledged_warning_codes) code;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'periodId', target_period_id,
    'expectedRevision', expected_revision,
    'warningCodes', normalised_codes,
    'note', case when acknowledgement_note is null then null else btrim(acknowledgement_note) end,
    'command', 'acknowledge_warnings'
  ));

  select run.* into acknowledged_run
  from public.payroll_preparation_runs run
  where run.organisation_id = command_context.organisation_id
    and run.period_id = target_period_id
    and run.warning_acknowledgement_operation_id = target_operation_id;
  if found then
    if acknowledged_run.warning_acknowledgement_request_digest
       is distinct from command_request_digest then
      return jsonb_build_object('ok', false, 'code', 'operation_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'warnings_already_acknowledged',
      'reused', true,
      'organisationId', acknowledged_run.organisation_id,
      'periodId', acknowledged_run.period_id,
      'runId', acknowledged_run.id,
      'revision', acknowledged_run.revision,
      'warningCodes', acknowledged_run.warning_acknowledged_codes
    );
  end if;
  if expected_revision is null or target_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select period.* into target_period
  from public.payroll_periods period
  where period.organisation_id = command_context.organisation_id and period.id = target_period_id
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
    and run.period_id = target_period.id
    and run.revision = target_period.revision
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'preparation_required');
  end if;
  if target_run.warning_acknowledgement_operation_id is not null then
    return jsonb_build_object('ok', false, 'code', 'warning_acknowledgement_locked');
  end if;

  select array_agg(distinct issue ->> 'code' order by issue ->> 'code') into required_codes
  from jsonb_array_elements(target_run.readiness -> 'issues') issue
  where issue ->> 'severity' = 'warning';
  if target_run.warning_count = 0
     or required_codes is distinct from normalised_codes
     or cardinality(normalised_codes) <> cardinality(acknowledged_warning_codes)
     or length(btrim(coalesce(acknowledgement_note, ''))) not between 5 and 2000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_warning_acknowledgement');
  end if;

  update public.payroll_preparation_runs run
  set warning_acknowledgement_operation_id = target_operation_id,
      warning_acknowledgement_expected_revision = expected_revision,
      warning_acknowledgement_request_digest = command_request_digest,
      warning_acknowledged_codes = normalised_codes,
      warning_acknowledgement_note = btrim(acknowledgement_note),
      warning_acknowledged_by_membership_id = command_context.membership_id,
      warning_acknowledged_at = now()
  where run.organisation_id = target_run.organisation_id and run.id = target_run.id
  returning * into acknowledged_run;

  return jsonb_build_object(
    'ok', true,
    'code', 'warnings_acknowledged',
    'reused', false,
    'organisationId', acknowledged_run.organisation_id,
    'periodId', acknowledged_run.period_id,
    'runId', acknowledged_run.id,
    'revision', acknowledged_run.revision,
    'warningCodes', acknowledged_run.warning_acknowledged_codes
  );
end
$$;

revoke all on function public.create_commercial_payroll_period(uuid, date, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_commercial_payroll_period(uuid, date, date, uuid) to authenticated;
revoke all on function public.persist_commercial_payroll_preparation(uuid, uuid, integer, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.persist_commercial_payroll_preparation(uuid, uuid, integer, uuid, text, text, text, jsonb, jsonb) to authenticated;
revoke all on function public.acknowledge_commercial_payroll_warnings(uuid, integer, uuid, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_commercial_payroll_warnings(uuid, integer, uuid, text[], text) to authenticated;
revoke all on function public.approve_commercial_payroll_preparation(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_commercial_payroll_preparation(uuid, integer, uuid) to authenticated;
revoke all on function public.reopen_commercial_payroll_preparation(uuid, integer, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reopen_commercial_payroll_preparation(uuid, integer, uuid, text) to authenticated;
revoke all on function public.create_commercial_payroll_adjustment(uuid, integer, uuid, text, uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.create_commercial_payroll_adjustment(uuid, integer, uuid, text, uuid, integer, text) to authenticated;
revoke all on function public.record_commercial_payroll_export(uuid, uuid, integer, uuid, public.payroll_export_format, uuid, text, text, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_commercial_payroll_export(uuid, uuid, integer, uuid, public.payroll_export_format, uuid, text, text, integer, jsonb) to authenticated;

-- Commercial import attribution is membership-owned. The legacy Jan triggers keep
-- staff-account attribution only for explicitly unowned rows.
create or replace function public.protect_payroll_import_attribution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_account public.staff_accounts;
begin
  if new.organisation_id is not null then
    if new.created_by is not null or new.created_by_membership_id is null then
      raise exception 'Commercial payroll import attribution is invalid.';
    end if;
    if tg_op = 'UPDATE' and new.created_by_membership_id is distinct from old.created_by_membership_id then
      raise exception 'Payroll review attribution cannot be changed.';
    end if;
    if tg_table_name = 'payroll_import_review_rows' then
      if new.updated_by is not null or new.updated_by_membership_id is null then
        raise exception 'Commercial payroll import attribution is invalid.';
      end if;
    end if;
    return new;
  end if;

  current_account := public.current_staff_account();
  if current_account is null or current_account.role <> 'manager' then
    raise exception 'Manager access is required.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := current_account.id;
  elsif new.created_by <> old.created_by then
    raise exception 'Payroll review attribution cannot be changed.';
  end if;
  if tg_table_name = 'payroll_import_review_rows' then
    new.updated_by := current_account.id;
  end if;
  return new;
end;
$$;

create or replace function private.payroll_import_actor(target_membership_id uuid)
returns table (organisation_id uuid, membership_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.organisation_id, membership.id
  from public.organisation_memberships membership
  where auth.uid() is not null
    and membership.id = target_membership_id
    and membership.auth_user_id = auth.uid()
    and membership.status = 'active'
    and exists (
      select 1
      from public.membership_role_assignments assignment
      join private.role_permissions permission
        on permission.role = assignment.role
       and permission.permission = 'payroll.prepare'
      where assignment.organisation_id = membership.organisation_id
        and assignment.membership_id = membership.id
        and assignment.scope_type = 'organisation'
        and assignment.site_id is null
        and assignment.revoked_at is null
    )
  limit 1
$$;

create or replace function public.preview_commercial_payroll_import_batch(
  target_membership_id uuid,
  target_site_id uuid,
  target_operation_id uuid,
  target_source_filename text,
  target_proposed_effective_date date,
  target_global_effective_date_confirmed boolean,
  input_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_context record;
  input_row jsonb;
  normalised_rows jsonb := '[]'::jsonb;
  canonical_rows jsonb;
  command_request_digest text;
  created_batch public.payroll_import_batches%rowtype;
  existing_batch public.payroll_import_batches%rowtype;
  source_row_index integer;
  selected_staff_id text;
  suggested_staff_id text;
  row_resolution text;
  row_pay_type text;
  row_hours_basis text;
  row_effective_from date;
  batch_ready boolean;
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'AAL2 is required';
  end if;
  select * into command_context from private.payroll_import_actor(target_membership_id);
  if not found then
    raise exception 'Payroll import is not authorised';
  end if;
  if target_operation_id is null
     or length(btrim(coalesce(target_source_filename, ''))) not between 1 and 255
     or target_proposed_effective_date is null
     or jsonb_typeof(input_rows) <> 'array'
     or jsonb_array_length(input_rows) = 0 then
    raise exception 'Payroll import request is invalid';
  end if;
  if target_site_id is not null and not exists (
    select 1 from public.organisation_sites site
    where site.organisation_id = command_context.organisation_id and site.id = target_site_id
  ) then
    raise exception 'Payroll import site does not belong to the organisation';
  end if;

  for input_row in select value from jsonb_array_elements(input_rows)
  loop
    if coalesce(input_row ->> 'sourceRowIndex', '') !~ '^[1-9][0-9]*$'
       or length(btrim(coalesce(input_row ->> 'sourceName', ''))) not between 1 and 255 then
      raise exception 'Payroll import row is invalid';
    end if;
    source_row_index := (input_row ->> 'sourceRowIndex')::integer;
    if exists (
      select 1 from jsonb_array_elements(normalised_rows) prior
      where (prior ->> 'sourceRowIndex')::integer = source_row_index
    ) then
      raise exception 'Payroll import row index is duplicated';
    end if;
    selected_staff_id := nullif(btrim(input_row ->> 'selectedStaffId'), '');
    suggested_staff_id := nullif(btrim(input_row ->> 'suggestedStaffId'), '');
    if suggested_staff_id is not null and not exists (
      select 1 from public.staff_profiles profile
      where profile.organisation_id = command_context.organisation_id and profile.id = suggested_staff_id
    ) then
      raise exception 'Suggested staff does not belong to the payroll import organisation';
    end if;
    if selected_staff_id is not null and not exists (
      select 1 from public.staff_profiles profile
      where profile.organisation_id = command_context.organisation_id and profile.id = selected_staff_id
    ) then
      raise exception 'Selected staff does not belong to the payroll import organisation';
    end if;
    row_resolution := coalesce(input_row ->> 'resolution', 'unresolved');
    row_pay_type := nullif(input_row ->> 'payType', '');
    row_hours_basis := coalesce(nullif(input_row ->> 'hoursBasis', ''), 'contracted');
    if row_resolution not in ('unresolved', 'current_staff', 'former_staff', 'external', 'excluded')
       or (row_pay_type is not null and row_pay_type not in ('hourly', 'salaried'))
       or row_hours_basis not in ('contracted', 'variable_hours', 'casual', 'zero_hours', 'salaried_untracked') then
      raise exception 'Payroll import row is invalid';
    end if;
    begin
      row_effective_from := nullif(input_row ->> 'effectiveFrom', '')::date;
    exception when others then
      raise exception 'Payroll import row has an invalid effective date';
    end;
    normalised_rows := normalised_rows || jsonb_build_array(jsonb_build_object(
      'sourceRowIndex', source_row_index,
      'sourceName', btrim(input_row ->> 'sourceName'),
      'suggestedStaffId', suggested_staff_id,
      'selectedStaffId', selected_staff_id,
      'matchConfidence', case when input_row ->> 'matchConfidence' in ('none','low','medium','high')
        then input_row ->> 'matchConfidence' else 'none' end,
      'resolution', row_resolution,
      'payType', row_pay_type,
      'hourlyRate', input_row -> 'hourlyRate',
      'annualSalary', input_row -> 'annualSalary',
      'monthlySalary', input_row -> 'monthlySalary',
      'contractedWeeklyHours', input_row -> 'contractedWeeklyHours',
      'hoursBasis', row_hours_basis,
      'effectiveFrom', row_effective_from,
      'managerNotes', nullif(btrim(input_row ->> 'managerNotes'), ''),
      'sourceWarnings', case when jsonb_typeof(input_row -> 'sourceWarnings') = 'array'
        then input_row -> 'sourceWarnings' else '[]'::jsonb end,
      'duplicateMappingConfirmed', coalesce((input_row ->> 'duplicateMappingConfirmed')::boolean, false)
    ));
  end loop;
  select jsonb_agg(value order by (value ->> 'sourceRowIndex')::integer)
    into canonical_rows from jsonb_array_elements(normalised_rows);
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'preview_payroll_import',
    'siteId', target_site_id,
    'sourceFilename', btrim(target_source_filename),
    'proposedEffectiveDate', target_proposed_effective_date,
    'globalEffectiveDateConfirmed', coalesce(target_global_effective_date_confirmed, false),
    'rows', canonical_rows
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-import-preview:' || command_context.organisation_id::text || ':' || target_operation_id::text, 0
  ));
  select * into existing_batch from public.payroll_import_batches batch
  where batch.organisation_id = command_context.organisation_id
    and batch.preview_operation_id = target_operation_id;
  if found then
    if existing_batch.preview_request_digest is distinct from command_request_digest then
      raise exception 'Payroll import operation conflict';
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', case when existing_batch.status in ('ready', 'imported') then 'import_preview_ready' else 'import_preview_requires_review' end,
      'reused', true,
      'organisationId', existing_batch.organisation_id,
      'batchId', existing_batch.id
    );
  end if;

  insert into public.payroll_import_batches (
    organisation_id, site_id, source_filename, source_kind, status,
    proposed_effective_date, global_effective_date_confirmed,
    created_by, created_by_membership_id, preview_operation_id, preview_request_digest
  ) values (
    command_context.organisation_id, target_site_id, btrim(target_source_filename), 'workbook', 'draft',
    target_proposed_effective_date, coalesce(target_global_effective_date_confirmed, false),
    null, command_context.membership_id, target_operation_id, command_request_digest
  ) returning * into created_batch;

  for input_row in select value from jsonb_array_elements(canonical_rows)
  loop
    insert into public.payroll_import_review_rows (
      organisation_id, batch_id, site_id, source_row_index, source_name,
      suggested_staff_id, selected_staff_id, match_confidence, resolution,
      pay_type, hourly_rate, annual_salary, monthly_salary, contracted_weekly_hours,
      hours_basis, effective_from, manager_notes, source_warnings,
      duplicate_mapping_confirmed, created_by, updated_by,
      created_by_membership_id, updated_by_membership_id
    ) values (
      command_context.organisation_id, created_batch.id, target_site_id,
      (input_row ->> 'sourceRowIndex')::integer, input_row ->> 'sourceName',
      nullif(input_row ->> 'suggestedStaffId', ''), nullif(input_row ->> 'selectedStaffId', ''),
      input_row ->> 'matchConfidence', input_row ->> 'resolution',
      nullif(input_row ->> 'payType', '')::public.payroll_pay_type,
      nullif(input_row ->> 'hourlyRate', '')::numeric,
      nullif(input_row ->> 'annualSalary', '')::numeric,
      nullif(input_row ->> 'monthlySalary', '')::numeric,
      nullif(input_row ->> 'contractedWeeklyHours', '')::numeric,
      input_row ->> 'hoursBasis', nullif(input_row ->> 'effectiveFrom', '')::date,
      nullif(input_row ->> 'managerNotes', ''),
      array(select jsonb_array_elements_text(input_row -> 'sourceWarnings')),
      coalesce((input_row ->> 'duplicateMappingConfirmed')::boolean, false),
      null, null, command_context.membership_id, command_context.membership_id
    );
  end loop;

  select not exists (
    select 1 from public.payroll_import_review_rows review_row
    where review_row.organisation_id = created_batch.organisation_id
      and review_row.batch_id = created_batch.id
      and (
        review_row.resolution = 'unresolved'
        or (review_row.resolution in ('current_staff', 'former_staff') and (
          review_row.selected_staff_id is null or review_row.effective_from is null or review_row.pay_type is null
          or (review_row.pay_type = 'hourly' and (
            review_row.hourly_rate is null or review_row.hourly_rate <= 0
            or review_row.annual_salary is not null or review_row.monthly_salary is not null
          ))
          or (review_row.pay_type = 'salaried' and not (
            review_row.hourly_rate is null and (
              (review_row.annual_salary is not null and review_row.annual_salary > 0 and review_row.monthly_salary is null)
              or (review_row.monthly_salary is not null and review_row.monthly_salary > 0 and review_row.annual_salary is null)
            )
          ))
          or (review_row.hours_basis = 'contracted'
            and (review_row.contracted_weekly_hours is null or review_row.contracted_weekly_hours <= 0))
        ))
      )
  ) and not exists (
    select 1 from public.payroll_import_review_rows review_row
    join public.staff_pay_arrangements arrangement
      on arrangement.organisation_id = review_row.organisation_id
     and arrangement.staff_id = review_row.selected_staff_id
     and arrangement.is_active
     and daterange(arrangement.effective_from, coalesce(arrangement.effective_to + 1, 'infinity'::date), '[)')
       && daterange(review_row.effective_from, 'infinity'::date, '[)')
    where review_row.organisation_id = created_batch.organisation_id
      and review_row.batch_id = created_batch.id
      and review_row.resolution in ('current_staff', 'former_staff')
  ) and not exists (
    select 1
    from public.payroll_import_review_rows review_row
    join (
      select duplicate.selected_staff_id
      from public.payroll_import_review_rows duplicate
      where duplicate.organisation_id = created_batch.organisation_id
        and duplicate.batch_id = created_batch.id
        and duplicate.resolution in ('current_staff', 'former_staff')
      group by duplicate.selected_staff_id having count(*) > 1
    ) duplicated on duplicated.selected_staff_id = review_row.selected_staff_id
    where review_row.organisation_id = created_batch.organisation_id
      and review_row.batch_id = created_batch.id
      and not review_row.duplicate_mapping_confirmed
  ) and (
    coalesce(target_global_effective_date_confirmed, false)
    or not exists (
      select 1 from public.payroll_import_review_rows review_row
      where review_row.organisation_id = created_batch.organisation_id
        and review_row.batch_id = created_batch.id
        and review_row.resolution in ('current_staff', 'former_staff')
        and review_row.effective_from = target_proposed_effective_date
    )
  ) into batch_ready;

  if batch_ready then
    update only public.payroll_import_batches batch
    set status = 'ready', approved_by_membership_id = command_context.membership_id,
        approved_at = now(), updated_at = now()
    where batch.organisation_id = created_batch.organisation_id and batch.id = created_batch.id
    returning * into created_batch;
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', case when batch_ready then 'import_preview_ready' else 'import_preview_requires_review' end,
    'reused', false,
    'organisationId', created_batch.organisation_id,
    'batchId', created_batch.id
  );
end;
$$;

create or replace function public.save_commercial_payroll_import_review_row(
  target_batch_id uuid,
  target_row_id uuid,
  target_resolution text,
  target_selected_staff_id text,
  target_pay_type text,
  target_hourly_rate numeric,
  target_annual_salary numeric,
  target_monthly_salary numeric,
  target_contracted_weekly_hours numeric,
  target_hours_basis text,
  target_effective_from date,
  target_manager_notes text,
  target_duplicate_mapping_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.payroll_import_batches%rowtype;
  target_row public.payroll_import_review_rows%rowtype;
  updated_row public.payroll_import_review_rows%rowtype;
  command_membership_id uuid;
begin
  select * into target_batch from public.payroll_import_batches batch
  where batch.id = target_batch_id for update;
  if not found or target_batch.organisation_id is null then
    raise exception 'Commercial payroll import preview does not exist';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'AAL2 is required';
  end if;
  command_membership_id := private.payroll_command_actor(target_batch.organisation_id, 'payroll.prepare');
  if command_membership_id is null then
    raise exception 'Payroll import is not authorised';
  end if;
  if target_batch.status <> 'draft' then
    raise exception 'Only draft commercial payroll previews can be corrected';
  end if;
  select * into target_row from public.payroll_import_review_rows review_row
  where review_row.organisation_id = target_batch.organisation_id
    and review_row.batch_id = target_batch.id and review_row.id = target_row_id
  for update;
  if not found then
    raise exception 'Commercial payroll import review row does not exist';
  end if;
  if target_resolution not in ('unresolved', 'current_staff', 'former_staff', 'external', 'excluded')
     or (target_pay_type is not null and target_pay_type not in ('hourly', 'salaried'))
     or coalesce(target_hours_basis, 'contracted') not in (
       'contracted', 'variable_hours', 'casual', 'zero_hours', 'salaried_untracked'
     )
     or target_hourly_rate < 0 or target_annual_salary < 0 or target_monthly_salary < 0
     or target_contracted_weekly_hours < 0 or target_contracted_weekly_hours > 80 then
    raise exception 'Commercial payroll import review values are invalid';
  end if;
  if nullif(btrim(coalesce(target_selected_staff_id, '')), '') is not null and not exists (
    select 1 from public.staff_profiles profile
    where profile.organisation_id = target_batch.organisation_id
      and profile.id = btrim(target_selected_staff_id)
  ) then
    raise exception 'Selected staff does not belong to the payroll import organisation';
  end if;

  select * into updated_row from jsonb_populate_record(target_row, jsonb_build_object(
    'resolution', target_resolution,
    'selected_staff_id', nullif(btrim(coalesce(target_selected_staff_id, '')), ''),
    'pay_type', nullif(target_pay_type, ''),
    'hourly_rate', target_hourly_rate,
    'annual_salary', target_annual_salary,
    'monthly_salary', target_monthly_salary,
    'contracted_weekly_hours', target_contracted_weekly_hours,
    'hours_basis', coalesce(nullif(target_hours_basis, ''), 'contracted'),
    'effective_from', target_effective_from,
    'manager_notes', nullif(btrim(coalesce(target_manager_notes, '')), ''),
    'duplicate_mapping_confirmed', coalesce(target_duplicate_mapping_confirmed, false),
    'updated_by', null,
    'updated_by_membership_id', command_membership_id
  ));
  update only public.payroll_import_review_rows review_row set
    resolution = updated_row.resolution,
    selected_staff_id = updated_row.selected_staff_id,
    pay_type = updated_row.pay_type,
    hourly_rate = updated_row.hourly_rate,
    annual_salary = updated_row.annual_salary,
    monthly_salary = updated_row.monthly_salary,
    contracted_weekly_hours = updated_row.contracted_weekly_hours,
    hours_basis = updated_row.hours_basis,
    effective_from = updated_row.effective_from,
    manager_notes = updated_row.manager_notes,
    duplicate_mapping_confirmed = updated_row.duplicate_mapping_confirmed,
    updated_by = null,
    updated_by_membership_id = command_membership_id,
    updated_at = now()
  where review_row.organisation_id = target_batch.organisation_id and review_row.id = target_row.id;
  return jsonb_build_object('ok', true, 'code', 'import_review_row_saved',
    'organisationId', target_batch.organisation_id, 'batchId', target_batch.id, 'rowId', target_row.id);
end;
$$;

create or replace function public.update_commercial_payroll_import_batch_date(
  target_batch_id uuid,
  target_proposed_effective_date date,
  target_global_effective_date_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.payroll_import_batches%rowtype;
  command_membership_id uuid;
begin
  select * into target_batch from public.payroll_import_batches batch
  where batch.id = target_batch_id for update;
  if not found or target_batch.organisation_id is null then
    raise exception 'Commercial payroll import preview does not exist';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'AAL2 is required';
  end if;
  command_membership_id := private.payroll_command_actor(target_batch.organisation_id, 'payroll.prepare');
  if command_membership_id is null then
    raise exception 'Payroll import is not authorised';
  end if;
  if target_batch.status <> 'draft' or target_proposed_effective_date is null then
    raise exception 'Only draft commercial payroll preview dates can be corrected';
  end if;
  update only public.payroll_import_batches batch set
    proposed_effective_date = target_proposed_effective_date,
    global_effective_date_confirmed = coalesce(target_global_effective_date_confirmed, false),
    updated_at = now()
  where batch.organisation_id = target_batch.organisation_id and batch.id = target_batch.id;
  return jsonb_build_object('ok', true, 'code', 'import_preview_date_saved',
    'organisationId', target_batch.organisation_id, 'batchId', target_batch.id);
end;
$$;

create or replace function public.mark_commercial_payroll_import_batch_ready(
  target_batch_id uuid,
  target_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch public.payroll_import_batches%rowtype;
  command_membership_id uuid;
  canonical_rows jsonb;
  command_request_digest text;
begin
  select * into target_batch from public.payroll_import_batches batch
  where batch.id = target_batch_id for update;
  if not found or target_batch.organisation_id is null then
    raise exception 'Commercial payroll import preview does not exist';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'AAL2 is required';
  end if;
  command_membership_id := private.payroll_command_actor(target_batch.organisation_id, 'payroll.prepare');
  if command_membership_id is null then
    raise exception 'Payroll import is not authorised';
  end if;
  if target_operation_id is null then
    raise exception 'Payroll import ready operation is required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceRowIndex', review_row.source_row_index,
    'sourceName', btrim(review_row.source_name),
    'suggestedStaffId', review_row.suggested_staff_id,
    'selectedStaffId', review_row.selected_staff_id,
    'matchConfidence', review_row.match_confidence,
    'resolution', review_row.resolution,
    'payType', review_row.pay_type,
    'hourlyRate', review_row.hourly_rate,
    'annualSalary', review_row.annual_salary,
    'monthlySalary', review_row.monthly_salary,
    'contractedWeeklyHours', review_row.contracted_weekly_hours,
    'hoursBasis', review_row.hours_basis,
    'effectiveFrom', review_row.effective_from,
    'managerNotes', review_row.manager_notes,
    'sourceWarnings', review_row.source_warnings,
    'duplicateMappingConfirmed', review_row.duplicate_mapping_confirmed
  ) order by review_row.source_row_index), '[]'::jsonb) into canonical_rows
  from public.payroll_import_review_rows review_row
  where review_row.organisation_id = target_batch.organisation_id and review_row.batch_id = target_batch.id;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'mark_payroll_import_ready', 'batchId', target_batch.id,
    'siteId', target_batch.site_id, 'sourceFilename', btrim(target_batch.source_filename),
    'proposedEffectiveDate', target_batch.proposed_effective_date,
    'globalEffectiveDateConfirmed', target_batch.global_effective_date_confirmed,
    'rows', canonical_rows
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'payroll-import-ready:' || target_batch.organisation_id::text || ':' || target_operation_id::text, 0
  ));
  if target_batch.ready_operation_id is not null then
    if target_batch.ready_operation_id is distinct from target_operation_id
       or target_batch.ready_request_digest is distinct from command_request_digest then
      raise exception 'Payroll import ready operation conflict';
    end if;
    return jsonb_build_object('ok', true, 'code', 'import_preview_ready', 'reused', true,
      'organisationId', target_batch.organisation_id, 'batchId', target_batch.id);
  end if;
  if target_batch.status <> 'draft' or jsonb_array_length(canonical_rows) = 0 then
    raise exception 'Payroll import preview is not a draft with rows';
  end if;
  if exists (
    select 1 from public.payroll_import_review_rows review_row
    where review_row.organisation_id = target_batch.organisation_id
      and review_row.batch_id = target_batch.id
      and (
        review_row.resolution = 'unresolved'
        or (review_row.resolution in ('current_staff', 'former_staff') and (
          review_row.selected_staff_id is null or review_row.effective_from is null or review_row.pay_type is null
          or not exists (select 1 from public.staff_profiles profile
            where profile.organisation_id = target_batch.organisation_id and profile.id = review_row.selected_staff_id)
          or (review_row.pay_type = 'hourly' and (
            review_row.hourly_rate is null or review_row.hourly_rate <= 0
            or review_row.annual_salary is not null or review_row.monthly_salary is not null
          ))
          or (review_row.pay_type = 'salaried' and not (
            review_row.hourly_rate is null and (
              (review_row.annual_salary is not null and review_row.annual_salary > 0 and review_row.monthly_salary is null)
              or (review_row.monthly_salary is not null and review_row.monthly_salary > 0 and review_row.annual_salary is null)
            )
          ))
          or (review_row.hours_basis = 'contracted'
            and (review_row.contracted_weekly_hours is null or review_row.contracted_weekly_hours <= 0))
        ))
      )
  ) then
    raise exception 'Payroll import contains an invalid row';
  end if;
  if exists (
    select 1 from public.payroll_import_review_rows review_row
    join (
      select duplicate.selected_staff_id
      from public.payroll_import_review_rows duplicate
      where duplicate.organisation_id = target_batch.organisation_id
        and duplicate.batch_id = target_batch.id
        and duplicate.resolution in ('current_staff', 'former_staff')
      group by duplicate.selected_staff_id having count(*) > 1
    ) duplicated on duplicated.selected_staff_id = review_row.selected_staff_id
    where review_row.organisation_id = target_batch.organisation_id
      and review_row.batch_id = target_batch.id and not review_row.duplicate_mapping_confirmed
  ) then
    raise exception 'Payroll import contains unconfirmed duplicate staff mappings';
  end if;
  if not target_batch.global_effective_date_confirmed and exists (
    select 1 from public.payroll_import_review_rows review_row
    where review_row.organisation_id = target_batch.organisation_id
      and review_row.batch_id = target_batch.id
      and review_row.resolution in ('current_staff', 'former_staff')
      and review_row.effective_from = target_batch.proposed_effective_date
  ) then
    raise exception 'Payroll import shared effective date is not confirmed';
  end if;
  if exists (
    select 1 from public.payroll_import_review_rows review_row
    join public.staff_pay_arrangements arrangement
      on arrangement.organisation_id = target_batch.organisation_id
     and arrangement.staff_id = review_row.selected_staff_id and arrangement.is_active
     and daterange(arrangement.effective_from, coalesce(arrangement.effective_to + 1, 'infinity'::date), '[)')
       && daterange(review_row.effective_from, 'infinity'::date, '[)')
    where review_row.organisation_id = target_batch.organisation_id
      and review_row.batch_id = target_batch.id
      and review_row.resolution in ('current_staff', 'former_staff')
  ) then
    raise exception 'Payroll import arrangement overlaps existing evidence';
  end if;
  update only public.payroll_import_batches batch set
    status = 'ready', approved_by_membership_id = command_membership_id, approved_at = now(),
    ready_operation_id = target_operation_id, ready_request_digest = command_request_digest,
    updated_at = now()
  where batch.organisation_id = target_batch.organisation_id and batch.id = target_batch.id;
  return jsonb_build_object('ok', true, 'code', 'import_preview_ready', 'reused', false,
    'organisationId', target_batch.organisation_id, 'batchId', target_batch.id);
end;
$$;

create or replace function public.commit_commercial_payroll_import_batch(
  target_batch_id uuid,
  target_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command_membership_id uuid;
  target_batch public.payroll_import_batches%rowtype;
  command_request_digest text;
  imported_count integer;
begin
  select * into target_batch from public.payroll_import_batches batch
  where batch.id = target_batch_id for update;
  if not found then
    raise exception 'Payroll import preview batch does not exist';
  end if;
  if target_batch.organisation_id is null then
    raise exception 'Commercial payroll import cannot use the legacy unowned path';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'AAL2 is required';
  end if;
  command_membership_id := private.payroll_command_actor(target_batch.organisation_id, 'payroll.prepare');
  if command_membership_id is null then
    raise exception 'Payroll import is not authorised';
  end if;
  if target_operation_id is null then
    raise exception 'Payroll import commit operation is required';
  end if;
  command_request_digest := private.payroll_request_digest(jsonb_build_object(
    'command', 'commit_payroll_import',
    'batchId', target_batch.id,
    'previewRequestDigest', coalesce(target_batch.ready_request_digest, target_batch.preview_request_digest)
  ));
  if target_batch.commit_operation_id is not null then
    if target_batch.commit_operation_id is distinct from target_operation_id
       or target_batch.commit_request_digest is distinct from command_request_digest then
      raise exception 'Payroll import batch is already imported with another operation';
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'import_committed', 'reused', true,
      'organisationId', target_batch.organisation_id, 'batchId', target_batch.id,
      'importedCount', (select count(*)::integer from public.staff_pay_arrangements arrangement
        where arrangement.organisation_id = target_batch.organisation_id
          and arrangement.import_review_row_id in (
            select review_row.id from public.payroll_import_review_rows review_row
            where review_row.organisation_id = target_batch.organisation_id
              and review_row.batch_id = target_batch.id
          ))
    );
  end if;
  if target_batch.status <> 'ready' or target_batch.preview_request_digest is null then
    raise exception 'Payroll import preview is not ready';
  end if;
  if exists (
    select 1 from public.payroll_import_batches other_batch
    where other_batch.organisation_id = target_batch.organisation_id
      and other_batch.commit_operation_id = target_operation_id
      and other_batch.id <> target_batch.id
  ) then
    raise exception 'Payroll import operation conflict';
  end if;
  if not exists (
    select 1 from public.payroll_import_review_rows review_row
    where review_row.organisation_id = target_batch.organisation_id and review_row.batch_id = target_batch.id
  ) or exists (
    select 1 from public.payroll_import_review_rows review_row
    where review_row.batch_id = target_batch.id and (
      review_row.organisation_id is distinct from target_batch.organisation_id
      or review_row.site_id is distinct from target_batch.site_id
      or review_row.resolution = 'unresolved'
      or (review_row.resolution in ('current_staff', 'former_staff') and (
        review_row.selected_staff_id is null or review_row.effective_from is null or review_row.pay_type is null
        or not exists (select 1 from public.staff_profiles profile
          where profile.organisation_id = target_batch.organisation_id and profile.id = review_row.selected_staff_id)
        or (review_row.pay_type = 'hourly' and (
          review_row.hourly_rate is null or review_row.hourly_rate <= 0
          or review_row.annual_salary is not null or review_row.monthly_salary is not null
        ))
        or (review_row.pay_type = 'salaried' and not (
          review_row.hourly_rate is null and (
            (review_row.annual_salary is not null and review_row.annual_salary > 0 and review_row.monthly_salary is null)
            or (review_row.monthly_salary is not null and review_row.monthly_salary > 0 and review_row.annual_salary is null)
          )
        ))
        or (review_row.hours_basis = 'contracted'
          and (review_row.contracted_weekly_hours is null or review_row.contracted_weekly_hours <= 0))
      ))
    )
  ) then
    raise exception 'Payroll import contains an invalid row';
  end if;
  if exists (
    select 1
    from public.payroll_import_review_rows review_row
    join (
      select duplicate.selected_staff_id
      from public.payroll_import_review_rows duplicate
      where duplicate.organisation_id = target_batch.organisation_id
        and duplicate.batch_id = target_batch.id
        and duplicate.resolution in ('current_staff', 'former_staff')
      group by duplicate.selected_staff_id having count(*) > 1
    ) duplicated on duplicated.selected_staff_id = review_row.selected_staff_id
    where review_row.organisation_id = target_batch.organisation_id
      and review_row.batch_id = target_batch.id
      and not review_row.duplicate_mapping_confirmed
  ) then
    raise exception 'Payroll import contains unconfirmed duplicate staff mappings';
  end if;
  if not target_batch.global_effective_date_confirmed and exists (
    select 1 from public.payroll_import_review_rows review_row
    where review_row.organisation_id = target_batch.organisation_id
      and review_row.batch_id = target_batch.id
      and review_row.resolution in ('current_staff', 'former_staff')
      and review_row.effective_from = target_batch.proposed_effective_date
  ) then
    raise exception 'Payroll import shared effective date is not confirmed';
  end if;
  if exists (
    select 1 from public.payroll_import_review_rows review_row
    join public.staff_pay_arrangements arrangement
      on arrangement.organisation_id = target_batch.organisation_id
     and arrangement.staff_id = review_row.selected_staff_id
     and arrangement.is_active
     and daterange(arrangement.effective_from, coalesce(arrangement.effective_to + 1, 'infinity'::date), '[)')
       && daterange(review_row.effective_from, 'infinity'::date, '[)')
    where review_row.organisation_id = target_batch.organisation_id
      and review_row.batch_id = target_batch.id
      and review_row.resolution in ('current_staff', 'former_staff')
  ) then
    raise exception 'Payroll import arrangement overlaps existing evidence';
  end if;

  insert into public.staff_pay_arrangements (
    organisation_id, site_id, staff_id, pay_type, hourly_rate, annual_salary,
    monthly_salary, contracted_weekly_hours, hours_basis, standard_daily_hours,
    overtime_multiplier, effective_from, effective_to, is_active, manager_notes,
    import_review_row_id, created_by, updated_by,
    created_by_membership_id, updated_by_membership_id
  )
  select target_batch.organisation_id, target_batch.site_id, review_row.selected_staff_id,
    review_row.pay_type, review_row.hourly_rate, review_row.annual_salary,
    review_row.monthly_salary, review_row.contracted_weekly_hours, review_row.hours_basis,
    null, 1.00, review_row.effective_from, null, true, review_row.manager_notes,
    review_row.id, null, null, command_membership_id, command_membership_id
  from public.payroll_import_review_rows review_row
  where review_row.organisation_id = target_batch.organisation_id
    and review_row.batch_id = target_batch.id
    and review_row.resolution in ('current_staff', 'former_staff')
  order by review_row.source_row_index, review_row.id;
  get diagnostics imported_count = row_count;

  update only public.payroll_import_batches batch
  set status = 'imported', imported_by_membership_id = command_membership_id,
      imported_at = now(), commit_operation_id = target_operation_id,
      commit_request_digest = command_request_digest, updated_at = now()
  where batch.organisation_id = target_batch.organisation_id and batch.id = target_batch.id;

  return jsonb_build_object(
    'ok', true, 'code', 'import_committed', 'reused', false,
    'organisationId', target_batch.organisation_id, 'batchId', target_batch.id,
    'importedCount', imported_count
  );
end;
$$;

create or replace function public.apply_legacy_payroll_import_batch(target_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  imported_count integer;
  current_account public.staff_accounts;
begin
  if auth.uid() is null or exists (
    select 1 from public.organisation_memberships membership
    where membership.auth_user_id = auth.uid()
  ) then
    raise exception 'A legacy-only actor is required for an unowned Jan payroll import';
  end if;
  current_account := public.current_staff_account();
  if current_account is null or current_account.role <> 'manager' then
    raise exception 'A legacy-only manager actor is required for an unowned Jan payroll import';
  end if;
  if exists (
    select 1 from public.payroll_import_batches batch
    where batch.id = target_batch_id and batch.organisation_id is not null
  ) then
    raise exception 'Commercial payroll imports cannot use the legacy unowned path';
  end if;
  execute 'select public.apply_payroll_import_batch($1)' into imported_count using target_batch_id;
  return imported_count;
end;
$$;

revoke all on function private.payroll_import_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.protect_payroll_import_attribution() from public, anon, authenticated, service_role;
revoke all on function public.preview_commercial_payroll_import_batch(uuid, uuid, uuid, text, date, boolean, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_commercial_payroll_import_batch(uuid, uuid, uuid, text, date, boolean, jsonb)
  to authenticated;
revoke all on function public.save_commercial_payroll_import_review_row(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, date, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_commercial_payroll_import_review_row(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text, date, text, boolean)
  to authenticated;
revoke all on function public.update_commercial_payroll_import_batch_date(uuid, date, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.update_commercial_payroll_import_batch_date(uuid, date, boolean) to authenticated;
revoke all on function public.mark_commercial_payroll_import_batch_ready(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_commercial_payroll_import_batch_ready(uuid, uuid) to authenticated;
revoke all on function public.commit_commercial_payroll_import_batch(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_commercial_payroll_import_batch(uuid, uuid) to authenticated;
do $$
begin
  if to_regprocedure('public.apply_payroll_import_batch(uuid)') is not null then
    revoke all on function public.apply_payroll_import_batch(uuid) from authenticated;
  end if;
end
$$;
revoke all on function public.apply_legacy_payroll_import_batch(uuid) from public, anon, authenticated, service_role;
grant execute on function public.apply_legacy_payroll_import_batch(uuid) to authenticated;
