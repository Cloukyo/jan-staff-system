import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const MANAGER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";
export const STAFF_ACCOUNT_ID = "00000000-0000-0000-0000-000000000002";

const prerequisiteSql = `
create role anon;
create role authenticated;

create type public.app_role as enum ('manager', 'staff');
create type public.rota_week_status as enum ('draft', 'published', 'archived');
create type public.rota_shift_status as enum ('scheduled', 'cancelled', 'completed');

create table public.staff_profiles (
  id text primary key,
  full_name text not null,
  display_name text,
  active boolean not null default true
);

create table public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id),
  role public.app_role not null,
  active boolean not null default true
);

create or replace function public.current_staff_account()
returns public.staff_accounts
language sql
security definer
set search_path = public
stable
as $$
  select account.*
  from public.staff_accounts account
  where account.id = nullif(current_setting('app.current_account_id', true), '')::uuid
  limit 1;
$$;

create or replace function public.current_staff_role()
returns public.app_role
language sql
security definer
set search_path = public
stable
as $$
  select (public.current_staff_account()).role;
$$;

create or replace function public.current_staff_profile_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select (public.current_staff_account()).staff_id;
$$;

create table public.clock_events (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  event_timestamp timestamptz not null default now(),
  recorded_date date generated always as ((event_timestamp at time zone 'Europe/London')::date) stored,
  kiosk_device_id text,
  event_source text not null default 'kiosk' check (event_source in ('kiosk', 'manager')),
  manager_correction boolean not null default false,
  corrected_by uuid references public.staff_accounts(id) on delete restrict,
  correction_reason text,
  created_at timestamptz not null default now()
);

alter table public.clock_events enable row level security;

create policy "Managers can read clock events"
on public.clock_events for select to authenticated
using (public.current_staff_role() = 'manager');

create policy "Staff can read own clock events"
on public.clock_events for select to authenticated
using (staff_id = public.current_staff_profile_id());

create policy "Managers can add clock corrections"
on public.clock_events for insert to authenticated
with check (
  public.current_staff_role() = 'manager'
  and event_source = 'manager'
  and manager_correction = true
  and corrected_by = (public.current_staff_account()).id
  and correction_reason is not null
);

grant select, insert on public.clock_events to authenticated;

create table public.rota_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,
  status public.rota_week_status not null
);

create table public.rota_shifts (
  id uuid primary key default gen_random_uuid(),
  rota_week_id uuid not null references public.rota_weeks(id),
  staff_id text not null references public.staff_profiles(id),
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  status public.rota_shift_status not null default 'scheduled',
  archived_at timestamptz
);

create table public.rota_settings (
  id boolean primary key,
  work_week_starts_on smallint not null default 1
);

insert into public.rota_settings values (true, 1);

create or replace function public.get_current_work_week_range(reference_date date default null)
returns table (start_date date, end_date date)
language sql
stable
set search_path = public
as $$
  select coalesce(reference_date, current_date), coalesce(reference_date, current_date) + 6;
$$;

-- PGlite has no real cross-session advisory lock scheduler. This no-op overload
-- lets behavioural tests execute while structural tests retain the lock contract.
create or replace function public.pg_advisory_xact_lock(key bigint)
returns void
language sql
as $$
  select;
$$;

create or replace function public.test_kiosk_clock_event(
  target_staff_id text,
  requested_event_type text,
  requested_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
begin
  insert into public.clock_events (
    staff_id,
    event_type,
    event_timestamp,
    event_source,
    manager_correction
  )
  values (
    target_staff_id,
    requested_event_type,
    requested_at,
    'kiosk',
    false
  )
  returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.test_kiosk_clock_event(text, text, timestamptz) from public;
grant execute on function public.test_kiosk_clock_event(text, text, timestamptz) to authenticated;

insert into public.staff_profiles (id, full_name)
values
  ('manager-profile', 'Manager'),
  ('staff-profile', 'Staff');

insert into public.staff_accounts (id, staff_id, role)
values
  ('${MANAGER_ACCOUNT_ID}', 'manager-profile', 'manager'),
  ('${STAFF_ACCOUNT_ID}', 'staff-profile', 'staff');

insert into public.clock_events (
  staff_id,
  event_type,
  event_timestamp,
  event_source,
  manager_correction,
  corrected_by,
  correction_reason
)
values (
  'staff-profile',
  'clock_in',
  '2026-08-11T08:00:00+01:00',
  'manager',
  true,
  '${MANAGER_ACCOUNT_ID}',
  'Historic correction'
);
`;

