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
