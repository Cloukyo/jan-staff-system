import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTenantPrimitivesDatabase } from "./tenant-primitives-db";

export const ONBOARDING_SESSION_A = "31000000-0000-4000-8000-000000000001";
export const ONBOARDING_SESSION_B = "32000000-0000-4000-8000-000000000001";
export const ONBOARDING_BOOTSTRAP_SESSION =
  "33000000-0000-4000-8000-000000000001";
export const ONBOARDING_STEP_A = "31000000-0000-4000-8000-000000000002";
export const ONBOARDING_EVENT_A = "31000000-0000-4000-8000-000000000003";
export const ONBOARDING_RECEIPT_A = "31000000-0000-4000-8000-000000000004";
export const ONBOARDING_IDEMPOTENCY_A = "31000000-0000-4000-8000-000000000005";

export async function createOnboardingPersistenceDatabase(): Promise<PGlite> {
  const db = await createTenantPrimitivesDatabase();
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_onboarding_workflow_persistence.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("onboarding workflow persistence migration is missing");
  }
  await db.exec(
    readFileSync(resolve("supabase/migrations", migration), "utf8"),
  );
  return db;
}

export async function createOnboardingServiceDatabase(): Promise<PGlite> {
  const db = await createOnboardingPersistenceDatabase();
  await applyOnboardingServiceMigration(db);
  return db;
}

export async function createOnboardingBootstrapDatabase(): Promise<PGlite> {
  const db = await createOnboardingServiceDatabase();
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_onboarding_bootstrap.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial onboarding bootstrap migration is missing");
  }
  await db.exec(
    readFileSync(resolve("supabase/migrations", migration), "utf8"),
  );
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
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_first_site_onboarding.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial first-site onboarding migration is missing");
  }
  await db.exec(
    readFileSync(resolve("supabase/migrations", migration), "utf8"),
  );
  return db;
}

export async function createTrialEntitlementsOnboardingDatabase(): Promise<PGlite> {
  const db = await createFirstSiteOnboardingDatabase();
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_trial_entitlements.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial trial-entitlements migration is missing");
  }
  await db.exec(
    readFileSync(resolve("supabase/migrations", migration), "utf8"),
  );
  return db;
}

