import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export const ORG_A = "10000000-0000-0000-0000-000000000001";
export const ORG_B = "20000000-0000-0000-0000-000000000001";
export const SITE_A1 = "11000000-0000-0000-0000-000000000001";
export const SITE_A2 = "11000000-0000-0000-0000-000000000002";
export const SITE_B1 = "21000000-0000-0000-0000-000000000001";
export const USER_A_OWNER = "a0000000-0000-0000-0000-000000000001";
export const USER_A_ADMIN = "a0000000-0000-0000-0000-000000000002";
export const USER_A_SITE_MANAGER = "a0000000-0000-0000-0000-000000000003";
export const USER_MULTI = "a0000000-0000-0000-0000-000000000004";
export const USER_B_OWNER = "b0000000-0000-0000-0000-000000000001";
export const MEMBERSHIP_A_OWNER = "aa000000-0000-0000-0000-000000000001";
export const MEMBERSHIP_A_ADMIN = "aa000000-0000-0000-0000-000000000002";
export const MEMBERSHIP_A_SITE_MANAGER = "aa000000-0000-0000-0000-000000000003";
export const MEMBERSHIP_MULTI_A = "aa000000-0000-0000-0000-000000000004";
export const MEMBERSHIP_MULTI_B = "bb000000-0000-0000-0000-000000000004";
export const MEMBERSHIP_B_OWNER = "bb000000-0000-0000-0000-000000000001";
export const STAFF_A = "tenant-staff-a";
export const STAFF_B = "tenant-staff-b";
export const LEGACY_STAFF = "legacy-unowned-staff";

const migrationPath = resolve(
  "supabase/migrations/20260805195409_tenant_primitives.sql",
);

const prerequisiteSql = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;

