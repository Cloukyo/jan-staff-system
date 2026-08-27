import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  USER_A_OWNER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import { createOnboardingBootstrapDatabase } from "./helpers/onboarding-persistence-db";

const LEGAL_KEY = "61000000-0000-4000-8000-000000000001";
const ORGANISATION_KEY = "61000000-0000-4000-8000-000000000002";

type Bootstrap = {
  session: { id: string; organisationId: string | null; revision: string; currentStepKey: string };
  security: { emailVerified: boolean; assuranceLevel: string; legalAcceptancesCurrent: boolean };
  steps: Array<{ stepKey: string; status: string }>;
  legalDocuments: Array<{ documentType: string; documentVersion: string; locale: string }>;
};

async function bootstrap(db: PGlite): Promise<Bootstrap> {
  return (await db.query<{ result: Bootstrap }>(
    "select public.get_or_create_onboarding_bootstrap() as result",
  )).rows[0].result;
}

function envelope(session: Bootstrap["session"], commandType: string, idempotencyKey: string, payload: unknown) {
  return {
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: session.id,
    commandType,
    idempotencyKey,
    expectedSessionRevision: session.revision,
    payload,
  };
}

async function execute(db: PGlite, command: unknown) {
  return (await db.query<{ result: { commandResult: Record<string, unknown> & { resultReference: Record<string, unknown> }; bootstrap: Bootstrap } }>(
    "select public.execute_onboarding_bootstrap_command($1::jsonb) as result",
    [JSON.stringify(command)],
  )).rows[0].result;
}

function currentAcceptances(state: Bootstrap) {
  return {
    acceptances: state.legalDocuments.map((document) => ({
      documentType: document.documentType,
      documentVersion: document.documentVersion,
      locale: document.locale,
    })),
    safeRequestMetadata: { source: "commercial_onboarding" },
  };
}

function organisationPayload() {
  return {
    displayName: "Northstar Demonstration Operations",
    legalName: "Northstar Demonstration Operations Limited",
    contactEmail: "owner@example.invalid",
    country: "GB",
    timezone: "Europe/London",
    postalAddress: {
      line1: "1 Fictional Way",
      locality: "Exampleton",
      postcode: "ZZ1 1ZZ",
    },
  };
}

