create extension if not exists btree_gist with schema extensions;

create type public.payroll_pay_type as enum ('hourly', 'salaried');

create table public.staff_pay_arrangements (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  pay_type public.payroll_pay_type not null,
  hourly_rate numeric(10,2),
  annual_salary numeric(12,2),
  monthly_salary numeric(12,2),
  contracted_weekly_hours numeric(5,2) not null check (contracted_weekly_hours >= 0 and contracted_weekly_hours <= 80),
  standard_daily_hours numeric(5,2) check (standard_daily_hours is null or (standard_daily_hours > 0 and standard_daily_hours <= 24)),
  overtime_multiplier numeric(5,2) not null default 1.00 check (overtime_multiplier >= 1 and overtime_multiplier <= 5),
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  manager_notes text,
  created_by uuid not null references public.staff_accounts(id) on delete restrict,
  updated_by uuid not null references public.staff_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_pay_arrangement_dates check (effective_to is null or effective_to >= effective_from),
  constraint staff_pay_arrangement_values check (
    (pay_type = 'hourly' and hourly_rate is not null and hourly_rate > 0 and annual_salary is null and monthly_salary is null)
    or
    (pay_type = 'salaried' and hourly_rate is null and (annual_salary is not null or monthly_salary is not null)
      and coalesce(annual_salary, 0) >= 0 and coalesce(monthly_salary, 0) >= 0)
  )
);

alter table public.staff_pay_arrangements
  add constraint staff_pay_arrangements_no_overlap
  exclude using gist (
    staff_id with =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
  )
  where (is_active);

create index staff_pay_arrangements_staff_dates_idx
on public.staff_pay_arrangements (staff_id, effective_from desc, effective_to);

create trigger staff_pay_arrangements_updated_at
before update on public.staff_pay_arrangements
for each row execute function public.set_updated_at();

alter table public.staff_pay_arrangements enable row level security;

create policy "Managers can manage pay arrangements"
on public.staff_pay_arrangements for all
to authenticated
using (public.current_staff_role() = 'manager')
with check (
  public.current_staff_role() = 'manager'
  and created_by is not null
  and updated_by = (public.current_staff_account()).id
);

revoke all on public.staff_pay_arrangements from anon;
revoke all on public.staff_pay_arrangements from authenticated;
grant select, insert, update on public.staff_pay_arrangements to authenticated;
