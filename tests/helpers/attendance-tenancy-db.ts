import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import {
  createCustomerDomainDatabase,
  setLegacyManager,
} from "./customer-domain-db";
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
  USER_MULTI,
  MEMBERSHIP_MULTI_A,
  MEMBERSHIP_MULTI_B,
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
  USER_MULTI,
  MEMBERSHIP_MULTI_A,
  MEMBERSHIP_MULTI_B,
  resetTenantDatabaseRole,
  setLegacyManager,
  setTenantAuthUser,
};

export const STAFF_A2 = "tenant-staff-a2";
export const DEVICE_A1 = "31000000-0000-0000-0000-000000000001";
export const DEVICE_A2 = "31000000-0000-0000-0000-000000000002";
export const DEVICE_B1 = "32000000-0000-0000-0000-000000000001";
export const DEVICE_TOKEN_A1 = "fictional-device-token-a1-000000000001";
export const DEVICE_TOKEN_A2 = "fictional-device-token-a2-000000000002";
export const DEVICE_TOKEN_B1 = "fictional-device-token-b1-000000000001";

const inheritedAttendanceSql = `
create schema if not exists extensions;
create or replace function extensions.digest(candidate text, algorithm text)
returns bytea language sql immutable as $$ select decode(md5(candidate), 'hex') $$;
create or replace function extensions.crypt(candidate text, stored_hash text)
returns text language sql immutable as $$ select candidate $$;

create type public.attendance_review_status as enum ('approved','corrected','ignored','needs_staff_clarification');
create type public.attendance_correction_request_status as enum ('pending','resolved','rejected');

create table public.staff_kiosk_settings (
  staff_id text primary key references public.staff_profiles(id) on delete restrict,
  kiosk_enabled boolean not null default true,
  pin_hash text,
  pin_updated_at timestamptz,
  pin_updated_by uuid references public.staff_accounts(id),
  pin_reset_required boolean not null default false,
  failed_attempt_count integer not null default 0,
  locked_until timestamptz
);

create table public.kiosk_devices (
  id uuid primary key default gen_random_uuid(), device_name text not null,
  token_hash bytea not null unique, active boolean not null default true,
  expires_at timestamptz not null, last_used_at timestamptz,
  activated_by uuid not null references public.staff_accounts(id) on delete restrict,
  activated_at timestamptz not null default now(), revoked_by uuid references public.staff_accounts(id),
  revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  offline_enabled boolean not null default false
);

create table public.clock_events (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  event_type text not null check (event_type in ('clock_in','clock_out')),
  event_timestamp timestamptz not null default now(),
  recorded_date date generated always as ((event_timestamp at time zone 'Europe/London')::date) stored,
  kiosk_device_id text, event_source text not null default 'kiosk',
  manager_correction boolean not null default false,
  corrected_by uuid references public.staff_accounts(id), correction_reason text,
  created_at timestamptz not null default now()
);

create table public.clock_event_corrections (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null,
  correction_role text not null, staff_id text not null references public.staff_profiles(id) on delete restrict,
  correction_kind text not null, original_event_id uuid references public.clock_events(id) on delete restrict,
  supersedes_correction_id uuid references public.clock_event_corrections(id) on delete restrict,
  event_type text, event_timestamp timestamptz, recorded_date date not null,
  reason text not null, created_by uuid not null references public.staff_accounts(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.attendance_day_reviews (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id),
  review_date date not null, status public.attendance_review_status not null, reason text,
  reviewed_by uuid not null references public.staff_accounts(id), reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(staff_id, review_date)
);
create table public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id),
  attendance_date date not null, issue_type text not null, staff_note text not null,
  status public.attendance_correction_request_status not null default 'pending', manager_note text,
  resolved_by uuid references public.staff_accounts(id), resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint correction_request_resolution check (
    (status = 'pending' and resolved_by is null and resolved_at is null)
    or (status <> 'pending' and resolved_by is not null and resolved_at is not null)
  )
);
create table public.attendance_operation_requests (
  operation_id uuid primary key, operation_kind text not null, staff_id text not null references public.staff_profiles(id),
  recorded_date date not null, target_event_id uuid, reason text not null, expected_revision text not null,
  expected_planned_start time, expected_planned_finish time, created_at timestamptz not null default now()
);
create table public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id),
  operational_date date not null, exception_type text not null, status text not null default 'open',
  primary_event_id uuid, kiosk_device_id uuid, related_event_ids uuid[] not null default '{}', anomaly_fingerprint text not null,
  detection_revision text not null, suggested_resolution_at timestamptz, source text not null,
  reviewing_manager_id uuid references public.staff_accounts(id), review_started_at timestamptz,
  resolution_correction_batch_id uuid, resolution_reason text, resolved_at timestamptz,
  dismissal_reason text, dismissed_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_exception_review_details check (
    (status = 'open' and reviewing_manager_id is null and review_started_at is null)
    or (status <> 'open' and reviewing_manager_id is not null and review_started_at is not null)
  ),
  constraint attendance_exception_resolution_details check (
    (status = 'resolved' and resolution_reason is not null and resolved_at is not null)
    or (status <> 'resolved' and resolution_reason is null and resolved_at is null and resolution_correction_batch_id is null)
  ),
  constraint attendance_exception_dismissal_details check (
    (status = 'dismissed' and dismissal_reason is not null and dismissed_at is not null)
    or (status <> 'dismissed' and dismissal_reason is null and dismissed_at is null)
  )
);
create unique index attendance_exceptions_open_fingerprint_idx on public.attendance_exceptions
  (staff_id, operational_date, exception_type, anomaly_fingerprint) where status in ('open','under_review');
create table public.attendance_action_requests (
  idempotency_key uuid primary key, staff_id text not null references public.staff_profiles(id),
  kiosk_device_id uuid not null references public.kiosk_devices(id), action text not null,
  expected_revision text not null, created_at timestamptz not null default now(), completed_at timestamptz,
  result_code text, resulting_state text, resulting_event_id uuid references public.clock_events(id),
  safe_response jsonb, expires_at timestamptz not null default (now() + interval '90 days'),
  offline_authorisation_id uuid, device_sequence bigint, occurred_at_device timestamptz,
  received_at_server timestamptz, clock_confidence text, conflict_category text
);
create table public.attendance_exception_operations (
  operation_id uuid primary key, exception_id uuid not null references public.attendance_exceptions(id),
  operation_kind text not null, expected_revision text not null, reason text not null,
  request_fingerprint text not null, created_by uuid not null references public.staff_accounts(id),
  correction_batch_id uuid, safe_response jsonb, created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.kiosk_devices enable row level security;
alter table public.clock_events enable row level security;
alter table public.clock_event_corrections enable row level security;
alter table public.attendance_day_reviews enable row level security;
alter table public.attendance_correction_requests enable row level security;
alter table public.attendance_operation_requests enable row level security;
alter table public.attendance_exceptions enable row level security;
alter table public.attendance_action_requests enable row level security;
alter table public.attendance_exception_operations enable row level security;

create policy "Managers can read clock events" on public.clock_events for select to authenticated using (public.current_staff_role() = 'manager');
create policy "Staff can read own clock events" on public.clock_events for select to authenticated using (staff_id = public.current_staff_profile_id());
create policy "Managers can add clock corrections" on public.clock_events for insert to authenticated with check (public.current_staff_role() = 'manager');
create policy "Managers can read clock event corrections" on public.clock_event_corrections for select to authenticated using (public.current_staff_role() = 'manager');
create policy "Managers can manage attendance reviews" on public.attendance_day_reviews for all to authenticated using (public.current_staff_role() = 'manager');
create policy "Managers can read correction requests" on public.attendance_correction_requests for select to authenticated using (public.current_staff_role() = 'manager');
create policy "Managers can resolve correction requests" on public.attendance_correction_requests for update to authenticated using (public.current_staff_role() = 'manager');
create policy "Staff can read own correction requests" on public.attendance_correction_requests for select to authenticated using (staff_id = public.current_staff_profile_id());
create policy "Staff can create own correction requests" on public.attendance_correction_requests for insert to authenticated with check (staff_id = public.current_staff_profile_id());
create policy "Managers can read attendance exceptions" on public.attendance_exceptions for select to authenticated using (public.current_staff_role() = 'manager');
grant select, insert, update on all tables in schema public to authenticated;

create function public.verify_device_kiosk_pin(text, text, text) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'code', 'legacy_stub')
$$;
create function public.perform_device_kiosk_attendance_action(text, text, text, text, text, uuid) returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'code', 'legacy_stub')
$$;
create function public.get_device_kiosk_roster(text) returns table (
  staff_id text, display_name text, full_name text, employment_role text, current_status text, pin_ready boolean
) language sql security definer set search_path = '' as $$
  select profile.id,profile.display_name,profile.full_name,profile.employment_role,'clocked_out'::text,true
  from public.staff_profiles profile where profile.active
$$;
create function public.get_attendance_state(text,timestamptz) returns jsonb language sql as $$
  select jsonb_build_object('state','clocked_out')
$$;
create function public.get_effective_clock_events(date,date,text) returns table (
  event_id uuid,event_order_key text,staff_id text,event_type text,event_timestamp timestamptz
) language sql as $$ select null::uuid,null::text,null::text,null::text,null::timestamptz where false $$;
create function public.get_manager_kiosk_statuses(date default null) returns table (staff_id text,current_status text)
language sql as $$ select null::text,null::text where false $$;
create function public.get_manager_attendance_exceptions(date,date,text default null,text default null,text default null)
returns setof jsonb language sql as $$ select null::jsonb where false $$;
create function public.get_manager_attendance_dashboard(date) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.change_device_kiosk_pin(text,text,text,text) returns table (
  ok boolean,code text,current_status text,work_week_start_date date,work_week_end_date date,
  completed_minutes integer,open_shift_in_progress boolean
) language sql as $$ select true,'changed','clocked_out',current_date,current_date,0,false $$;
create function public.record_device_kiosk_clock_event(text,text,text,text) returns void language plpgsql as $$ begin null; end $$;

insert into public.clock_events (staff_id, event_type, event_timestamp, event_source)
values ('legacy-unowned-staff', 'clock_in', '2026-08-05T08:00:00+01:00', 'kiosk');
`;

