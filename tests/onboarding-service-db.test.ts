import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMBERSHIP_A_OWNER,
  ORG_A,
  USER_A_OWNER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import {
  ONBOARDING_SESSION_A,
  applyOnboardingServiceMigration,
  createOnboardingPersistenceDatabase,
  createOnboardingServiceDatabase,
  insertOnboardingSession,
} from "./helpers/onboarding-persistence-db";

const IDEMPOTENCY_A = "52000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_B = "52000000-0000-4000-8000-000000000002";

type RpcResult = {
  commandResult: {
    outcome: string;
    dataState: string;
    resultCode: string;
    resultReference: Record<string, unknown>;
    sessionRevision: string;
  };
  readiness: {
    overallStatus: string;
    workflowRevision: string;
    items: Array<{
      itemKey: string;
      result: string;
      reasonCode: string;
    }>;
  };
};

function draftCommand(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: ONBOARDING_SESSION_A,
    commandType: "save_step_draft",
    idempotencyKey: IDEMPOTENCY_A,
    expectedSessionRevision: "0",
    payload: {
      stepKey: "settings",
      expectedStepRevision: "0",
      draftPayload: {
        workWeekStart: "monday",
        contactEmail: "fictional-contact@example.invalid",
      },
      validationSummary: [],
    },
    ...overrides,
  };
}

async function executeCommand(db: PGlite, command: Record<string, unknown>): Promise<RpcResult> {
  const result = await db.query<{ result: RpcResult }>(
    "select public.execute_onboarding_foundation_command($1::jsonb) as result",
    [JSON.stringify(command)],
  );
  return result.rows[0].result;
}

describe("onboarding application service migration upgrade", () => {
  it("backfills terminal persistence receipts before enforcing result-state constraints", async () => {
    const db = await createOnboardingPersistenceDatabase();
    try {
      await insertOnboardingSession(db, {
        id: ONBOARDING_SESSION_A,
        ownerAuthUserId: USER_A_OWNER,
        organisationId: ORG_A,
      });
      await db.query(
        `insert into public.onboarding_command_receipts (
           session_id, organisation_id, command_type, idempotency_key,
           request_hash, status, result_code, completed_at
         ) values ($1, $2, 'evaluate_readiness', $3, $4, 'succeeded',
                   'readiness_evaluated', now())`,
        [ONBOARDING_SESSION_A, ORG_A, IDEMPOTENCY_A, "a".repeat(64)],
      );

      await applyOnboardingServiceMigration(db);

      expect((await db.query<{
        result_outcome: string;
        result_data_state: string;
        result_session_revision: string;
      }>(
        `select result_outcome, result_data_state, result_session_revision::text
         from public.onboarding_command_receipts`,
      )).rows).toEqual([{
        result_outcome: "succeeded",
        result_data_state: "saved",
        result_session_revision: "0",
      }]);
    } finally {
      await db.close();
    }
  }, 30_000);
});

