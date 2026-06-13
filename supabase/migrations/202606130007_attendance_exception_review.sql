create type public.attendance_review_status as enum (
  'approved',
  'corrected',
  'ignored',
  'needs_staff_clarification'
);

create type public.attendance_correction_request_status as enum (
  'pending',
  'resolved',
  'rejected'
);

create table public.attendance_day_reviews (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  review_date date not null,
  status public.attendance_review_status not null,
  reason text,
  reviewed_by uuid not null references public.staff_accounts(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, review_date),
  constraint attendance_review_reason check (
    status = 'approved' or length(trim(coalesce(reason, ''))) >= 5
  )
);

create table public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  attendance_date date not null,
  issue_type text not null check (issue_type in ('forgot_clock_in', 'forgot_clock_out', 'incorrect_time', 'other')),
  staff_note text not null check (length(trim(staff_note)) between 5 and 1000),
  status public.attendance_correction_request_status not null default 'pending',
  manager_note text,
  resolved_by uuid references public.staff_accounts(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint correction_request_resolution check (
    (status = 'pending' and resolved_by is null and resolved_at is null)
    or
    (status <> 'pending' and resolved_by is not null and resolved_at is not null)
  )
);

create index attendance_day_reviews_date_status_idx
on public.attendance_day_reviews (review_date, status, staff_id);

create index attendance_correction_requests_date_status_idx
on public.attendance_correction_requests (attendance_date, status, staff_id);

create trigger attendance_day_reviews_updated_at before update on public.attendance_day_reviews
for each row execute function public.set_updated_at();

create trigger attendance_correction_requests_updated_at before update on public.attendance_correction_requests
for each row execute function public.set_updated_at();

alter table public.attendance_day_reviews enable row level security;
alter table public.attendance_correction_requests enable row level security;

create policy "Managers can manage attendance reviews"
on public.attendance_day_reviews for all to authenticated
using (public.current_staff_role() = 'manager')
with check (
  public.current_staff_role() = 'manager'
  and reviewed_by = (public.current_staff_account()).id
);

create policy "Managers can read correction requests"
on public.attendance_correction_requests for select to authenticated
using (public.current_staff_role() = 'manager');

create policy "Managers can resolve correction requests"
on public.attendance_correction_requests for update to authenticated
using (public.current_staff_role() = 'manager')
with check (
  public.current_staff_role() = 'manager'
  and resolved_by = (public.current_staff_account()).id
);

create policy "Staff can read own correction requests"
on public.attendance_correction_requests for select to authenticated
using (staff_id = public.current_staff_profile_id());

create policy "Staff can create own correction requests"
on public.attendance_correction_requests for insert to authenticated
with check (
  staff_id = public.current_staff_profile_id()
  and status = 'pending'
  and resolved_by is null
  and resolved_at is null
);

revoke all on public.attendance_day_reviews, public.attendance_correction_requests from anon, authenticated;
grant select, insert, update on public.attendance_day_reviews to authenticated;
grant select, insert, update on public.attendance_correction_requests to authenticated;
