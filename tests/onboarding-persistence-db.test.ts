import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMBERSHIP_A_OWNER,
  ORG_A,
  ORG_B,
  USER_A_OWNER,
  USER_A_SITE_MANAGER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import {
  ONBOARDING_BOOTSTRAP_SESSION,
  ONBOARDING_EVENT_A,
  ONBOARDING_IDEMPOTENCY_A,
  ONBOARDING_RECEIPT_A,
  ONBOARDING_SESSION_A,
  ONBOARDING_SESSION_B,
  ONBOARDING_STEP_A,
  createOnboardingPersistenceDatabase,
  insertOnboardingSession,
} from "./helpers/onboarding-persistence-db";

describe("commercial onboarding persistence", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createOnboardingPersistenceDatabase();
  }, 30_000);

  afterEach(async () => {
    await db?.close();
  });

  it("persists only the exact versioned workflow and step contracts", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
      currentStepKey: "settings",
    });
    await db.query(
      `insert into public.onboarding_step_states (
         id, session_id, organisation_id, step_key, step_version, status,
         revision, draft_payload, validation_summary
       ) values ($1, $2, $3, 'settings', 1, 'in_progress', 0,
         '{"workWeekStart":"monday"}'::jsonb,
         '[{"code":"invalid_value","message":"Choose a supported value.","fieldPath":["workWeekStart"]}]'::jsonb)`,
      [ONBOARDING_STEP_A, ONBOARDING_SESSION_A, ORG_A],
    );

    await expect(db.query(
      `insert into public.onboarding_sessions (
         owner_auth_user_id, workflow_key, workflow_version, status, current_step_key
       ) values ($1, 'commercial_customer_v1', 2, 'in_progress', 'settings')`,
      [USER_B_OWNER],
    )).rejects.toThrow();
    await expect(db.query(
      `insert into public.onboarding_step_states (
         session_id, organisation_id, step_key, step_version, status, draft_payload, validation_summary
       ) values ($1, $2, 'settings', 1, 'in_progress', '{"staffPin":"1234"}'::jsonb, '[]'::jsonb)`,
      [ONBOARDING_SESSION_A, ORG_A],
    )).rejects.toThrow(/sensitive|draft/i);
    await expect(db.query(
      `insert into public.onboarding_step_states (
         session_id, organisation_id, step_key, step_version, status, draft_payload, validation_summary
       ) values ($1, $2, 'staff', 1, 'in_progress', '{}'::jsonb, '[{}]'::jsonb)`,
      [ONBOARDING_SESSION_A, ORG_A],
    )).rejects.toThrow(/validation|check constraint/i);
  });

  it("limits bootstrap reads to the authenticated owner and denies direct writes", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_BOOTSTRAP_SESSION,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: null,
    });

    await setTenantAuthUser(db, USER_A_OWNER);
    expect((await db.query<{ id: string }>("select id from public.onboarding_sessions")).rows)
      .toEqual([{ id: ONBOARDING_BOOTSTRAP_SESSION }]);
    await expect(db.query(
      "update public.onboarding_sessions set current_step_key = 'organisation', revision = 1 where id = $1",
      [ONBOARDING_BOOTSTRAP_SESSION],
    )).rejects.toThrow(/permission denied/i);

    await setTenantAuthUser(db, USER_B_OWNER);
    expect((await db.query("select id from public.onboarding_sessions")).rows).toEqual([]);
  });

  it("uses membership permission after organisation linkage without an owner bypass", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
    });
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_B,
      ownerAuthUserId: USER_B_OWNER,
      organisationId: ORG_B,
    });

    await setTenantAuthUser(db, USER_A_OWNER);
    expect((await db.query<{ id: string }>("select id from public.onboarding_sessions order by id")).rows)
      .toEqual([{ id: ONBOARDING_SESSION_A }]);

    await setTenantAuthUser(db, USER_A_SITE_MANAGER);
    expect((await db.query("select id from public.onboarding_sessions")).rows).toEqual([]);

    await resetTenantDatabaseRole(db);
    await db.query(
      "delete from private.role_permissions where role = 'organisation_owner' and permission = 'onboarding.read'",
    );
    await setTenantAuthUser(db, USER_A_OWNER);
    expect((await db.query("select id from public.onboarding_sessions")).rows).toEqual([]);
  });

  it("lets an authorised member read every safe child store through RLS", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
    });
    await db.query(
      `insert into public.onboarding_step_states (
         id, session_id, organisation_id, step_key, step_version, status,
         revision, draft_payload, validation_summary
       ) values ($1, $2, $3, 'settings', 1, 'in_progress', 0, '{}'::jsonb, '[]'::jsonb)`,
      [ONBOARDING_STEP_A, ONBOARDING_SESSION_A, ORG_A],
    );
    await db.query(
      `insert into public.onboarding_events (
         id, session_id, organisation_id, event_type, actor_type,
         workflow_revision, safe_metadata
       ) values ($1, $2, $3, 'readiness_evaluated', 'system', 0, '{}'::jsonb)`,
      [ONBOARDING_EVENT_A, ONBOARDING_SESSION_A, ORG_A],
    );
    await db.query(
      `insert into public.onboarding_command_receipts (
         id, session_id, organisation_id, command_type, idempotency_key,
         request_hash, status
       ) values ($1, $2, $3, 'evaluate_readiness', $4, $5, 'processing')`,
      [ONBOARDING_RECEIPT_A, ONBOARDING_SESSION_A, ORG_A, ONBOARDING_IDEMPOTENCY_A, "d".repeat(64)],
    );

    await setTenantAuthUser(db, USER_A_OWNER);
    for (const table of [
      "onboarding_step_states",
      "onboarding_events",
      "onboarding_command_receipts",
    ]) {
      expect((await db.query<{ session_id: string }>(
        `select session_id from public.${table}`,
      )).rows, table).toEqual([{ session_id: ONBOARDING_SESSION_A }]);
    }
  });

  it("rejects cross-organisation child rows with composite tenant fences", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
    });
    await expect(db.query(
      `insert into public.onboarding_step_states (
         session_id, organisation_id, step_key, step_version, status, draft_payload, validation_summary
       ) values ($1, $2, 'settings', 1, 'in_progress', '{}'::jsonb, '[]'::jsonb)`,
      [ONBOARDING_SESSION_A, ORG_B],
    )).rejects.toThrow();
    await expect(db.query(
      `insert into public.onboarding_events (
         session_id, organisation_id, event_type, actor_type, workflow_revision, safe_metadata
       ) values ($1, $2, 'settings_completed', 'system', 0, '{}'::jsonb)`,
      [ONBOARDING_SESSION_A, ORG_B],
    )).rejects.toThrow();
  });

  it("links bootstrap step and receipt ownership once without permitting re-parenting", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_BOOTSTRAP_SESSION,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: null,
    });
    await db.query(
      `insert into public.onboarding_step_states (
         session_id, organisation_id, step_key, step_version, status,
         revision, draft_payload, validation_summary
       ) values ($1, null, 'organisation', 1, 'in_progress', 0, '{}'::jsonb, '[]'::jsonb)`,
      [ONBOARDING_BOOTSTRAP_SESSION],
    );
    await db.query(
      `insert into public.onboarding_command_receipts (
         session_id, organisation_id, command_type, idempotency_key,
         request_hash, status
       ) values ($1, null, 'create_organisation', $2, $3, 'processing')`,
      [ONBOARDING_BOOTSTRAP_SESSION, ONBOARDING_IDEMPOTENCY_A, "c".repeat(64)],
    );
    await db.query(
      `insert into public.onboarding_command_receipts (
         session_id, organisation_id, command_type, idempotency_key,
         request_hash, status, result_code, completed_at
       ) values
         ($1, null, 'complete_owner_setup', '31000000-0000-4000-8000-000000000091',
          $2, 'succeeded', 'owner_setup_completed', now()),
         ($1, null, 'save_step_draft', '31000000-0000-4000-8000-000000000092',
          $3, 'failed_final', 'draft_rejected', now())`,
      [ONBOARDING_BOOTSTRAP_SESSION, "d".repeat(64), "e".repeat(64)],
    );

    await db.query(
      `update public.onboarding_sessions
       set organisation_id = $1, current_step_key = 'organisation', revision = 1
       where id = $2`,
      [ORG_A, ONBOARDING_BOOTSTRAP_SESSION],
    );
    expect((await db.query<{ organisation_id: string; revision: string }>(
      `select organisation_id, revision::text
       from public.onboarding_step_states where session_id = $1`,
      [ONBOARDING_BOOTSTRAP_SESSION],
    )).rows).toEqual([{ organisation_id: ORG_A, revision: "1" }]);
    expect((await db.query<{ organisation_id: string }>(
      `select organisation_id
       from public.onboarding_command_receipts where session_id = $1
       order by command_type`,
      [ONBOARDING_BOOTSTRAP_SESSION],
    )).rows).toEqual([
      { organisation_id: ORG_A },
      { organisation_id: ORG_A },
      { organisation_id: ORG_A },
    ]);
    await expect(db.query(
      `update public.onboarding_command_receipts
       set status = 'succeeded', result_code = 'organisation_created',
           result_reference = jsonb_build_object('siteId', $2::text), completed_at = now()
       where session_id = $1 and command_type = 'create_organisation'`,
      [ONBOARDING_BOOTSTRAP_SESSION, "31000000-0000-4000-8000-000000000099"],
    )).resolves.toBeDefined();

    await expect(db.query(
      `update public.onboarding_step_states
       set organisation_id = $1, revision = 2 where session_id = $2`,
      [ORG_B, ONBOARDING_BOOTSTRAP_SESSION],
    )).rejects.toThrow(/organisation|ownership/i);
  });

  it("enforces exact optimistic revision increments and immutable Go Live evidence", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
    });
    await expect(db.query(
      "update public.onboarding_sessions set current_step_key = 'settings', revision = 2 where id = $1",
      [ONBOARDING_SESSION_A],
    )).rejects.toThrow(/revision/i);
    await db.query(
      "update public.onboarding_sessions set current_step_key = 'settings', revision = 1 where id = $1",
      [ONBOARDING_SESSION_A],
    );
    await db.query(
      "update public.onboarding_sessions set status = 'live', go_live_at = now(), revision = 2 where id = $1",
      [ONBOARDING_SESSION_A],
    );
    await expect(db.query(
      "update public.onboarding_sessions set go_live_at = now() + interval '1 hour', revision = 3 where id = $1",
      [ONBOARDING_SESSION_A],
    )).rejects.toThrow(/go.live|immutable/i);
  });

  it("keeps onboarding events append-only and rejects unsafe metadata", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
    });
    await db.query(
      `insert into public.onboarding_events (
         id, session_id, organisation_id, event_type, step_key, actor_type,
         actor_auth_user_id, actor_membership_id, request_id,
         workflow_revision, safe_metadata
       ) values ($1, $2, $3, 'settings_completed', 'settings', 'owner',
         $4, $5, $6, 0, '{"statusCode":"complete","resourceCounts":{"settings":1}}'::jsonb)`,
      [ONBOARDING_EVENT_A, ONBOARDING_SESSION_A, ORG_A, USER_A_OWNER, MEMBERSHIP_A_OWNER, ONBOARDING_IDEMPOTENCY_A],
    );
    await expect(db.query(
      "update public.onboarding_events set safe_metadata = '{}'::jsonb where id = $1",
      [ONBOARDING_EVENT_A],
    )).rejects.toThrow(/append.only|immutable/i);
    await expect(db.query(
      "delete from public.onboarding_events where id = $1",
      [ONBOARDING_EVENT_A],
    )).rejects.toThrow(/append.only|immutable/i);
    await expect(db.query(
      `insert into public.onboarding_events (
         session_id, organisation_id, event_type, actor_type, workflow_revision, safe_metadata
       ) values ($1, $2, 'readiness_evaluated', 'system', 0, '{"email":"example@example.invalid"}'::jsonb)`,
      [ONBOARDING_SESSION_A, ORG_A],
    )).rejects.toThrow(/metadata|safe/i);
  });

  it("binds command idempotency to one request and freezes terminal replay results", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
    });
    await db.query(
      `insert into public.onboarding_command_receipts (
         id, session_id, organisation_id, command_type, idempotency_key,
         request_hash, status
       ) values ($1, $2, $3, 'save_settings', $4, $5, 'processing')`,
      [ONBOARDING_RECEIPT_A, ONBOARDING_SESSION_A, ORG_A, ONBOARDING_IDEMPOTENCY_A, "a".repeat(64)],
    );
    await expect(db.query(
      `insert into public.onboarding_command_receipts (
         session_id, organisation_id, command_type, idempotency_key, request_hash, status
       ) values ($1, $2, 'save_settings', $3, $4, 'processing')`,
      [ONBOARDING_SESSION_A, ORG_A, ONBOARDING_IDEMPOTENCY_A, "b".repeat(64)],
    )).rejects.toThrow();

    await db.query(
      `update public.onboarding_command_receipts
       set status = 'succeeded', result_code = 'settings_saved',
           result_reference = '{"siteId":"31000000-0000-4000-8000-000000000099"}'::jsonb,
           completed_at = now()
       where id = $1`,
      [ONBOARDING_RECEIPT_A],
    );
    await expect(db.query(
      `update public.onboarding_command_receipts
       set result_code = 'changed_result' where id = $1`,
      [ONBOARDING_RECEIPT_A],
    )).rejects.toThrow(/terminal|immutable|replay/i);
  });

  it("allows authenticated reads but no direct writes to any onboarding store", async () => {
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
    });
    await setTenantAuthUser(db, USER_A_OWNER);
    for (const table of [
      "onboarding_sessions",
      "onboarding_step_states",
      "onboarding_events",
      "onboarding_command_receipts",
    ]) {
      await expect(db.query(`delete from public.${table}`), table)
        .rejects.toThrow(/permission denied/i);
    }
  });
});