describe("onboarding application service transaction", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createOnboardingServiceDatabase();
    await insertOnboardingSession(db, {
      id: ONBOARDING_SESSION_A,
      ownerAuthUserId: USER_A_OWNER,
      organisationId: ORG_A,
      currentStepKey: "settings",
    });
    await setTenantAuthUser(db, USER_A_OWNER);
  }, 30_000);

  afterEach(async () => {
    await db?.close();
  });

  it("atomically saves a draft, advances revisions, records a receipt and appends a safe readiness event", async () => {
    const result = await executeCommand(db, draftCommand());

    expect(result.commandResult).toMatchObject({
      outcome: "succeeded",
      dataState: "saved",
      resultCode: "step_draft_saved",
      sessionRevision: "1",
    });
    expect(result.readiness.workflowRevision).toBe("1");
    expect(result.readiness.overallStatus).not.toBe("ready");
    expect(result.readiness.items.map((item) => item.itemKey)).toEqual([
      "owner_identity",
      "legal_acceptance",
      "organisation",
      "owner_membership",
      "first_site",
      "operational_settings",
      "commercial_access",
      "attendance_policy",
      "pin_policy",
      "eligible_staff",
      "online_kiosk",
      "kiosk_roster",
      "offline_disabled",
      "security_health",
      "command_health",
    ]);
    expect(result.readiness.items.find((item) => item.itemKey === "offline_disabled"))
      .toMatchObject({ result: "pass", reasonCode: "offline_disabled" });

    await resetTenantDatabaseRole(db);
    expect((await db.query<{ revision: string; current_step_key: string }>(
      "select revision::text, current_step_key from public.onboarding_sessions where id = $1",
      [ONBOARDING_SESSION_A],
    )).rows).toEqual([{ revision: "1", current_step_key: "settings" }]);
    expect((await db.query<{ revision: string; draft_payload: Record<string, unknown> }>(
      "select revision::text, draft_payload from public.onboarding_step_states where session_id = $1",
      [ONBOARDING_SESSION_A],
    )).rows).toEqual([{
      revision: "0",
      draft_payload: {
        workWeekStart: "monday",
        contactEmail: "fictional-contact@example.invalid",
      },
    }]);
    expect((await db.query<{ count: string }>(
      "select count(*)::text as count from public.onboarding_command_receipts where session_id = $1",
      [ONBOARDING_SESSION_A],
    )).rows[0].count).toBe("1");
    const events = (await db.query<{ safe_metadata: Record<string, unknown> }>(
      "select safe_metadata from public.onboarding_events where session_id = $1",
      [ONBOARDING_SESSION_A],
    )).rows;
    expect(events).toEqual([{
      safe_metadata: {
        statusCode: "in_progress",
        resultCodes: ["readiness_blocked"],
      },
    }]);
    expect(JSON.stringify(events)).not.toContain("fictional-contact");
  });

  it("replays the successful result without duplicating state, receipts or events", async () => {
    const first = await executeCommand(db, draftCommand());
    const replay = await executeCommand(db, draftCommand());

    expect(first.commandResult.outcome).toBe("succeeded");
    expect(replay.commandResult).toMatchObject({
      outcome: "replayed",
      dataState: "saved",
      resultCode: "step_draft_saved",
      sessionRevision: "1",
    });
    await resetTenantDatabaseRole(db);
    const counts = await db.query<{ steps: number; receipts: number; events: number }>(`
      select
        (select count(*)::int from public.onboarding_step_states where session_id = $1) as steps,
        (select count(*)::int from public.onboarding_command_receipts where session_id = $1) as receipts,
        (select count(*)::int from public.onboarding_events where session_id = $1) as events
    `, [ONBOARDING_SESSION_A]);
    expect(counts.rows[0]).toEqual({ steps: 1, receipts: 1, events: 1 });
  });

  it("rejects reuse of an idempotency key for different command data", async () => {
    await executeCommand(db, draftCommand());
    const reused = await executeCommand(db, draftCommand({
      expectedSessionRevision: "1",
      payload: {
        stepKey: "settings",
        expectedStepRevision: "0",
        draftPayload: { workWeekStart: "sunday" },
        validationSummary: [],
      },
    }));

    expect(reused.commandResult).toMatchObject({
      outcome: "validation_failed",
      dataState: "not_saved",
      resultCode: "idempotency_key_reused",
      sessionRevision: "1",
    });
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ receipts: number; events: number }>(`
      select
        (select count(*)::int from public.onboarding_command_receipts where session_id = $1) as receipts,
        (select count(*)::int from public.onboarding_events where session_id = $1) as events
    `, [ONBOARDING_SESSION_A])).rows[0]).toEqual({ receipts: 1, events: 1 });
  });

  it("records later-phase commands as unavailable without executing their workflow", async () => {
    const blocked = await executeCommand(db, draftCommand({
      commandType: "go_live",
      payload: {},
    }));

    expect(blocked.commandResult).toMatchObject({
      outcome: "capability_denied",
      dataState: "not_saved",
      resultCode: "command_not_available_in_foundation",
      sessionRevision: "0",
    });
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ revision: string; events: number }>(`
      select session.revision::text,
             (select count(*)::int from public.onboarding_events event
              where event.session_id = session.id) as events
      from public.onboarding_sessions session where session.id = $1
    `, [ONBOARDING_SESSION_A])).rows[0]).toEqual({ revision: "0", events: 0 });
  });

  it("rejects a stale session revision without changing the saved draft", async () => {
    await executeCommand(db, draftCommand());
    const stale = await executeCommand(db, draftCommand({
      idempotencyKey: IDEMPOTENCY_B,
      payload: {
        stepKey: "settings",
        expectedStepRevision: "0",
        draftPayload: { workWeekStart: "sunday" },
        validationSummary: [],
      },
    }));

    expect(stale.commandResult).toMatchObject({
      outcome: "workflow_changed",
      dataState: "not_saved",
      resultCode: "stale_session_revision",
      sessionRevision: "1",
    });
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ draft_payload: Record<string, unknown> }>(
      "select draft_payload from public.onboarding_step_states where session_id = $1",
      [ONBOARDING_SESSION_A],
    )).rows[0].draft_payload).toMatchObject({ workWeekStart: "monday" });
  });

  it("reports an in-flight duplicate as indeterminate and blocks command-health readiness", async () => {
    const pendingCommand = draftCommand();
    await resetTenantDatabaseRole(db);
    await db.query(`
      insert into public.onboarding_command_receipts (
        session_id, organisation_id, command_type, idempotency_key, request_hash, status
      ) values ($1, $2, 'save_step_draft', $3,
        private.onboarding_request_digest($4::jsonb), 'processing')
    `, [ONBOARDING_SESSION_A, ORG_A, IDEMPOTENCY_A, JSON.stringify(pendingCommand)]);
    await setTenantAuthUser(db, USER_A_OWNER);

    const result = await executeCommand(db, pendingCommand);

    expect(result.commandResult).toMatchObject({
      outcome: "indeterminate",
      dataState: "unknown",
      resultCode: "command_in_progress",
      sessionRevision: "0",
    });
    expect(result.readiness.items.find((item) => item.itemKey === "command_health"))
      .toMatchObject({ result: "blocked", reasonCode: "command_state_indeterminate" });
  });

  it("fails closed for an unrelated tenant identity before creating a receipt", async () => {
    await setTenantAuthUser(db, USER_B_OWNER);
    const result = await executeCommand(db, draftCommand());

    expect(result.commandResult).toMatchObject({
      outcome: "permission_denied",
      dataState: "not_saved",
      resultCode: "permission_denied",
    });
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: string }>(
      "select count(*)::text as count from public.onboarding_command_receipts where session_id = $1",
      [ONBOARDING_SESSION_A],
    )).rows[0].count).toBe("0");
  });

  it("records the acting membership from the authenticated tenant context", async () => {
    await executeCommand(db, draftCommand());
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ actor_membership_id: string }>(
      "select actor_membership_id from public.onboarding_events where session_id = $1",
      [ONBOARDING_SESSION_A],
    )).rows).toEqual([{ actor_membership_id: MEMBERSHIP_A_OWNER }]);
  });
});
