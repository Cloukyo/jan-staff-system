create type public.payroll_hours_basis as enum (
  'contracted',
  'variable_hours',
  'casual',
  'zero_hours',
  'salaried_untracked'
);

alter table public.staff_pay_arrangements
  alter column contracted_weekly_hours drop not null,
  add column hours_basis public.payroll_hours_basis not null default 'contracted',
  add column import_review_row_id uuid;

alter table public.staff_pay_arrangements
  drop constraint staff_pay_arrangements_contracted_weekly_hours_check,
  add constraint staff_pay_arrangements_hours_basis_check check (
    (
      hours_basis = 'contracted'
      and contracted_weekly_hours is not null
      and contracted_weekly_hours > 0
      and contracted_weekly_hours <= 80
    )
    or
    (
      hours_basis <> 'contracted'
      and (contracted_weekly_hours is null or (contracted_weekly_hours >= 0 and contracted_weekly_hours <= 80))
    )
  );

create type public.payroll_import_batch_status as enum (
  'draft',
  'ready',
  'imported',
  'cancelled'
);

create type public.payroll_import_resolution as enum (
  'unresolved',
  'current_staff',
  'former_staff',
  'external',
  'excluded'
);

create type public.payroll_match_confidence as enum (
  'none',
  'low',
  'medium',
  'high'
);

create table public.payroll_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null check (length(trim(source_filename)) between 1 and 255),
  source_kind text not null default 'workbook' check (source_kind in ('workbook', 'manual')),
  status public.payroll_import_batch_status not null default 'draft',
  proposed_effective_date date,
  global_effective_date_confirmed boolean not null default false,
  created_by uuid not null references public.staff_accounts(id) on delete restrict,
  approved_by uuid references public.staff_accounts(id) on delete restrict,
  approved_at timestamptz,
  imported_by uuid references public.staff_accounts(id) on delete restrict,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_import_batch_approval check (
    (status = 'draft' and approved_by is null and approved_at is null and imported_by is null and imported_at is null)
    or
    (status = 'ready' and approved_by is not null and approved_at is not null and imported_by is null and imported_at is null)
    or
    (status = 'imported' and approved_by is not null and approved_at is not null and imported_by is not null and imported_at is not null)
    or
    (status = 'cancelled' and imported_by is null and imported_at is null)
  )
);

create table public.payroll_import_review_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payroll_import_batches(id) on delete cascade,
  source_row_index integer not null check (source_row_index > 0),
  source_name text not null check (length(trim(source_name)) between 1 and 255),
  suggested_staff_id text references public.staff_profiles(id) on delete restrict,
  selected_staff_id text references public.staff_profiles(id) on delete restrict,
  match_confidence public.payroll_match_confidence not null default 'none',
  resolution public.payroll_import_resolution not null default 'unresolved',
  pay_type public.payroll_pay_type,
  hourly_rate numeric(10,2),
  annual_salary numeric(12,2),
  monthly_salary numeric(12,2),
  contracted_weekly_hours numeric(5,2),
  hours_basis public.payroll_hours_basis not null default 'contracted',
  effective_from date,
  manager_notes text,
  source_warnings text[] not null default '{}',
  duplicate_mapping_confirmed boolean not null default false,
  created_by uuid not null references public.staff_accounts(id) on delete restrict,
  updated_by uuid not null references public.staff_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_row_index)
);

alter table public.staff_pay_arrangements
  add constraint staff_pay_arrangements_import_review_row_fk
  foreign key (import_review_row_id)
  references public.payroll_import_review_rows(id)
  on delete restrict;

create index payroll_import_batches_status_created_idx
on public.payroll_import_batches (status, created_at desc);

create index payroll_import_review_rows_batch_resolution_idx
on public.payroll_import_review_rows (batch_id, resolution, source_row_index);

create index payroll_import_review_rows_selected_staff_idx
on public.payroll_import_review_rows (selected_staff_id)
where selected_staff_id is not null;

create trigger payroll_import_batches_updated_at
before update on public.payroll_import_batches
for each row execute function public.set_updated_at();

create trigger payroll_import_review_rows_updated_at
before update on public.payroll_import_review_rows
for each row execute function public.set_updated_at();

create or replace function public.guard_payroll_import_review_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.payroll_import_batches batch
    where batch.id = coalesce(new.batch_id, old.batch_id)
      and batch.status = 'draft'
  ) then
    raise exception 'Only draft payroll review rows can be changed.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger guard_payroll_import_review_row_changes
before insert or update or delete on public.payroll_import_review_rows
for each row execute function public.guard_payroll_import_review_row();

create or replace function public.protect_payroll_import_attribution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_account public.staff_accounts;
begin
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

create trigger protect_payroll_import_batch_attribution
before insert or update on public.payroll_import_batches
for each row execute function public.protect_payroll_import_attribution();

create trigger protect_payroll_import_row_attribution
before insert or update on public.payroll_import_review_rows
for each row execute function public.protect_payroll_import_attribution();

alter table public.payroll_import_batches enable row level security;
alter table public.payroll_import_review_rows enable row level security;

