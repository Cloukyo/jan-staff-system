import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { USER_A_OWNER, USER_B_OWNER, resetTenantDatabaseRole, setTenantAuthUser } from "./helpers/tenant-primitives-db";
import { createTrialEntitlementsOnboardingDatabase } from "./helpers/onboarding-persistence-db";

const KEYS = {
  legal: "63000000-0000-4000-8000-000000000001",
  organisation: "63000000-0000-4000-8000-000000000002",
  site: "63000000-0000-4000-8000-000000000003",
  trial: "63000000-0000-4000-8000-000000000004",
};

type Bootstrap = {
  session: { id: string; organisationId: string | null; revision: string; currentStepKey: string };
  steps: Array<{ stepKey: string; status: string }>;
  legalDocuments: Array<{ documentType: string; documentVersion: string; locale: string }>;
  planCatalogue: Array<{ planKey: string; planVersion: number; trialDurationDays: number; pricingStatus: string }>;
  subscriptionSummary: null | { subscriptionId: string; state: string; trialStartedAt: null; trialEndsAt: null };
};

async function bootstrap(db: PGlite): Promise<Bootstrap> {
  return (await db.query<{ result: Bootstrap }>("select public.get_or_create_onboarding_bootstrap() result")).rows[0].result;
}
function envelope(session: Bootstrap["session"], commandType: string, key: string, payload: unknown) {
  return { schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1,
    sessionId: session.id, commandType, idempotencyKey: key, expectedSessionRevision: session.revision, payload };
}
async function execute(db: PGlite, command: unknown) {
  return (await db.query<{ result: { commandResult: { outcome: string; resultCode: string; dataState: string; resultReference: Record<string, unknown> }; bootstrap: Bootstrap } }>(
    "select public.execute_onboarding_bootstrap_command($1::jsonb) result", [JSON.stringify(command)],
  )).rows[0].result;
}
function organisationPayload() {
  return { displayName: "Northstar Demonstration Operations", legalName: "Northstar Demonstration Operations Limited",
    contactEmail: "owner@example.invalid", country: "GB", timezone: "Europe/London",
    postalAddress: { line1: "1 Fictional Way", locality: "Exampleton", postcode: "ZZ1 1ZZ" } };
}
function sitePayload() {
  return { siteName: "Northstar Central", contactPhone: "+44 20 7946 0999", country: "GB", timezone: "Europe/London",
    postalAddress: { line1: "7 Fictional Square", locality: "Exampleton", postcode: "ZZ2 2ZZ" },
    openingHours: Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1,
      intervals: index < 5 ? [{ opensAt: "08:00", closesAt: "18:00" }] : [] })),
    workWeekStarts: 1, operationalDayBoundary: "04:00" };
}
async function siteReady(db: PGlite) {
  let state = await bootstrap(db);
  state = (await execute(db, envelope(state.session, "accept_legal_documents", KEYS.legal, {
    acceptances: state.legalDocuments.map((document) => ({ documentType: document.documentType,
      documentVersion: document.documentVersion, locale: document.locale })), safeRequestMetadata: { source: "commercial_onboarding" },
  }))).bootstrap;
  state = (await execute(db, envelope(state.session, "create_organisation", KEYS.organisation, organisationPayload()))).bootstrap;
  return (await execute(db, envelope(state.session, "create_first_site", KEYS.site, sitePayload()))).bootstrap;
}