const commercialFixtureSql = `
insert into public.staff_profiles (id, organisation_id, full_name, display_name, employment_role, active)
values ('${STAFF_A2}', '${ORG_A}', 'Staff A2', 'Staff A2', 'Staff member', true);
update public.organisation_memberships set staff_id='${STAFF_A2}' where id='${MEMBERSHIP_MULTI_A}';
update public.organisation_memberships set staff_id='${STAFF_B}' where id='${MEMBERSHIP_MULTI_B}';
insert into public.staff_site_assignments (organisation_id, staff_id, site_id, effective_from, is_primary, created_by_membership_id)
values ('${ORG_A}', '${STAFF_A2}', '${SITE_A2}', '2026-08-01', true, '${MEMBERSHIP_A_OWNER}');

insert into public.kiosk_devices (
  id, device_name, token_hash, active, expires_at, activated_by,
  organisation_id, site_id, activated_by_membership_id
) values
  ('${DEVICE_A1}', 'Fictional A1 kiosk', extensions.digest('${DEVICE_TOKEN_A1}', 'sha256'), true, now() + interval '1 year', '99000000-0000-0000-0000-000000000001', '${ORG_A}', '${SITE_A1}', '${MEMBERSHIP_A_OWNER}'),
  ('${DEVICE_A2}', 'Fictional A2 kiosk', extensions.digest('${DEVICE_TOKEN_A2}', 'sha256'), true, now() + interval '1 year', '99000000-0000-0000-0000-000000000001', '${ORG_A}', '${SITE_A2}', '${MEMBERSHIP_A_OWNER}'),
  ('${DEVICE_B1}', 'Fictional B1 kiosk', extensions.digest('${DEVICE_TOKEN_B1}', 'sha256'), true, now() + interval '1 year', '99000000-0000-0000-0000-000000000001', '${ORG_B}', '${SITE_B1}', null);

insert into public.staff_kiosk_settings (staff_id, kiosk_enabled, pin_hash, pin_reset_required)
values ('${STAFF_A}', true, '4826', false), ('${STAFF_A2}', true, '4826', false), ('${STAFF_B}', true, '4826', false);
`;

export async function createAttendanceTenancyDatabase(): Promise<PGlite> {
  const db = await createCustomerDomainDatabase();
  await resetTenantDatabaseRole(db);
  await db.exec(inheritedAttendanceSql);
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_attendance_tenancy.sql"));
  if (!migration) throw new Error("attendance tenancy migration is missing");
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  await db.exec(commercialFixtureSql);
  return db;
}

export async function seedCommercialEvent(db: PGlite, input: {
  organisationId: string;
  siteId: string;
  staffId: string;
  type: "clock_in" | "clock_out";
  timestamp: string;
}) {
  await resetTenantDatabaseRole(db);
  const result = await db.query<{ id: string }>(
    `insert into public.clock_events (organisation_id, site_id, staff_id, event_type, event_timestamp, event_source)
     values ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, 'kiosk') returning id::text`,
    [input.organisationId, input.siteId, input.staffId, input.type, input.timestamp],
  );
  return result.rows[0].id;
}