describe("commercial onboarding bootstrap persistence", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createOnboardingBootstrapDatabase();
  }, 30_000);

  afterEach(async () => {
    await db?.close();
  });

  it("creates and resumes exactly one owner bootstrap with the three durable 7A steps", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    const first = await bootstrap(db);
    const refreshed = await bootstrap(db);

    expect(refreshed.session.id).toBe(first.session.id);
    expect(first.steps.map((step) => step.stepKey)).toEqual([
      "owner_security", "legal_acceptance", "organisation",
    ]);
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: string }>(
      "select count(*)::text as count from public.onboarding_sessions where owner_auth_user_id = $1 and status <> 'abandoned'",
      [USER_A_OWNER],
    )).rows[0].count).toBe("1");
  });

  it("serialises concurrent bootstrap requests into one active owner session", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    const [first, second] = await Promise.all([bootstrap(db), bootstrap(db)]);
    expect(second.session.id).toBe(first.session.id);
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: string }>(
      "select count(*)::text count from public.onboarding_sessions where owner_auth_user_id = $1 and status <> 'abandoned'",
      [USER_A_OWNER],
    )).rows[0].count).toBe("1");
  });

  it("denies anonymous bootstrap and prevents another user enumerating the session", async () => {
    await expect(bootstrap(db)).rejects.toThrow();
    await setTenantAuthUser(db, USER_A_OWNER);
    const owner = await bootstrap(db);
    await setTenantAuthUser(db, USER_B_OWNER);
    expect((await db.query("select id from public.onboarding_sessions where id = $1", [owner.session.id])).rows)
      .toEqual([]);
  });

  it("records immutable current legal versions idempotently without sensitive metadata", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const state = await bootstrap(db);
    const command = envelope(state.session, "accept_legal_documents", LEGAL_KEY, currentAcceptances(state));
    const first = await execute(db, command);
    const replay = await execute(db, command);

    expect(first.commandResult).toMatchObject({ outcome: "succeeded", resultCode: "legal_acceptance_completed" });
    expect(replay.commandResult).toMatchObject({ outcome: "replayed", resultCode: "legal_acceptance_completed" });
    await resetTenantDatabaseRole(db);
    const records = (await db.query<{ document_type: string; request_metadata: unknown }>(
      "select document_type, request_metadata from public.legal_acceptances where auth_user_id = $1 order by document_type",
      [USER_A_OWNER],
    )).rows;
    expect(records).toHaveLength(3);
    expect(JSON.stringify(records)).not.toMatch(/email|address|token|secret|pin/i);
    await expect(db.query("update public.legal_acceptances set locale = 'en' where auth_user_id = $1", [USER_A_OWNER]))
      .rejects.toThrow();
  });

  it("requires reacceptance when a later legal document version becomes current", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    let state = await bootstrap(db);
    state = (await execute(db, envelope(state.session, "accept_legal_documents", LEGAL_KEY, currentAcceptances(state)))).bootstrap;
    expect(state.security.legalAcceptancesCurrent).toBe(true);
    await resetTenantDatabaseRole(db);
    await db.query("update public.legal_document_versions set is_current = false where document_type = 'terms_of_service' and locale = 'en-GB'");
    await db.query(`insert into public.legal_document_versions
      (document_type, document_version, locale, title, summary, effective_at, is_current)
      values ('terms_of_service', '2026-09', 'en-GB', 'Terms of Service', 'Updated fictional commercial terms.', now(), true)`);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    expect((await bootstrap(db)).security.legalAcceptancesCurrent).toBe(false);
  });

  it("blocks organisation creation for unverified email, AAL1 and missing or outdated legal acceptance", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    let state = await bootstrap(db);
    await resetTenantDatabaseRole(db);
    await db.query("update auth.users set email_confirmed_at = null where id = $1", [USER_A_OWNER]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    expect((await execute(db, envelope(state.session, "create_organisation", ORGANISATION_KEY, organisationPayload()))).commandResult)
      .toMatchObject({ resultCode: "email_verification_required", dataState: "not_saved" });

    await resetTenantDatabaseRole(db);
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [USER_A_OWNER]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    state = await bootstrap(db);
    expect((await execute(db, envelope(state.session, "create_organisation", "61000000-0000-4000-8000-000000000003", organisationPayload()))).commandResult)
      .toMatchObject({ resultCode: "mfa_required", dataState: "not_saved" });

    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    state = await bootstrap(db);
    expect((await execute(db, envelope(state.session, "create_organisation", "61000000-0000-4000-8000-000000000004", organisationPayload()))).commandResult)
      .toMatchObject({ resultCode: "legal_acceptance_required", dataState: "not_saved" });
  });

  it("atomically creates one organisation, active owner membership, owner role, defaults and no site", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    let state = await bootstrap(db);
    const accepted = await execute(db, envelope(state.session, "accept_legal_documents", LEGAL_KEY, currentAcceptances(state)));
    state = accepted.bootstrap;
    const command = envelope(state.session, "create_organisation", ORGANISATION_KEY, organisationPayload());
    const created = await execute(db, command);
    const replay = await execute(db, command);

    expect(created.commandResult).toMatchObject({ outcome: "succeeded", resultCode: "organisation_created" });
    expect(replay.commandResult).toMatchObject({ outcome: "replayed", resultCode: "organisation_created" });
    expect(created.bootstrap.session).toMatchObject({ currentStepKey: "first_site" });
    await resetTenantDatabaseRole(db);
    const counts = (await db.query<{ organisations: number; memberships: number; roles: number; settings: number; sites: number }>(`
      select
        (select count(*)::int from public.organisations where display_name = 'Northstar Demonstration Operations') organisations,
        (select count(*)::int from public.organisation_memberships where auth_user_id = $1 and status = 'active') memberships,
        (select count(*)::int from public.membership_role_assignments role join public.organisation_memberships membership on membership.id = role.membership_id where membership.auth_user_id = $1 and role.role = 'organisation_owner' and role.scope_type = 'organisation' and role.revoked_at is null) roles,
        (select count(*)::int from public.organisation_settings settings join public.organisation_memberships membership using (organisation_id) where membership.auth_user_id = $1) settings,
        (select count(*)::int from public.organisation_sites site join public.organisation_memberships membership using (organisation_id) where membership.auth_user_id = $1) sites
    `, [USER_A_OWNER])).rows[0];
    expect(counts).toEqual({ organisations: 1, memberships: 2, roles: 2, settings: 2, sites: 2 });
    // The fixture already contains one organisation membership/role/settings and two sites for this user.
    const createdOrganisationId = String(created.commandResult.resultReference.organisationId);
    const owner = (await db.query<{ auth_user_id: string; staff_id: string | null; status: string }>(
      "select auth_user_id, staff_id, status from public.organisation_memberships where organisation_id = $1",
      [createdOrganisationId],
    )).rows[0];
    expect(owner).toEqual({ auth_user_id: USER_A_OWNER, staff_id: null, status: "active" });

    await setTenantAuthUser(db, USER_B_OWNER, "aal2");
    expect((await db.query("select id from public.organisations where id = $1", [createdOrganisationId])).rows).toEqual([]);
  });

  it("rolls back every organisation-side effect when the atomic transaction fails", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    let state = await bootstrap(db);
    state = (await execute(db, envelope(state.session, "accept_legal_documents", LEGAL_KEY, currentAcceptances(state)))).bootstrap;
    await resetTenantDatabaseRole(db);
    await db.exec(`
      create or replace function pg_temp.reject_onboarding_defaults() returns trigger language plpgsql as $$
      begin raise exception 'fictional forced failure'; end $$;
      create trigger reject_onboarding_defaults before insert on public.organisation_settings
      for each row when (new.organisation_id not in ('${"10000000-0000-0000-0000-000000000001"}'::uuid, '${"20000000-0000-0000-0000-000000000001"}'::uuid))
      execute function pg_temp.reject_onboarding_defaults();
    `);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(execute(db, envelope(state.session, "create_organisation", ORGANISATION_KEY, organisationPayload())))
      .rejects.toThrow(/forced failure/i);
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: string }>(
      "select count(*)::text count from public.organisations where display_name = 'Northstar Demonstration Operations'",
    )).rows[0].count).toBe("0");
    expect((await db.query<{ organisation_id: string | null }>(
      "select organisation_id from public.onboarding_sessions where id = $1", [state.session.id],
    )).rows[0].organisation_id).toBeNull();
  });

  it("rejects changed idempotent payloads and stale revisions without creating an organisation", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    let state = await bootstrap(db);
    state = (await execute(db, envelope(state.session, "accept_legal_documents", LEGAL_KEY, currentAcceptances(state)))).bootstrap;
    const staleRevision = (Number(state.session.revision) - 1).toString();
    const stale = await execute(db, {
      ...envelope(state.session, "create_organisation", ORGANISATION_KEY, organisationPayload()),
      expectedSessionRevision: staleRevision,
    });
    expect(stale.commandResult).toMatchObject({ outcome: "workflow_changed", resultCode: "stale_session_revision" });
    const staleReplay = await execute(db, {
      ...envelope(state.session, "create_organisation", ORGANISATION_KEY, organisationPayload()),
      expectedSessionRevision: staleRevision,
    });
    expect(staleReplay.commandResult).toMatchObject({
      outcome: "workflow_changed",
      dataState: "not_saved",
      resultCode: "stale_session_revision",
    });

    const valid = envelope(state.session, "create_organisation", ORGANISATION_KEY, organisationPayload());
    await execute(db, valid);
    const changed = await execute(db, {
      ...valid,
      payload: { ...organisationPayload(), displayName: "Changed Demonstration Operations" },
    });
    expect(changed.commandResult).toMatchObject({ outcome: "validation_failed", resultCode: "idempotency_key_reused" });
  });

  it("rejects organisation payloads missing required contact or address fields at the RPC boundary", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    let state = await bootstrap(db);
    state = (await execute(db, envelope(state.session, "accept_legal_documents", LEGAL_KEY, currentAcceptances(state)))).bootstrap;
    const withoutContactEmail = { ...organisationPayload() } as Partial<ReturnType<typeof organisationPayload>>;
    delete withoutContactEmail.contactEmail;
    const incomplete = {
      ...withoutContactEmail,
      phone: "+44 20 7946 0999",
      postalAddress: { line2: "Fictional Suite", region: "Example County", postcode: "ZZ1 1ZZ" },
    };

    const result = await execute(db, envelope(
      state.session,
      "create_organisation",
      "61000000-0000-4000-8000-000000000005",
      incomplete,
    ));
    expect(result.commandResult).toMatchObject({
      outcome: "validation_failed",
      dataState: "not_saved",
      resultCode: "invalid_organisation_details",
    });
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: string }>(
      "select count(*)::text count from public.organisations where display_name = 'Northstar Demonstration Operations'",
    )).rows[0].count).toBe("0");
  });

  it("denies direct event and receipt mutations to authenticated customers", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const state = await bootstrap(db);
    await expect(db.query(
      "insert into public.onboarding_events (session_id, event_type, actor_type, actor_auth_user_id, workflow_revision) values ($1, 'signup_started', 'owner', $2, 0)",
      [state.session.id, USER_A_OWNER],
    )).rejects.toThrow();
    await expect(db.query(
      "insert into public.onboarding_command_receipts (session_id, command_type, idempotency_key, request_hash, status) values ($1, 'create_organisation', $2, $3, 'processing')",
      [state.session.id, ORGANISATION_KEY, "a".repeat(64)],
    )).rejects.toThrow();
  });
});
