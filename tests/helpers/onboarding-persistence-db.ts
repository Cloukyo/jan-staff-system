import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTenantPrimitivesDatabase } from "./tenant-primitives-db";

export const ONBOARDING_SESSION_A = "31000000-0000-4000-8000-000000000001";
export const ONBOARDING_SESSION_B = "32000000-0000-4000-8000-000000000001";
export const ONBOARDING_BOOTSTRAP_SESSION = "33000000-0000-4000-8000-000000000001";
export const ONBOARDING_STEP_A = "31000000-0000-4000-8000-000000000002";
export const ONBOARDING_EVENT_A = "31000000-0000-4000-8000-000000000003";
export const ONBOARDING_RECEIPT_A = "31000000-0000-4000-8000-000000000004";
export const ONBOARDING_IDEMPOTENCY_A = "31000000-0000-4000-8000-000000000005";

export async function createOnboardingPersistenceDatabase(): Promise<PGlite> {
  const db = await createTenantPrimitivesDatabase();
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_onboarding_workflow_persistence.sql"));
  if (!migration) {
    await db.close();
    throw new Error("onboarding workflow persistence migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  return db;
}

export async function createOnboardingServiceDatabase(): Promise<PGlite> {
  const db = await createOnboardingPersistenceDatabase();
  await applyOnboardingServiceMigration(db);
  return db;
}

export async function createOnboardingBootstrapDatabase(): Promise<PGlite> {
  const db = await createOnboardingServiceDatabase();
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_commercial_onboarding_bootstrap.sql"));
  if (!migration) {
    await db.close();
    throw new Error("commercial onboarding bootstrap migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  return db;
}

export async function createFirstSiteOnboardingDatabase(): Promise<PGlite> {
  const db = await createOnboardingBootstrapDatabase();
  // The tenant fixture replays the minimal prerequisite chain. Mirror the
  // additive customer-domain columns consumed by the first-site defaults.
  await db.exec(`
    alter table public.organisation_settings
      add column if not exists operating_defaults jsonb not null default '{}'::jsonb,
      add column if not exists staffing_defaults jsonb not null default '{}'::jsonb;
    alter table public.site_settings
      add column if not exists timezone_override text,
      add column if not exists work_week_starts_override smallint check (work_week_starts_override between 1 and 7),
      add column if not exists operating_overrides jsonb not null default '{}'::jsonb,
      add column if not exists staffing_overrides jsonb not null default '{}'::jsonb;
  `);
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_commercial_first_site_onboarding.sql"));
  if (!migration) {
    await db.close();
    throw new Error("commercial first-site onboarding migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  return db;
}

export async function createTrialEntitlementsOnboardingDatabase(): Promise<PGlite> {
  const db = await createFirstSiteOnboardingDatabase();
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_commercial_trial_entitlements.sql"));
  if (!migration) {
    await db.close();
    throw new Error("commercial trial-entitlements migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  return db;
}

export async function createInitialStaffingOnboardingDatabase(): Promise<PGlite> {
  const db = await createTrialEntitlementsOnboardingDatabase();
  await db.exec(`
    alter table public.staff_profiles
      add column if not exists email text,
      add column if not exists appointment_date date;
    do $$ begin create type public.staff_import_batch_status as enum ('previewing','preview_ready','invalid','committed'); exception when duplicate_object then null; end $$;
    do $$ begin create type public.staff_import_row_status as enum ('valid','invalid','committed'); exception when duplicate_object then null; end $$;
    create table if not exists public.staff_import_batches (
      id uuid primary key default gen_random_uuid(), organisation_id uuid not null, site_id uuid not null,
      idempotency_key text not null, request_hash text not null, status public.staff_import_batch_status not null default 'previewing',
      total_rows integer not null default 0, valid_rows integer not null default 0, invalid_rows integer not null default 0,
      created_by_membership_id uuid not null, committed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique(organisation_id,id), unique(organisation_id,idempotency_key),
      foreign key(organisation_id,site_id) references public.organisation_sites(organisation_id,id),
      foreign key(organisation_id,created_by_membership_id) references public.organisation_memberships(organisation_id,id));
    create table if not exists public.staff_import_rows (
      id uuid primary key default gen_random_uuid(), organisation_id uuid not null, batch_id uuid not null, site_id uuid not null,
      source_row text not null, external_key text not null, proposed_staff_id text not null, status public.staff_import_row_status not null,
      input_data jsonb not null, normalised_data jsonb not null, validation_errors jsonb not null default '[]', imported_staff_id text, created_at timestamptz not null default now(),
      unique(organisation_id,id), unique(organisation_id,batch_id,external_key),
      foreign key(organisation_id,batch_id) references public.staff_import_batches(organisation_id,id),
      foreign key(organisation_id,site_id) references public.organisation_sites(organisation_id,id),
      foreign key(organisation_id,imported_staff_id) references public.staff_profiles(organisation_id,id));
    create table if not exists public.staff_kiosk_settings (
      staff_id text primary key references public.staff_profiles(id), kiosk_enabled boolean not null default true,
      pin_hash text, pin_updated_at timestamptz, pin_reset_required boolean not null default true,
      failed_attempt_count integer not null default 0, locked_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  `);
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_commercial_initial_staffing.sql"));
  if (!migration) {
    await db.close();
    throw new Error("commercial initial-staffing migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  return db;
}

export async function createManagerInvitationsOnboardingDatabase(): Promise<PGlite> {
  const db = await createInitialStaffingOnboardingDatabase();
  await db.exec(`
    create or replace function extensions.gen_random_bytes(length integer)
    returns bytea language sql volatile as $$
      select decode(substr(md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), 1, length * 2), 'hex')
    $$;
    create schema vault;
    create table vault.secrets (
      id uuid primary key default gen_random_uuid(), secret text not null, name text unique,
      description text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
    returns uuid language plpgsql security definer as $$
    declare secret_id uuid;
    begin
      insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description) returning id into secret_id;
      return secret_id;
    end $$;
    create view vault.decrypted_secrets as select id,secret,decrypted_secret,name,description,created_at,updated_at
      from (select id,secret,secret decrypted_secret,name,description,created_at,updated_at from vault.secrets) secrets;
  `);
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_commercial_manager_invitations.sql"));
  if (!migration) {
    await db.close();
    throw new Error("commercial manager-invitations migration is missing");
  }
  const sql = readFileSync(resolve("supabase/migrations", migration), "utf8")
    .replace("create extension if not exists supabase_vault with schema vault;", "");
  await db.exec(sql);
  return db;
}

export async function applyOnboardingServiceMigration(db: PGlite): Promise<void> {
  await db.exec(`
    create schema if not exists extensions;
    create or replace function extensions.digest(candidate text, algorithm text)
    returns bytea language sql immutable as $$
      select decode(md5(candidate) || md5(algorithm || ':' || candidate), 'hex')
    $$
  `);
  const migration = readdirSync(resolve("supabase/migrations"))
    .find((name) => name.endsWith("_onboarding_application_service_foundation.sql"));
  if (!migration) {
    throw new Error("onboarding application service migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
}

export async function insertOnboardingSession(
  db: PGlite,
  values: {
    id: string;
    ownerAuthUserId: string;
    organisationId: string | null;
    currentStepKey?: string;
  },
) {
  await db.query(
    `insert into public.onboarding_sessions (
       id, owner_auth_user_id, organisation_id, workflow_key, workflow_version,
       status, current_step_key, revision
     ) values ($1, $2, $3, 'commercial_customer_v1', 1, 'in_progress', $4, 0)`,
    [values.id, values.ownerAuthUserId, values.organisationId, values.currentStepKey ?? "owner_account"],
  );
}