export async function createInitialStaffingOnboardingDatabase(): Promise<PGlite> {
  const db = await createTrialEntitlementsOnboardingDatabase();
  await db.exec(`
    alter table public.staff_profiles
      add column if not exists email text,
      add column if not exists appointment_date date,
      add column if not exists auth_user_id uuid;
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
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_initial_staffing.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial initial-staffing migration is missing");
  }
  await db.exec(
    readFileSync(resolve("supabase/migrations", migration), "utf8"),
  );
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
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_manager_invitations.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial manager-invitations migration is missing");
  }
  const sql = readFileSync(
    resolve("supabase/migrations", migration),
    "utf8",
  ).replace(
    "create extension if not exists supabase_vault with schema vault;",
    "",
  );
  await db.exec(sql);
  return db;
}

export async function createStaffInvitationsOnboardingDatabase(): Promise<PGlite> {
  const db = await createManagerInvitationsOnboardingDatabase();
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_staff_invitations.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial staff-invitations migration is missing");
  }
  await db.exec(
    readFileSync(resolve("supabase/migrations", migration), "utf8"),
  );
  return db;
}

export async function createKioskOnboardingDatabase(): Promise<PGlite> {
  const db = await createStaffInvitationsOnboardingDatabase();
  await db.exec(`
    create or replace function extensions.gen_salt(kind text, rounds integer default 12)
    returns text language sql volatile as $$ select '$2a$12$fictionalcommercialsalt'::text $$;
    create or replace function extensions.crypt(candidate text, salt text)
    returns text language sql immutable as $$ select encode(extensions.digest(candidate || salt, 'sha256'), 'hex') $$;
    create or replace function public.kiosk_pin_is_acceptable(candidate text)
    returns boolean language sql immutable as $$
      select candidate ~ '^[0-9]{4,6}$'
        and candidate not in ('0000','1111','1234','4321','0123','9999')
        and candidate !~ '^([0-9])\\1+$'
        and not(length(candidate)=4 and candidate::integer between 1900 and 2099)
    $$;
    create table if not exists public.kiosk_devices (
      id uuid primary key default gen_random_uuid(),
      device_name text not null,
      token_hash bytea not null unique,
      active boolean not null default true,
      expires_at timestamptz not null,
      last_used_at timestamptz,
      activated_by uuid,
      activated_at timestamptz not null default now(),
      revoked_by uuid,
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      organisation_id uuid,
      site_id uuid,
      activated_by_membership_id uuid,
      revoked_by_membership_id uuid,
      offline_enabled boolean not null default false,
      hardware_verified_at timestamptz,
      unique(organisation_id,id), unique(organisation_id,site_id,id),
      foreign key(organisation_id,site_id) references public.organisation_sites(organisation_id,id),
      foreign key(organisation_id,activated_by_membership_id) references public.organisation_memberships(organisation_id,id),
      foreign key(organisation_id,revoked_by_membership_id) references public.organisation_memberships(organisation_id,id)
    );
    create table if not exists public.clock_events (
      id uuid primary key default gen_random_uuid(),
      organisation_id uuid,
      site_id uuid,
      staff_id text,
      event_type text,
      event_timestamp timestamptz not null default now()
    );
    create table if not exists public.kiosk_offline_authorisations (
      id uuid primary key default gen_random_uuid(),
      kiosk_device_id uuid not null references public.kiosk_devices(id),
      expires_at timestamptz not null,
      revoked_at timestamptz
    );
    create or replace function public.perform_commercial_kiosk_attendance_action(device_token text,target_staff_id text,candidate_pin text,requested_action text,expected_revision text,idempotency_key uuid)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare device public.kiosk_devices%rowtype;event_id uuid;
    begin
      select * into device from public.kiosk_devices where token_hash=sha256(convert_to(device_token,'UTF8')) and active;
      if not found then return jsonb_build_object('ok',false,'code','device_required');end if;
      if requested_action not in('clock_in','clock_out') then return jsonb_build_object('ok',false,'code','invalid_action');end if;
      insert into public.clock_events(organisation_id,site_id,staff_id,event_type) values(device.organisation_id,device.site_id,target_staff_id,requested_action) returning id into event_id;
      return jsonb_build_object('ok',true,'code','fixture','eventId',event_id,'state',case when requested_action='clock_in' then 'clocked_in' else 'clocked_out' end);
    end$$;
  `);
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_online_kiosk_onboarding.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial online-kiosk onboarding migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  const emptyReadinessFix = readdirSync(resolve("supabase/migrations")).find(
    (name) => name.endsWith("_fix_empty_kiosk_readiness.sql"),
  );
  if (emptyReadinessFix) {
    await db.exec(
      readFileSync(resolve("supabase/migrations", emptyReadinessFix), "utf8"),
    );
  }
  return db;
}

export async function createReadinessOnboardingDatabase(): Promise<PGlite> {
  const db = await createKioskOnboardingDatabase();
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_commercial_readiness_go_live.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial readiness and Go Live migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  return db;
}

export async function createBillingLifecycleDatabase(): Promise<PGlite> {
  const db = await createReadinessOnboardingDatabase();
  const migrationNames = readdirSync(resolve("supabase/migrations"));
  const migration = migrationNames.find((name) =>
    name.endsWith("_commercial_billing_lifecycle.sql"),
  );
  if (!migration) {
    await db.close();
    throw new Error("commercial billing-lifecycle migration is missing");
  }
  await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  const hardeningMigration = migrationNames.find((name) =>
    name.endsWith("_harden_commercial_billing_snapshot.sql"),
  );
  if (hardeningMigration) {
    await db.exec(
      readFileSync(resolve("supabase/migrations", hardeningMigration), "utf8"),
    );
  }
  const paidConversionMigration = migrationNames.find((name) =>
    name.endsWith("_activate_paid_commercial_trial.sql"),
  );
  if (paidConversionMigration) {
    await db.exec(
      readFileSync(resolve("supabase/migrations", paidConversionMigration), "utf8"),
    );
  }
  const stagingGrantHardeningMigration = migrationNames.find((name) =>
    name.endsWith("_harden_commercial_staging_function_grants.sql"),
  );
  if (stagingGrantHardeningMigration) {
    await db.exec(
      readFileSync(resolve("supabase/migrations", stagingGrantHardeningMigration), "utf8"),
    );
  }
  const guardedRlsHelperMigration = migrationNames.find((name) =>
    name.endsWith("_permit_guarded_rls_helpers.sql"),
  );
  if (guardedRlsHelperMigration) {
    await db.exec(
      readFileSync(resolve("supabase/migrations", guardedRlsHelperMigration), "utf8"),
    );
  }
  const kioskOperationalStateMigration = migrationNames.find((name) =>
    name.endsWith("_align_commercial_kiosk_operational_state.sql"),
  );
  if (kioskOperationalStateMigration) {
    await db.exec(
      readFileSync(resolve("supabase/migrations", kioskOperationalStateMigration), "utf8"),
    );
  }
  return db;
}

export async function applyOnboardingServiceMigration(
  db: PGlite,
): Promise<void> {
  await db.exec(`
    create schema if not exists extensions;
    create or replace function extensions.digest(candidate text, algorithm text)
    returns bytea language sql immutable as $$
      select decode(md5(candidate) || md5(algorithm || ':' || candidate), 'hex')
    $$
  `);
  const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
    name.endsWith("_onboarding_application_service_foundation.sql"),
  );
  if (!migration) {
    throw new Error("onboarding application service migration is missing");
  }
  await db.exec(
    readFileSync(resolve("supabase/migrations", migration), "utf8"),
  );
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
    [
      values.id,
      values.ownerAuthUserId,
      values.organisationId,
      values.currentStepKey ?? "owner_account",
    ],
  );
}
