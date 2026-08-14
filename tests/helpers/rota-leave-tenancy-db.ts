import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createCustomerDomainDatabase } from "./customer-domain-db";
import {
  MEMBERSHIP_A_OWNER,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./tenant-primitives-db";

export {
  MEMBERSHIP_A_OWNER,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  STAFF_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
};

export const STAFF_A2 = "tenant-staff-a2";
export const USER_A_STAFF = "a0000000-0000-4000-8000-000000000005";
export const MEMBERSHIP_A_STAFF = "aa000000-0000-4000-8000-000000000005";
export const WORK_AREA_A1 = "41000000-0000-0000-0000-000000000001";
export const WORK_AREA_A2 = "41000000-0000-0000-0000-000000000002";
export const WORK_AREA_B1 = "42000000-0000-0000-0000-000000000001";

const inheritedSql = `
create type public.leave_type as enum ('annual_leave','sickness','medical_appointment','unpaid_leave','training','other');
create type public.leave_status as enum ('pending','approved','rejected','cancelled');
create type public.leave_day_part as enum ('full_day','partial_day');
create type public.rota_week_status as enum ('draft','published','archived');
create type public.rota_shift_status as enum ('scheduled','cancelled','completed');
create type public.rota_template_status as enum ('active','archived');
create type public.rota_template_source_type as enum ('manual','saved_from_rota','private_import');
create type public.rota_template_apply_mode as enum ('empty_days','replace','alongside');

create table public.attendance_operation_requests (
  operation_id uuid primary key, operation_kind text not null, staff_id text not null, recorded_date date not null,
  target_event_id uuid, reason text not null, expected_revision text, expected_planned_start time, expected_planned_finish time,
  organisation_id uuid, site_id uuid, created_by_membership_id uuid
);
create table public.clock_event_corrections (
  id uuid primary key, batch_id uuid not null, correction_role text not null, organisation_id uuid, site_id uuid, staff_id text not null,
  correction_kind text not null, original_event_id uuid, supersedes_correction_id uuid, event_type text, event_timestamp timestamptz,
  recorded_date date not null, reason text not null, created_by uuid, created_by_membership_id uuid, expected_revision text, request_fingerprint text
);
create or replace function private.lock_attendance_stream(uuid,text) returns void language sql as 'select null::void';
create or replace function private.commercial_attendance_revision(uuid,uuid,text,date) returns text language sql stable as 'select ''events:|corrections:''::text';
create or replace function private.get_commercial_effective_clock_events(uuid,uuid,date,date,text default null)
returns table(organisation_id uuid,site_id uuid,event_id uuid,event_order_key text,original_event_id uuid,correction_id uuid,staff_id text,event_type text,event_timestamp timestamptz,recorded_date date,source text)
language sql stable as 'select null::uuid,null::uuid,null::uuid,null::text,null::uuid,null::uuid,null::text,null::text,null::timestamptz,null::date,null::text where false';

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(), staff_id text not null,
  leave_type public.leave_type not null, start_date date not null, end_date date not null,
  day_part public.leave_day_part not null default 'full_day', start_time time, end_time time,
  requested_minutes integer not null check(requested_minutes>0), staff_note text,
  status public.leave_status not null default 'pending', manager_note text,
  reviewed_by uuid references public.staff_accounts(id), reviewed_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(start_date<=end_date)
);
create table public.rota_settings (
  id boolean primary key default true check(id), week_starts_on smallint not null default 1,
  opening_time time not null default '07:30', closing_time time not null default '18:30',
  default_break_minutes integer not null default 30, shift_interval_minutes integer not null default 15,
  available_rooms text[] not null default '{}', available_work_areas text[] not null default '{}',
  allow_overlap_override boolean not null default true, allow_inactive_staff_override boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid references public.staff_accounts(id)
);
create table public.rota_weeks (
  id uuid primary key default gen_random_uuid(), week_start_date date not null,
  status public.rota_week_status not null default 'draft', title text, notes text,
  published_at timestamptz, published_by uuid references public.staff_accounts(id),
  archived_at timestamptz, archived_by uuid references public.staff_accounts(id),
  created_at timestamptz not null default now(), created_by uuid not null references public.staff_accounts(id),
  updated_at timestamptz not null default now(), updated_by uuid not null references public.staff_accounts(id)
);
create unique index rota_weeks_one_active_version_idx on public.rota_weeks(week_start_date) where status<>'archived';
create table public.rota_shifts (
  id uuid primary key default gen_random_uuid(), rota_week_id uuid not null references public.rota_weeks(id),
  staff_id text not null references public.staff_profiles(id), shift_date date not null,
  start_time time not null, end_time time not null, break_minutes integer not null default 0,
  break_unspecified boolean not null default false, room_or_area text, work_area text, role_on_shift text, notes text,
  status public.rota_shift_status not null default 'scheduled', inactive_staff_override_reason text,
  leave_override_reason text, overlap_override_reason text,
  created_at timestamptz not null default now(), created_by uuid not null references public.staff_accounts(id),
  updated_at timestamptz not null default now(), updated_by uuid not null references public.staff_accounts(id),
  archived_at timestamptz, archived_by uuid references public.staff_accounts(id)
);
create table public.rota_templates (
  id uuid primary key default gen_random_uuid(), name text not null, description text,
  status public.rota_template_status not null default 'active', source_type public.rota_template_source_type not null default 'manual',
  created_at timestamptz not null default now(), created_by uuid not null references public.staff_accounts(id),
  updated_at timestamptz not null default now(), updated_by uuid not null references public.staff_accounts(id),
  archived_at timestamptz, archived_by uuid references public.staff_accounts(id)
);
create table public.rota_template_shifts (
  id uuid primary key default gen_random_uuid(), template_id uuid not null references public.rota_templates(id) on delete cascade,
  staff_id text not null references public.staff_profiles(id), day_of_week smallint not null,
  start_time time not null, end_time time not null, break_minutes integer not null default 0,
  break_unspecified boolean not null default false, room_or_area text, work_area text, role_on_shift text, notes text, sort_order integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid not null references public.staff_accounts(id),
  updated_at timestamptz not null default now(), updated_by uuid not null references public.staff_accounts(id),
  archived_at timestamptz, archived_by uuid references public.staff_accounts(id)
);
create table public.rota_template_applications (
  id uuid primary key default gen_random_uuid(), request_key uuid not null unique,
  template_id uuid not null references public.rota_templates(id), rota_week_id uuid not null references public.rota_weeks(id),
  apply_mode public.rota_template_apply_mode not null, created_shifts integer not null default 0,
  archived_shifts integer not null default 0, skipped_shifts integer not null default 0,
  applied_at timestamptz not null default now(), applied_by uuid not null references public.staff_accounts(id)
);
alter table public.rota_shifts add column source_template_shift_id uuid references public.rota_template_shifts(id),
  add column template_application_id uuid references public.rota_template_applications(id);

alter table public.leave_requests enable row level security;
alter table public.rota_settings enable row level security;
alter table public.rota_weeks enable row level security;
alter table public.rota_shifts enable row level security;
alter table public.rota_templates enable row level security;
alter table public.rota_template_shifts enable row level security;
alter table public.rota_template_applications enable row level security;
grant select,insert,update on public.leave_requests,public.rota_settings,public.rota_weeks,public.rota_shifts,public.rota_templates,public.rota_template_shifts,public.rota_template_applications to authenticated;

insert into public.rota_settings(id) values(true);
insert into public.leave_requests(staff_id,leave_type,start_date,end_date,requested_minutes,status)
values('legacy-unowned-staff','annual_leave','2026-08-17','2026-08-17',480,'pending');
insert into public.rota_weeks(id,week_start_date,status,created_by,updated_by)
values('40000000-0000-0000-0000-000000000001','2026-08-17','draft','99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001');
`;

const fixtureSql = `
insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,active)
values('${STAFF_A2}','${ORG_A}','Fictional Multi Site','Fictional Multi Site','Staff member',true);
insert into auth.users(id,email,email_confirmed_at)
values('${USER_A_STAFF}','fictional.staff@example.test',now());
insert into public.organisation_memberships(id,organisation_id,auth_user_id,staff_id,status,joined_at)
values('${MEMBERSHIP_A_STAFF}','${ORG_A}','${USER_A_STAFF}','${STAFF_A2}','active',now());
insert into public.membership_role_assignments(organisation_id,membership_id,role,scope_type,site_id,granted_by_membership_id)
values('${ORG_A}','${MEMBERSHIP_A_STAFF}','staff','organisation',null,'${MEMBERSHIP_A_OWNER}');
insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary,created_by_membership_id)
values
  ('${ORG_A}','${STAFF_A2}','${SITE_A1}','2026-08-01',true,'${MEMBERSHIP_A_OWNER}'),
  ('${ORG_A}','${STAFF_A2}','${SITE_A2}','2026-08-01',false,'${MEMBERSHIP_A_OWNER}');
update public.work_areas set id='${WORK_AREA_A1}' where organisation_id='${ORG_A}' and site_id='${SITE_A1}';
update public.work_areas set id='${WORK_AREA_A2}' where organisation_id='${ORG_A}' and site_id='${SITE_A2}';
update public.work_areas set id='${WORK_AREA_B1}' where organisation_id='${ORG_B}' and site_id='${SITE_B1}';
`;

export async function createRotaLeaveTenancyDatabase(): Promise<PGlite> {
  const db = await createCustomerDomainDatabase();
  await resetTenantDatabaseRole(db);
  await db.exec(inheritedSql);
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_rota_leave_tenancy.sql"));
  if (!migration) throw new Error("rota and leave tenancy migration is missing");
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  await db.exec(fixtureSql);
  return db;
}
