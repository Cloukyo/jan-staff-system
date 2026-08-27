import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTenantPrimitivesDatabase,
  MEMBERSHIP_A_OWNER,
  MEMBERSHIP_B_OWNER,
  ORG_A,
  ORG_B,
  SITE_A1,
  SITE_A2,
  SITE_B1,
  STAFF_A,
  STAFF_B,
} from "./tenant-primitives-db";

const inheritedDomainSql = `
create type public.evidence_status as enum ('not_required', 'awaiting', 'received', 'verified');
alter table public.staff_profiles add column email text;
alter table public.staff_profiles add column notes text;
alter table public.staff_profiles enable row level security;

create table public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id),
  auth_user_id uuid,
  role text not null default 'staff'
);

insert into public.staff_accounts (id, staff_id, role)
values ('99000000-0000-0000-0000-000000000001', 'legacy-unowned-staff', 'manager');

create or replace function public.current_staff_account()
returns public.staff_accounts language sql stable as $$
  select account from public.staff_accounts account
  where account.staff_id = nullif(current_setting('test.legacy_staff_id', true), '') limit 1;
$$;

create or replace function public.current_staff_role()
returns text language sql stable as $$
  select nullif(current_setting('test.legacy_role', true), '');
$$;

create or replace function public.current_staff_profile_id()
returns text language sql stable as $$
  select nullif(current_setting('test.legacy_staff_id', true), '');
$$;

create table public.staff_qualifications (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id),
  qualification_name text not null, archived_at timestamptz
);
create table public.staff_certificates (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id),
  certificate_type text not null, archived_at timestamptz
);
create table public.staff_central_records (
  id uuid primary key default gen_random_uuid(), staff_id text not null unique references public.staff_profiles(id), notes text
);
create table public.staff_central_record_items (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id), item_key text not null,
  unique (staff_id, item_key)
);
create table public.staff_reference_checks (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id), archived_at timestamptz
);
create table public.staff_import_reviews (
  id uuid primary key default gen_random_uuid(), imported_staff_id text references public.staff_profiles(id), source_file_name text not null
);
create table public.staff_pay_arrangements (
  id uuid primary key default gen_random_uuid(), staff_id text not null references public.staff_profiles(id), effective_from date not null,
  created_by uuid not null references public.staff_accounts(id), updated_by uuid not null references public.staff_accounts(id)
);

alter table public.staff_qualifications enable row level security;
alter table public.staff_certificates enable row level security;
alter table public.staff_central_records enable row level security;
alter table public.staff_central_record_items enable row level security;
alter table public.staff_reference_checks enable row level security;
alter table public.staff_import_reviews enable row level security;
alter table public.staff_pay_arrangements enable row level security;

create policy "Managers can manage qualifications" on public.staff_qualifications for all to authenticated
using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Staff can read own qualifications" on public.staff_qualifications for select to authenticated
using (staff_id = public.current_staff_profile_id() and archived_at is null);
create policy "Managers can manage certificates" on public.staff_certificates for all to authenticated
using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Staff can read own certificates" on public.staff_certificates for select to authenticated
using (staff_id = public.current_staff_profile_id() and archived_at is null);
create policy "Managers can manage central records" on public.staff_central_records for all to authenticated
using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Managers can manage central record items" on public.staff_central_record_items for all to authenticated
using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Managers can manage reference checks" on public.staff_reference_checks for all to authenticated
using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Managers can manage import reviews" on public.staff_import_reviews for all to authenticated
using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Managers can manage pay arrangements" on public.staff_pay_arrangements for all to authenticated
using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');

grant select, insert, update on all tables in schema public to authenticated;
`;

const fixtureSql = `
insert into public.staff_qualifications (staff_id, qualification_name) values
  ('${STAFF_A}', 'Organisation A qualification'),
  ('${STAFF_B}', 'Organisation B qualification'),
  ('legacy-unowned-staff', 'Legacy qualification');

insert into public.organisation_compliance_modules (organisation_id, module_id, enabled_by_membership_id) values
  ('${ORG_A}', 'early_years_uk', '${MEMBERSHIP_A_OWNER}'),
  ('${ORG_B}', 'clinical_uk', '${MEMBERSHIP_B_OWNER}');

insert into public.work_areas (organisation_id, site_id, name, code) values
  ('${ORG_A}', '${SITE_A1}', 'Blue', 'blue'),
  ('${ORG_A}', '${SITE_A2}', 'Green', 'green'),
  ('${ORG_B}', '${SITE_B1}', 'Clinical', 'clinical');
`;

export async function createCustomerDomainDatabase(): Promise<PGlite> {
  const db = await createTenantPrimitivesDatabase();
  await db.exec(inheritedDomainSql);
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_customer_domain_conversion.sql"));
  if (!migration) throw new Error("customer domain migration is missing");
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  await db.exec(fixtureSql);
  return db;
}

export async function setLegacyManager(db: PGlite, staffId = "legacy-unowned-staff") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.query("select set_config('test.legacy_role', 'manager', false)");
  await db.query("select set_config('test.legacy_staff_id', $1, false)", [staffId]);
  await db.exec("set role authenticated");
}