create policy "Managers can manage payroll import batches"
on public.payroll_import_batches for all to authenticated
using (public.current_staff_role() = 'manager')
with check (
  public.current_staff_role() = 'manager'
  and created_by is not null
);

create policy "Managers can manage payroll import review rows"
on public.payroll_import_review_rows for all to authenticated
using (public.current_staff_role() = 'manager')
with check (
  public.current_staff_role() = 'manager'
  and created_by is not null
  and updated_by = (public.current_staff_account()).id
);

revoke all on public.payroll_import_batches, public.payroll_import_review_rows from anon, authenticated;
grant select, insert, update, delete on public.payroll_import_batches, public.payroll_import_review_rows to authenticated;

create or replace function public.apply_payroll_import_batch(target_batch_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_account public.staff_accounts;
  target_batch public.payroll_import_batches;
  imported_count integer;
begin
  current_account := public.current_staff_account();
  if current_account is null or current_account.role <> 'manager' then
    raise exception 'Manager access is required.';
  end if;

  select *
  into target_batch
  from public.payroll_import_batches
  where id = target_batch_id
  for update;

  if target_batch is null or target_batch.status <> 'ready' then
    raise exception 'The payroll review batch is not ready for import.';
  end if;

  if exists (
    select 1
    from public.payroll_import_review_rows row
    where row.batch_id = target_batch_id
      and row.resolution = 'unresolved'
  ) then
    raise exception 'The payroll review batch contains unresolved rows.';
  end if;

  if exists (
    select 1
    from public.payroll_import_review_rows row
    where row.batch_id = target_batch_id
      and row.resolution in ('current_staff', 'former_staff')
      and (
        row.selected_staff_id is null
        or row.effective_from is null
        or row.pay_type is null
        or (row.pay_type = 'hourly' and (row.hourly_rate is null or row.hourly_rate <= 0))
        or (row.pay_type = 'salaried' and not (
          (row.annual_salary is not null and row.annual_salary > 0 and row.monthly_salary is null)
          or
          (row.monthly_salary is not null and row.monthly_salary > 0 and row.annual_salary is null)
        ))
        or (row.hours_basis = 'contracted' and (row.contracted_weekly_hours is null or row.contracted_weekly_hours <= 0))
      )
  ) then
    raise exception 'The payroll review batch contains incomplete pay arrangements.';
  end if;

  if exists (
    select 1
    from public.payroll_import_review_rows row
    where row.batch_id = target_batch_id
      and row.resolution in ('current_staff', 'former_staff')
      and row.selected_staff_id in (
        select duplicate.selected_staff_id
        from public.payroll_import_review_rows duplicate
        where duplicate.batch_id = target_batch_id
          and duplicate.resolution in ('current_staff', 'former_staff')
        group by duplicate.selected_staff_id
        having count(*) > 1
      )
      and not row.duplicate_mapping_confirmed
  ) then
    raise exception 'Duplicate staff mappings require explicit confirmation.';
  end if;

  if (
    select count(*) > 0
      and bool_and(row.effective_from = target_batch.proposed_effective_date)
    from public.payroll_import_review_rows row
    where row.batch_id = target_batch_id
      and row.resolution in ('current_staff', 'former_staff')
  ) and not target_batch.global_effective_date_confirmed then
    raise exception 'Confirm the shared effective date before import.';
  end if;

  if exists (
    select 1
    from public.payroll_import_review_rows row
    join public.staff_pay_arrangements arrangement
      on arrangement.staff_id = row.selected_staff_id
     and arrangement.is_active
     and daterange(
       arrangement.effective_from,
       coalesce(arrangement.effective_to + 1, 'infinity'::date),
       '[)'
     ) && daterange(row.effective_from, 'infinity'::date, '[)')
    where row.batch_id = target_batch_id
      and row.resolution in ('current_staff', 'former_staff')
  ) then
    raise exception 'An imported row overlaps an existing active pay arrangement.';
  end if;

  insert into public.staff_pay_arrangements (
    staff_id,
    pay_type,
    hourly_rate,
    annual_salary,
    monthly_salary,
    contracted_weekly_hours,
    hours_basis,
    standard_daily_hours,
    overtime_multiplier,
    effective_from,
    effective_to,
    is_active,
    manager_notes,
    import_review_row_id,
    created_by,
    updated_by
  )
  select
    row.selected_staff_id,
    row.pay_type,
    row.hourly_rate,
    row.annual_salary,
    row.monthly_salary,
    row.contracted_weekly_hours,
    row.hours_basis,
    null,
    1.00,
    row.effective_from,
    null,
    true,
    row.manager_notes,
    row.id,
    current_account.id,
    current_account.id
  from public.payroll_import_review_rows row
  where row.batch_id = target_batch_id
    and row.resolution in ('current_staff', 'former_staff');

  get diagnostics imported_count = row_count;

  update public.payroll_import_batches
  set
    status = 'imported',
    imported_by = current_account.id,
    imported_at = now()
  where id = target_batch_id;

  return imported_count;
end;
$$;

revoke all on function public.apply_payroll_import_batch(uuid) from public, anon;
grant execute on function public.apply_payroll_import_batch(uuid) to authenticated;