create table auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.staff_profiles (
  id text primary key,
  full_name text not null,
  display_name text not null,
  employment_role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.staff_profiles (id, full_name, display_name, employment_role)
values ('${LEGACY_STAFF}', 'Legacy Person', 'Legacy', 'Staff member');
`;

const fixtureSql = `
insert into auth.users (id, email) values
  ('${USER_A_OWNER}', 'owner-a@example.test'),
  ('${USER_A_ADMIN}', 'admin-a@example.test'),
  ('${USER_A_SITE_MANAGER}', 'manager-a@example.test'),
  ('${USER_MULTI}', 'multi@example.test'),
  ('${USER_B_OWNER}', 'owner-b@example.test');

insert into public.organisations (id, legal_name, display_name, slug, status) values
  ('${ORG_A}', 'Organisation A Limited', 'Organisation A', 'organisation-a', 'active'),
  ('${ORG_B}', 'Organisation B Limited', 'Organisation B', 'organisation-b', 'active');

insert into public.organisation_sites (id, organisation_id, name, slug) values
  ('${SITE_A1}', '${ORG_A}', 'Site A1', 'site-a1'),
  ('${SITE_A2}', '${ORG_A}', 'Site A2', 'site-a2'),
  ('${SITE_B1}', '${ORG_B}', 'Site B1', 'site-b1');

insert into public.staff_profiles (id, organisation_id, full_name, display_name, employment_role) values
  ('${STAFF_A}', '${ORG_A}', 'Staff A', 'Staff A', 'Staff member'),
  ('${STAFF_B}', '${ORG_B}', 'Staff B', 'Staff B', 'Staff member');

insert into public.organisation_memberships (id, organisation_id, auth_user_id, staff_id, status, joined_at) values
  ('${MEMBERSHIP_A_OWNER}', '${ORG_A}', '${USER_A_OWNER}', null, 'active', now()),
  ('${MEMBERSHIP_A_ADMIN}', '${ORG_A}', '${USER_A_ADMIN}', null, 'active', now()),
  ('${MEMBERSHIP_A_SITE_MANAGER}', '${ORG_A}', '${USER_A_SITE_MANAGER}', '${STAFF_A}', 'active', now()),
  ('${MEMBERSHIP_MULTI_A}', '${ORG_A}', '${USER_MULTI}', null, 'active', now()),
  ('${MEMBERSHIP_MULTI_B}', '${ORG_B}', '${USER_MULTI}', null, 'active', now()),
  ('${MEMBERSHIP_B_OWNER}', '${ORG_B}', '${USER_B_OWNER}', null, 'active', now());

insert into public.membership_role_assignments (organisation_id, membership_id, role, scope_type, site_id, granted_by_membership_id) values
  ('${ORG_A}', '${MEMBERSHIP_A_OWNER}', 'organisation_owner', 'organisation', null, '${MEMBERSHIP_A_OWNER}'),
  ('${ORG_A}', '${MEMBERSHIP_A_ADMIN}', 'organisation_admin', 'organisation', null, '${MEMBERSHIP_A_OWNER}'),
  ('${ORG_A}', '${MEMBERSHIP_A_SITE_MANAGER}', 'site_manager', 'site', '${SITE_A1}', '${MEMBERSHIP_A_OWNER}'),
  ('${ORG_A}', '${MEMBERSHIP_MULTI_A}', 'staff', 'organisation', null, '${MEMBERSHIP_A_OWNER}'),
  ('${ORG_B}', '${MEMBERSHIP_MULTI_B}', 'staff', 'organisation', null, '${MEMBERSHIP_B_OWNER}'),
  ('${ORG_B}', '${MEMBERSHIP_B_OWNER}', 'organisation_owner', 'organisation', null, '${MEMBERSHIP_B_OWNER}');

insert into public.membership_site_access (organisation_id, membership_id, site_id, granted_by_membership_id) values
  ('${ORG_A}', '${MEMBERSHIP_A_SITE_MANAGER}', '${SITE_A1}', '${MEMBERSHIP_A_OWNER}');

insert into public.staff_site_assignments (organisation_id, staff_id, site_id, effective_from, is_primary, created_by_membership_id) values
  ('${ORG_A}', '${STAFF_A}', '${SITE_A1}', '2026-08-01', true, '${MEMBERSHIP_A_OWNER}'),
  ('${ORG_B}', '${STAFF_B}', '${SITE_B1}', '2026-08-01', true, '${MEMBERSHIP_B_OWNER}');

insert into public.organisation_settings (organisation_id) values ('${ORG_A}'), ('${ORG_B}');
insert into public.site_settings (organisation_id, site_id) values ('${ORG_A}', '${SITE_A1}'), ('${ORG_A}', '${SITE_A2}'), ('${ORG_B}', '${SITE_B1}');

insert into public.organisation_invitations (
  id, organisation_id, invited_email, token_hash, status, expires_at, invited_by_membership_id
) values
  ('a1000000-0000-0000-0000-000000000001', '${ORG_A}', 'invite-a@example.test', decode(repeat('aa', 32), 'hex'), 'pending', now() + interval '7 days', '${MEMBERSHIP_A_OWNER}'),
  ('b1000000-0000-0000-0000-000000000001', '${ORG_B}', 'invite-b@example.test', decode(repeat('bb', 32), 'hex'), 'pending', now() + interval '7 days', '${MEMBERSHIP_B_OWNER}');

insert into public.organisation_invitation_roles (organisation_id, invitation_id, role, scope_type, site_id) values
  ('${ORG_A}', 'a1000000-0000-0000-0000-000000000001', 'site_manager', 'site', '${SITE_A1}'),
  ('${ORG_B}', 'b1000000-0000-0000-0000-000000000001', 'site_manager', 'site', '${SITE_B1}');

insert into public.organisation_invitation_site_access (organisation_id, invitation_id, site_id) values
  ('${ORG_A}', 'a1000000-0000-0000-0000-000000000001', '${SITE_A1}'),
  ('${ORG_B}', 'b1000000-0000-0000-0000-000000000001', '${SITE_B1}');
`;

export async function createTenantPrimitivesDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(prerequisiteSql);
  await db.exec(readFileSync(migrationPath, "utf8"));
  await db.exec(fixtureSql);
  return db;
}

export async function setTenantAuthUser(db: PGlite, authUserId: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [authUserId ?? ""]);
  await db.exec("set role authenticated");
}

export async function resetTenantDatabaseRole(db: PGlite) {
  await db.exec("reset role");
}

export async function organisationIds(db: PGlite): Promise<string[]> {
  const result = await db.query<{ id: string }>("select id from public.organisations order by id");
  return result.rows.map((row) => row.id);
}

export async function siteIds(db: PGlite): Promise<string[]> {
  const result = await db.query<{ id: string }>("select id from public.organisation_sites order by id");
  return result.rows.map((row) => row.id);
}

export async function privateBoolean(
  db: PGlite,
  functionName: "is_active_member" | "has_permission" | "has_site_permission",
  args: string[],
): Promise<boolean> {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(", ");
  const result = await db.query<{ allowed: boolean }>(
    `select private.${functionName}(${placeholders}) as allowed`,
    args,
  );
  return result.rows[0].allowed;
}
