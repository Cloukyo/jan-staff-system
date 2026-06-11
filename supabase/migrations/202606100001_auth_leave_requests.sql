create extension if not exists pgcrypto;

create type app_role as enum ('manager', 'staff');
create type leave_type as enum ('annual_leave', 'sickness', 'medical_appointment', 'unpaid_leave', 'training', 'other');
create type leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type leave_day_part as enum ('full_day', 'partial_day');

create table public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  staff_id text not null unique,
  full_name text not null,
  email text not null unique,
  role app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,
  leave_type leave_type not null,
  start_date date not null,
  end_date date not null,
  day_part leave_day_part not null default 'full_day',
  start_time time,
  end_time time,
  requested_minutes integer not null check (requested_minutes > 0),
  staff_note text,
  status leave_status not null default 'pending',
  manager_note text,
  reviewed_by uuid references public.staff_accounts(id) on delete set null,
  reviewed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_date_order check (start_date <= end_date),
  constraint partial_day_times check (
    day_part = 'full_day'
    or (start_date = end_date and start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index leave_requests_staff_status_idx on public.leave_requests (staff_id, status, start_date, end_date);
create index leave_requests_status_created_idx on public.leave_requests (status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger staff_accounts_updated_at
before update on public.staff_accounts
for each row execute function public.set_updated_at();

create trigger leave_requests_updated_at
before update on public.leave_requests
for each row execute function public.set_updated_at();

create or replace function public.current_staff_account()
returns public.staff_accounts
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.staff_accounts
  where auth_user_id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function public.current_staff_role()
returns app_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.current_staff_account();
$$;

alter table public.staff_accounts enable row level security;
alter table public.leave_requests enable row level security;

create policy "Managers can read all accounts"
on public.staff_accounts for select
to authenticated
using (public.current_staff_role() = 'manager');

create policy "Staff can read their own account"
on public.staff_accounts for select
to authenticated
using (auth_user_id = auth.uid() and active = true);

create policy "Managers can insert accounts"
on public.staff_accounts for insert
to authenticated
with check (public.current_staff_role() = 'manager');

create policy "Managers can update accounts"
on public.staff_accounts for update
to authenticated
using (public.current_staff_role() = 'manager')
with check (public.current_staff_role() = 'manager');

create policy "Managers can read all leave"
on public.leave_requests for select
to authenticated
using (public.current_staff_role() = 'manager');

create policy "Staff can read own leave"
on public.leave_requests for select
to authenticated
using (staff_id = (public.current_staff_account()).staff_id);

create policy "Staff can create own leave"
on public.leave_requests for insert
to authenticated
with check (
  staff_id = (public.current_staff_account()).staff_id
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and cancelled_at is null
);

create policy "Managers can create leave"
on public.leave_requests for insert
to authenticated
with check (public.current_staff_role() = 'manager');

create policy "Staff can cancel own pending leave"
on public.leave_requests for update
to authenticated
using (staff_id = (public.current_staff_account()).staff_id and status = 'pending')
with check (staff_id = (public.current_staff_account()).staff_id and status = 'cancelled');

create policy "Managers can review leave"
on public.leave_requests for update
to authenticated
using (public.current_staff_role() = 'manager')
with check (public.current_staff_role() = 'manager');
