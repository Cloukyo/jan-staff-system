create type public.rota_week_status as enum ('draft', 'published', 'archived');
create type public.rota_shift_status as enum ('scheduled', 'cancelled', 'completed');

create table public.rota_settings (
  id boolean primary key default true check (id),
  week_starts_on smallint not null default 1 check (week_starts_on between 1 and 7),
  opening_time time not null default '07:30',
  closing_time time not null default '18:30',
  default_break_minutes integer not null default 30 check (default_break_minutes between 0 and 240),
  shift_interval_minutes integer not null default 15 check (shift_interval_minutes in (5, 10, 15, 30, 60)),
  available_rooms text[] not null default array[]::text[],
  allow_overlap_override boolean not null default true,
  allow_inactive_staff_override boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_accounts(id) on delete restrict
);

insert into public.rota_settings (id) values (true);

create table public.rota_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,
  status public.rota_week_status not null default 'draft',
  title text,
  notes text,
  published_at timestamptz,
  published_by uuid references public.staff_accounts(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.staff_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.staff_accounts(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.staff_accounts(id) on delete restrict,
  constraint rota_week_monday check (extract(isodow from week_start_date) = 1),
  constraint rota_week_publish_audit check (
    (status <> 'published') or (published_at is not null and published_by is not null)
  ),
  constraint rota_week_archive_audit check (
    (status <> 'archived') or (archived_at is not null and archived_by is not null)
  )
);

create unique index rota_weeks_one_active_version_idx
on public.rota_weeks (week_start_date)
where status <> 'archived';

create table public.rota_shifts (
  id uuid primary key default gen_random_uuid(),
  rota_week_id uuid not null references public.rota_weeks(id) on delete restrict,
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  room_or_area text,
  role_on_shift text,
  notes text,
  status public.rota_shift_status not null default 'scheduled',
  inactive_staff_override_reason text,
  leave_override_reason text,
  overlap_override_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.staff_accounts(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.staff_accounts(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.staff_accounts(id) on delete restrict,
  constraint rota_shift_time_order check (end_time > start_time),
  constraint rota_shift_break_duration check (
    break_minutes <= extract(epoch from (end_time - start_time)) / 60
  ),
  constraint rota_shift_archive_audit check (
    (archived_at is null and archived_by is null)
    or (archived_at is not null and archived_by is not null)
  )
);

create unique index rota_shifts_identical_active_idx
on public.rota_shifts (rota_week_id, staff_id, shift_date, start_time, end_time)
where archived_at is null and status <> 'cancelled';

create index rota_shifts_week_date_idx
on public.rota_shifts (rota_week_id, shift_date)
where archived_at is null;

create index rota_shifts_staff_date_idx
on public.rota_shifts (staff_id, shift_date)
where archived_at is null;

create trigger rota_settings_updated_at before update on public.rota_settings
for each row execute function public.set_updated_at();
create trigger rota_weeks_updated_at before update on public.rota_weeks
for each row execute function public.set_updated_at();
create trigger rota_shifts_updated_at before update on public.rota_shifts
for each row execute function public.set_updated_at();

create or replace function public.validate_rota_shift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  week_start date;
  staff_active boolean;
  overlap_allowed boolean;
  inactive_allowed boolean;
  has_approved_leave boolean;
  has_overlap boolean;
begin
  select rw.week_start_date into week_start
  from public.rota_weeks rw
  where rw.id = new.rota_week_id and rw.status <> 'archived';
  if week_start is null then raise exception 'Choose an active rota week'; end if;
  if new.shift_date < week_start or new.shift_date > week_start + 6 then
    raise exception 'Shift date must fall within the rota week';
  end if;

  select sp.active into staff_active from public.staff_profiles sp where sp.id = new.staff_id;
  if staff_active is null then raise exception 'Staff profile does not exist'; end if;
  select allow_overlap_override, allow_inactive_staff_override
  into overlap_allowed, inactive_allowed
  from public.rota_settings where id = true;

  if not staff_active and (not inactive_allowed or nullif(trim(new.inactive_staff_override_reason), '') is null) then
    raise exception 'Inactive staff require an enabled override and a reason';
  end if;

  select exists (
    select 1 from public.leave_requests lr
    where lr.staff_id = new.staff_id
      and lr.status = 'approved'
      and new.shift_date between lr.start_date and lr.end_date
      and (
        lr.day_part = 'full_day'
        or (lr.start_date = new.shift_date and new.start_time < lr.end_time and new.end_time > lr.start_time)
      )
  ) into has_approved_leave;
  if has_approved_leave and nullif(trim(new.leave_override_reason), '') is null then
    raise exception 'Approved leave conflict requires an override reason';
  end if;

  select exists (
    select 1 from public.rota_shifts rs
    where rs.staff_id = new.staff_id
      and rs.shift_date = new.shift_date
      and rs.archived_at is null
      and rs.status <> 'cancelled'
      and rs.id <> new.id
      and new.start_time < rs.end_time
      and new.end_time > rs.start_time
  ) into has_overlap;
  if has_overlap and (not overlap_allowed or nullif(trim(new.overlap_override_reason), '') is null) then
    raise exception 'Overlapping shift requires an enabled override and a reason';
  end if;

  return new;
end;
$$;

create trigger rota_shift_validation
before insert or update on public.rota_shifts
for each row execute function public.validate_rota_shift();

alter table public.rota_settings enable row level security;
alter table public.rota_weeks enable row level security;
alter table public.rota_shifts enable row level security;

create policy "Managers can manage rota settings" on public.rota_settings for all to authenticated
using (public.current_staff_role() = 'manager')
with check (public.current_staff_role() = 'manager');

create policy "Managers can manage rota weeks" on public.rota_weeks for all to authenticated
using (public.current_staff_role() = 'manager')
with check (public.current_staff_role() = 'manager');

create policy "Staff can read published rota weeks" on public.rota_weeks for select to authenticated
using (status = 'published' and public.current_staff_role() = 'staff');

create policy "Managers can manage rota shifts" on public.rota_shifts for all to authenticated
using (public.current_staff_role() = 'manager')
with check (public.current_staff_role() = 'manager');

create policy "Staff can read own published shifts" on public.rota_shifts for select to authenticated
using (
  staff_id = (public.current_staff_account()).staff_id
  and archived_at is null
  and exists (
    select 1 from public.rota_weeks rw
    where rw.id = rota_week_id and rw.status = 'published'
  )
);

revoke all on public.rota_settings, public.rota_weeks, public.rota_shifts from anon, authenticated;
grant select, insert, update on public.rota_settings, public.rota_weeks, public.rota_shifts to authenticated;

create or replace function public.copy_previous_rota_week(target_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  source_week public.rota_weeks;
  target_week public.rota_weeks;
  copied_count integer;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then raise exception 'Manager access required'; end if;
  if extract(isodow from target_week_start) <> 1 then raise exception 'Week must start on Monday'; end if;

  select * into source_week from public.rota_weeks
  where week_start_date = target_week_start - 7 and status <> 'archived';
  if not found then raise exception 'Previous rota week does not exist'; end if;

  insert into public.rota_weeks (week_start_date, status, title, created_by, updated_by)
  values (target_week_start, 'draft', 'Copied from previous week', manager_account.id, manager_account.id)
  on conflict (week_start_date) where status <> 'archived' do update
  set updated_by = excluded.updated_by
  returning * into target_week;

  insert into public.rota_shifts (
    rota_week_id, staff_id, shift_date, start_time, end_time, break_minutes,
    room_or_area, role_on_shift, notes, status, created_by, updated_by
  )
  select
    target_week.id, rs.staff_id, rs.shift_date + 7, rs.start_time, rs.end_time,
    rs.break_minutes, rs.room_or_area, rs.role_on_shift, rs.notes, 'scheduled',
    manager_account.id, manager_account.id
  from public.rota_shifts rs
  where rs.rota_week_id = source_week.id
    and rs.archived_at is null
    and rs.status <> 'cancelled'
    and not exists (
      select 1 from public.rota_shifts existing
      where existing.rota_week_id = target_week.id
        and existing.staff_id = rs.staff_id
        and existing.shift_date = rs.shift_date + 7
        and existing.start_time = rs.start_time
        and existing.end_time = rs.end_time
        and existing.archived_at is null
        and existing.status <> 'cancelled'
    );
  get diagnostics copied_count = row_count;
  return jsonb_build_object('week_id', target_week.id, 'copied_shifts', copied_count);
end;
$$;

revoke all on function public.copy_previous_rota_week(date) from public;
grant execute on function public.copy_previous_rota_week(date) to authenticated;

create or replace function public.copy_rota_day(
  target_week_id uuid,
  source_shift_date date,
  target_shift_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_account public.staff_accounts;
  week_start date;
  copied_count integer;
begin
  manager_account := public.current_staff_account();
  if manager_account.role <> 'manager' then raise exception 'Manager access required'; end if;

  select week_start_date into week_start
  from public.rota_weeks
  where id = target_week_id and status = 'draft';
  if not found then raise exception 'Day copying requires an active draft week'; end if;
  if source_shift_date not between week_start and week_start + 6
    or target_shift_date not between week_start and week_start + 6 then
    raise exception 'Source and target dates must fall within the rota week';
  end if;
  if source_shift_date = target_shift_date then raise exception 'Choose a different target day'; end if;

  insert into public.rota_shifts (
    rota_week_id, staff_id, shift_date, start_time, end_time, break_minutes,
    room_or_area, role_on_shift, notes, status, created_by, updated_by
  )
  select
    target_week_id, rs.staff_id, target_shift_date, rs.start_time, rs.end_time,
    rs.break_minutes, rs.room_or_area, rs.role_on_shift, rs.notes, 'scheduled',
    manager_account.id, manager_account.id
  from public.rota_shifts rs
  where rs.rota_week_id = target_week_id
    and rs.shift_date = source_shift_date
    and rs.archived_at is null
    and rs.status <> 'cancelled'
    and not exists (
      select 1 from public.rota_shifts existing
      where existing.rota_week_id = target_week_id
        and existing.staff_id = rs.staff_id
        and existing.shift_date = target_shift_date
        and existing.start_time = rs.start_time
        and existing.end_time = rs.end_time
        and existing.archived_at is null
        and existing.status <> 'cancelled'
    );
  get diagnostics copied_count = row_count;
  return jsonb_build_object('copied_shifts', copied_count);
end;
$$;

revoke all on function public.copy_rota_day(uuid, date, date) from public;
grant execute on function public.copy_rota_day(uuid, date, date) to authenticated;