describe("commercial trial-pending and entitlement persistence", () => {
  let db: PGlite;
  beforeEach(async () => { db = await createTrialEntitlementsOnboardingDatabase(); await setTenantAuthUser(db, USER_A_OWNER, "aal2"); }, 30_000);
  afterEach(async () => { await db?.close(); });

  it("presents only active Preview plans and adds one durable subscription step", async () => {
    const state = await siteReady(db);
    expect(state.steps.map((step) => step.stepKey)).toEqual(["owner_security", "legal_acceptance", "organisation", "first_site", "subscription"]);
    expect(state.planCatalogue).toEqual([expect.objectContaining({ planKey: "preview_standard", planVersion: 1, trialDurationDays: 60, pricingStatus: "preview_unpriced" })]);
  });

  it("atomically creates one trial_pending subscription and authoritative entitlements without starting the clock", async () => {
    const state = await siteReady(db);
    const command = envelope(state.session, "select_plan", KEYS.trial, { planKey: "preview_standard", planVersion: 1, selection: "free_trial" });
    const created = await execute(db, command);
    const replay = await execute(db, command);
    expect(created.commandResult).toMatchObject({ outcome: "succeeded", resultCode: "trial_pending_created", dataState: "saved" });
    expect(replay.commandResult).toMatchObject({ outcome: "replayed", resultCode: "trial_pending_created" });
    expect(created.bootstrap.subscriptionSummary).toMatchObject({ state: "trial_pending", trialStartedAt: null, trialEndsAt: null });
    expect(created.bootstrap.session.currentStepKey).toBe("settings");
    await resetTenantDatabaseRole(db);
    const stored = (await db.query<{ subscriptions: number; entitlements: number; offline: boolean; started: string | null; ends: string | null }>(`
      select count(distinct subscription.id)::int subscriptions,
        count(entitlement.capability_key)::int entitlements,
        bool_or(entitlement.capability_key = 'attendance.offline' and entitlement.boolean_value) offline,
        max(subscription.trial_started_at)::text started, max(subscription.trial_ends_at)::text ends
      from public.organisation_subscriptions subscription
      join public.organisation_entitlements entitlement on entitlement.organisation_id = subscription.organisation_id and entitlement.subscription_id = subscription.id
      where subscription.organisation_id = $1 group by subscription.organisation_id`, [state.session.organisationId])).rows[0];
    expect(stored).toMatchObject({ subscriptions: 1, offline: false, started: null, ends: null });
    expect(stored.entitlements).toBeGreaterThan(5);
  });

  it("rejects altered idempotent payload, stale tabs, AAL1 and unknown plans", async () => {
    let state = await siteReady(db);
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    expect((await execute(db, envelope(state.session, "select_plan", KEYS.trial, { planKey: "preview_standard", planVersion: 1, selection: "free_trial" }))).commandResult)
      .toMatchObject({ resultCode: "mfa_required", dataState: "not_saved" });
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    state = await bootstrap(db);
    expect((await execute(db, { ...envelope(state.session, "select_plan", "63000000-0000-4000-8000-000000000011", { planKey: "preview_standard", planVersion: 1, selection: "free_trial" }), expectedSessionRevision: "0" })).commandResult)
      .toMatchObject({ resultCode: "stale_session_revision" });
    state = await bootstrap(db);
    expect((await execute(db, envelope(state.session, "select_plan", "63000000-0000-4000-8000-000000000012", { planKey: "unknown_plan", planVersion: 1, selection: "free_trial" }))).commandResult)
      .toMatchObject({ resultCode: "plan_unavailable" });
  });

  it("denies another organisation and direct entitlement tampering", async () => {
    const state = await siteReady(db);
    await setTenantAuthUser(db, USER_B_OWNER, "aal2");
    expect((await db.query("select id from public.organisation_subscriptions where organisation_id = $1", [state.session.organisationId])).rows).toEqual([]);
    await expect(db.query(`insert into public.organisation_entitlements
      (organisation_id, subscription_id, capability_key, value_type, boolean_value)
      values ($1, '63000000-0000-4000-8000-000000000099', 'attendance.offline', 'boolean', true)`, [state.session.organisationId])).rejects.toThrow();
  });

  it("keeps capability decisions separate from tenant access and offline permanently denied", async () => {
    const state = await siteReady(db);
    const created = await execute(db, envelope(state.session, "select_plan", KEYS.trial, { planKey: "preview_standard", planVersion: 1, selection: "free_trial" }));
    const organisationId = created.bootstrap.session.organisationId;
    const offline = (await db.query<{ result: { allowed: boolean; decisionCode: string; grantsTenantAccess: boolean } }>(
      "select public.commercial_capability_decision($1, 'attendance.offline', '{}'::jsonb) result", [organisationId],
    )).rows[0].result;
    expect(offline).toEqual(expect.objectContaining({ allowed: false, decisionCode: "offline_disabled", grantsTenantAccess: false }));

    const pendingCore = (await db.query<{ result: { allowed: boolean; decisionCode: string } }>(
      "select public.commercial_capability_decision($1, 'attendance.core', '{}'::jsonb) result", [organisationId],
    )).rows[0].result;
    expect(pendingCore).toEqual(expect.objectContaining({ allowed: false, decisionCode: "subscription_not_eligible" }));

    await expect(db.query(
      "select public.commercial_capability_decision($1, 'sites.active.limit', '{\"requestedUnits\":0}'::jsonb)", [organisationId],
    )).rejects.toThrow(/invalid capability context/i);

    await resetTenantDatabaseRole(db);
    const subscription = (await db.query<{ id: string }>(`select id from public.organisation_subscriptions
      where organisation_id = $1 and is_current`, [organisationId])).rows[0];
    const membership = (await db.query<{ id: string }>(`select id from public.organisation_memberships
      where organisation_id = $1 and auth_user_id = $2 and status = 'active'`, [organisationId, USER_A_OWNER])).rows[0];
    await db.query(`select private.transition_commercial_subscription(
      $1,'trial_pending','trial_active',true,'2026-08-13T00:00:00Z','2026-10-12T00:00:00Z',null,
      'go_live_trial_activation',$2)`, [subscription.id, membership.id]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    expect((await db.query<{ result: { allowed: boolean; decisionCode: string } }>(
      "select public.commercial_capability_decision($1, 'attendance.core', '{}'::jsonb) result", [organisationId],
    )).rows[0].result).toMatchObject({ allowed: true, decisionCode: "allowed" });
    expect((await db.query<{ result: { allowed: boolean; decisionCode: string; currentUsage: number } }>(
      "select public.commercial_capability_decision($1, 'sites.active.limit', '{\"requestedUnits\":3}'::jsonb) result", [organisationId],
    )).rows[0].result).toMatchObject({ allowed: false, decisionCode: "limit_reached", currentUsage: 1 });
    expect((await db.query<{ result: { allowed: boolean; decisionCode: string } }>(
      "select public.commercial_capability_decision($1, 'unknown.feature', '{}'::jsonb) result", [organisationId],
    )).rows[0].result).toMatchObject({ allowed: false, decisionCode: "not_entitled" });
  });

  it("protects trial identity and exact plan-entitlement source history", async () => {
    const state = await siteReady(db);
    const created = await execute(db, envelope(state.session, "select_plan", KEYS.trial, { planKey: "preview_standard", planVersion: 1, selection: "free_trial" }));
    const organisationId = created.bootstrap.session.organisationId;
    await resetTenantDatabaseRole(db);
    await expect(db.query("update public.organisation_subscriptions set ordinary_initial_trial = false where organisation_id = $1", [organisationId]))
      .rejects.toThrow(/immutable/i);
    await expect(db.query("delete from public.organisation_subscriptions where organisation_id = $1", [organisationId]))
      .rejects.toThrow(/append-only/i);
    await expect(db.query(`update public.organisation_entitlements set integer_value = integer_value + 1
      where organisation_id = $1 and capability_key = 'sites.active.limit'`, [organisationId]))
      .rejects.toThrow(/exactly match/i);
    await expect(db.query("update public.plans set summary = 'Changed' where plan_key = 'preview_standard' and plan_version = 1"))
      .rejects.toThrow(/new version/i);
    await expect(db.query(`update public.plan_entitlements set integer_value = 4
      where plan_key = 'preview_standard' and plan_version = 1 and capability_key = 'sites.active.limit'`))
      .rejects.toThrow(/new version/i);
    await expect(db.query("update public.organisation_subscriptions set state = 'cancelled' where organisation_id = $1", [organisationId]))
      .rejects.toThrow(/audited transition/i);
    const history = (await db.query<{ reason_code: string; from_state: string | null; to_state: string }>(`
      select reason_code,from_state,to_state from public.organisation_subscription_state_events
      where organisation_id = $1 order by occurred_at,id`, [organisationId])).rows;
    expect(history).toEqual([{ reason_code: "subscription_created", from_state: null, to_state: "trial_pending" }]);
    await expect(db.query(`update public.organisation_subscription_state_events set reason_code = 'changed'
      where organisation_id = $1`, [organisationId])).rejects.toThrow(/append-only/i);
  });

  it("returns a stable result when another current subscription already exists", async () => {
    const state = await siteReady(db);
    await resetTenantDatabaseRole(db);
    const membership = (await db.query<{ id: string }>(`select id from public.organisation_memberships
      where organisation_id = $1 and auth_user_id = $2 and status = 'active'`, [state.session.organisationId, USER_A_OWNER])).rows[0];
    await db.query(`insert into public.organisation_subscriptions
      (organisation_id,plan_key,plan_version,state,is_current,ordinary_initial_trial,created_by_membership_id)
      values ($1,'preview_standard',1,'active',true,false,$2)`, [state.session.organisationId, membership.id]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    expect((await execute(db, envelope(state.session, "select_plan", KEYS.trial, { planKey: "preview_standard", planVersion: 1, selection: "free_trial" }))).commandResult)
      .toMatchObject({ outcome: "validation_failed", resultCode: "subscription_not_eligible", dataState: "not_saved" });
  });
});