export async function createAttendanceTestDatabase() {
  const db = new PGlite();
  await db.exec(prerequisiteSql);
  await db.exec(
    readFileSync(
      resolve("supabase/migrations/202607280001_clock_event_corrections.sql"),
      "utf8",
    ),
  );
  await setCurrentAccount(db, MANAGER_ACCOUNT_ID);
  return db;
}

export async function setCurrentAccount(db: PGlite, accountId: string) {
  await db.query("select set_config('app.current_account_id', $1, false)", [accountId]);
}

export async function setAuthenticatedRole(db: PGlite) {
  await db.exec("set role authenticated");
}

export async function resetRole(db: PGlite) {
  await db.exec("reset role");
}

export async function seedStaffShift(
  db: PGlite,
  input: {
    staffId: string;
    date: string;
    start?: string;
    finish?: string;
  },
) {
  const start = input.start ?? "09:00";
  const finish = input.finish ?? "17:00";
  await db.query(
    "insert into public.staff_profiles (id, full_name) values ($1, $2)",
    [input.staffId, input.staffId],
  );
  const week = await db.query<{ id: string }>(
    `insert into public.rota_weeks (week_start_date, status)
     values ($1::date, 'published')
     returning id::text`,
    [input.date],
  );
  await db.query(
    `insert into public.rota_shifts (
       rota_week_id, staff_id, shift_date, start_time, end_time
     )
     values ($1::uuid, $2, $3::date, $4::time, $5::time)`,
    [week.rows[0].id, input.staffId, input.date, start, finish],
  );
}

export async function seedClockEvent(
  db: PGlite,
  input: {
    staffId: string;
    timestamp: string;
    eventType: "clock_in" | "clock_out";
    source?: "kiosk" | "manager";
  },
) {
  const result = await db.query<{ id: string }>(
    `insert into public.clock_events (
       staff_id, event_type, event_timestamp, event_source,
       manager_correction, corrected_by, correction_reason
     )
     values (
       $1, $2, $3::timestamptz, $4,
       $4 = 'manager',
       case when $4 = 'manager' then $5::uuid else null end,
       case when $4 = 'manager' then 'Historic correction' else null end
     )
     returning id::text`,
    [
      input.staffId,
      input.eventType,
      input.timestamp,
      input.source ?? "kiosk",
      MANAGER_ACCOUNT_ID,
    ],
  );
  return result.rows[0].id;
}

export async function usePlannedHours(db: PGlite, staffId: string, date: string) {
  const result = await db.query<{ batch_id: string | null }>(
    `select public.use_planned_hours(
       $1,
       $2::date,
       'Use published hours'
     )::text as batch_id`,
    [staffId, date],
  );
  return result.rows[0].batch_id;
}

export async function effectiveEvents(db: PGlite, staffId: string, date: string) {
  const result = await db.query<{
    event_type: "clock_in" | "clock_out";
    local_time: string;
    event_timestamp: string;
    source: string;
  }>(
    `select
       event_type,
       to_char(event_timestamp at time zone 'Europe/London', 'HH24:MI') as local_time,
       event_timestamp::text,
       source
     from public.get_effective_clock_events($1::date, $1::date, $2)
     order by event_timestamp, event_id`,
    [date, staffId],
  );
  return result.rows;
}
