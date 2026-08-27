import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { USER_A_OWNER, USER_B_OWNER, resetTenantDatabaseRole, setTenantAuthUser } from "./helpers/tenant-primitives-db";
import { createFirstSiteOnboardingDatabase } from "./helpers/onboarding-persistence-db";

const LEGAL_KEY = "62000000-0000-4000-8000-000000000001";
const ORGANISATION_KEY = "62000000-0000-4000-8000-000000000002";
const SITE_KEY = "62000000-0000-4000-8000-000000000003";

type Bootstrap = {
  session: { id: string; organisationId: string | null; revision: string; currentStepKey: string };
  steps: Array<{ stepKey: string; status: string; draftPayload: Record<string, unknown> }>;
  legalDocuments: Array<{ documentType: string; documentVersion: string; locale: string }>;
};

async function bootstrap(db: PGlite): Promise<Bootstrap> {
  return (await db.query<{ result: Bootstrap }>("select public.get_or_create_onboarding_bootstrap() as result")).rows[0].result;
}

function envelope(session: Bootstrap["session"], commandType: string, idempotencyKey: string, payload: unknown) {
  return { schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1,
    sessionId: session.id, commandType, idempotencyKey, expectedSessionRevision: session.revision, payload };
}

async function execute(db: PGlite, command: unknown) {
  return (await db.query<{ result: { commandResult: Record<string, unknown> & { resultReference: Record<string, unknown> }; bootstrap: Bootstrap } }>(
    "select public.execute_onboarding_bootstrap_command($1::jsonb) as result", [JSON.stringify(command)],
  )).rows[0].result;
}

function organisationPayload() {
  return { displayName: "Northstar Demonstration Operations", legalName: "Northstar Demonstration Operations Limited",
    contactEmail: "owner@example.invalid", country: "GB", timezone: "Europe/London",
    postalAddress: { line1: "1 Fictional Way", locality: "Exampleton", postcode: "ZZ1 1ZZ" } };
}

function sitePayload() {
  return { siteName: "Northstar Central", displayName: "Central", contactPhone: "+44 20 7946 0999",
    siteEmail: "central@example.invalid", country: "GB", timezone: "Europe/London",
    postalAddress: { line1: "7 Fictional Square", locality: "Exampleton", postcode: "ZZ2 2ZZ" },
    openingHours: Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1,
      intervals: index < 5 ? [{ opensAt: "08:00", closesAt: "18:00" }] : [] })),
    workWeekStarts: 1, operationalDayBoundary: "04:00" };
}

async function organisationReady(db: PGlite): Promise<Bootstrap> {
  let state = await bootstrap(db);
  state = (await execute(db, envelope(state.session, "accept_legal_documents", LEGAL_KEY, {
    acceptances: state.legalDocuments.map((document) => ({ documentType: document.documentType,
      documentVersion: document.documentVersion, locale: document.locale })),
    safeRequestMetadata: { source: "commercial_onboarding" },
  }))).bootstrap;
  return (await execute(db, envelope(state.session, "create_organisation", ORGANISATION_KEY, organisationPayload()))).bootstrap;
}

describe("commercial first-site onboarding persistence", () => {
  let db: PGlite;
  beforeEach(async () => { db = await createFirstSiteOnboardingDatabase(); await setTenantAuthUser(db, USER_A_OWNER, "aal2"); }, 30_000);
  afterEach(async () => { await db?.close(); });

  it("adds one durable first-site step and resumes its safe draft", async () => {
    let state = await organisationReady(db);
    expect(state.steps.map((step) => step.stepKey)).toEqual(["owner_security", "legal_acceptance", "organisation", "first_site"]);
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ session_org: string; step_org: string }>(`
      select session.organisation_id session_org, step.organisation_id step_org
      from public.onboarding_sessions session join public.onboarding_step_states step on step.session_id = session.id
      where session.id = $1 and step.step_key = 'first_site'`, [state.session.id])).rows[0])
      .toEqual({ session_org: state.session.organisationId, step_org: state.session.organisationId });
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const saved = await execute(db, envelope(state.session, "save_step_draft", SITE_KEY, {
      stepKey: "first_site", draft: { siteName: "Northstar Central", contactPhone: "+44 20 7946 0999" },
    }));
    expect(saved.commandResult).toMatchObject({ outcome: "succeeded", resultCode: "first_site_draft_saved" });
    state = await bootstrap(db);
    expect(state.steps.find((step) => step.stepKey === "first_site")?.draftPayload)
      .toMatchObject({ siteName: "Northstar Central" });
  });

  it("saves bounded incomplete hours and rejects unknown nested draft properties", async () => {
    let state = await organisationReady(db);
    const partial = await execute(db, envelope(state.session, "save_step_draft", SITE_KEY, {
      stepKey: "first_site",
      draft: { openingHours: [{ dayOfWeek: 1, intervals: [{ opensAt: "", closesAt: "" }] }] },
    }));
    expect(partial.commandResult).toMatchObject({ outcome: "succeeded", resultCode: "first_site_draft_saved" });
    state = partial.bootstrap;
    const invalid = await execute(db, envelope(state.session, "save_step_draft", "62000000-0000-4000-8000-000000000011", {
      stepKey: "first_site", draft: { postalAddress: { unexpectedPrivateField: "blocked" } },
    }));
    expect(invalid.commandResult).toMatchObject({ outcome: "validation_failed", resultCode: "invalid_first_site_draft" });
    expect(Number(invalid.bootstrap.session.revision)).toBe(Number(state.session.revision) + 1);
  });

  it("atomically creates one site, inherited defaults and owner site access with no offline authority", async () => {
    const state = await organisationReady(db);
    const created = await execute(db, envelope(state.session, "create_first_site", SITE_KEY, sitePayload()));
    const replay = await execute(db, envelope(state.session, "create_first_site", SITE_KEY, sitePayload()));
    expect(created.commandResult).toMatchObject({ outcome: "succeeded", resultCode: "first_site_created" });
    expect(replay.commandResult).toMatchObject({ outcome: "replayed", resultCode: "first_site_created" });
    expect(created.bootstrap.session.currentStepKey).toBe("subscription");
    const siteId = String(created.commandResult.resultReference.siteId);
    await resetTenantDatabaseRole(db);
    const result = (await db.query<{ site_count: number; settings_count: number; access_count: number }>(`
      select (select count(*)::int from public.organisation_sites where id = $1 and country_code = 'GB'
          and address_line_1 = '7 Fictional Square' and locality = 'Exampleton' and postcode = 'ZZ2 2ZZ') site_count,
        (select count(*)::int from public.site_settings where site_id = $1 and timezone_override is null and work_week_starts_override is null
          and kiosk_policy = '{"mode":"online_only","offlineEnabled":false}'::jsonb) settings_count,
        (select count(*)::int from public.membership_site_access where site_id = $1 and revoked_at is null) access_count`, [siteId])).rows[0];
    expect(result).toEqual({ site_count: 1, settings_count: 1, access_count: 1 });
    expect(JSON.stringify(created)).not.toMatch(/offline_authori[sz]ation|kiosk_device/i);
  });

  it("rejects AAL1, stale revision, changed idempotent payload and a second first site", async () => {
    let state = await organisationReady(db);
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    expect((await execute(db, envelope(state.session, "create_first_site", SITE_KEY, sitePayload()))).commandResult)
      .toMatchObject({ resultCode: "mfa_required", dataState: "not_saved" });
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    state = await bootstrap(db);
    const stale = { ...envelope(state.session, "create_first_site", "62000000-0000-4000-8000-000000000004", sitePayload()),
      expectedSessionRevision: String(Number(state.session.revision) - 1) };
    expect((await execute(db, stale)).commandResult).toMatchObject({ resultCode: "stale_session_revision" });
    const valid = envelope(state.session, "create_first_site", "62000000-0000-4000-8000-000000000005", sitePayload());
    await execute(db, valid);
    expect((await execute(db, { ...valid, payload: { ...sitePayload(), siteName: "Changed Site" } })).commandResult)
      .toMatchObject({ resultCode: "idempotency_key_reused" });
    const latest = await bootstrap(db);
    expect((await execute(db, envelope(latest.session, "create_first_site", "62000000-0000-4000-8000-000000000006", sitePayload()))).commandResult)
      .toMatchObject({ resultCode: "first_site_already_created", dataState: "not_saved" });
  });

  it("rejects incomplete or overlapping site details at the database boundary", async () => {
    const state = await organisationReady(db);
    const missingPhone = { ...sitePayload() } as Record<string, unknown>;
    delete missingPhone.contactPhone;
    expect((await execute(db, envelope(state.session, "create_first_site", SITE_KEY, missingPhone))).commandResult)
      .toMatchObject({ resultCode: "invalid_first_site_details", dataState: "not_saved" });

    const latest = await bootstrap(db);
    const overlapping = sitePayload();
    overlapping.openingHours[0].intervals = [
      { opensAt: "08:00", closesAt: "12:00" },
      { opensAt: "11:00", closesAt: "15:00" },
    ];
    expect((await execute(db, envelope(latest.session, "create_first_site", "62000000-0000-4000-8000-000000000009", overlapping))).commandResult)
      .toMatchObject({ resultCode: "invalid_first_site_details", dataState: "not_saved" });
  });

  it("rolls back all site effects when default creation fails and fences another owner", async () => {
    const state = await organisationReady(db);
    await resetTenantDatabaseRole(db);
    await db.exec(`create or replace function pg_temp.reject_site_defaults() returns trigger language plpgsql as $$
      begin raise exception 'fictional site default failure'; end $$;
      create trigger reject_site_defaults before insert on public.site_settings for each row execute function pg_temp.reject_site_defaults();`);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(execute(db, envelope(state.session, "create_first_site", SITE_KEY, sitePayload()))).rejects.toThrow(/fictional site default failure/i);
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: string }>("select count(*)::text count from public.organisation_sites where name = 'Northstar Central'")).rows[0].count).toBe("0");
    await setTenantAuthUser(db, USER_B_OWNER, "aal2");
    expect((await db.query("select id from public.onboarding_sessions where id = $1", [state.session.id])).rows).toEqual([]);
  });

  it("denies direct audit writes and stores only privacy-safe first-site event metadata", async () => {
    const state = await organisationReady(db);
    const created = await execute(db, envelope(state.session, "create_first_site", SITE_KEY, sitePayload()));
    await expect(db.query(`insert into public.onboarding_events (session_id, organisation_id, event_type, actor_type, workflow_revision)
      values ($1, $2, 'first_site_created', 'owner', 1)`, [state.session.id, state.session.organisationId])).rejects.toThrow();
    await resetTenantDatabaseRole(db);
    const metadata = (await db.query<{ safe_metadata: unknown }>(
      "select safe_metadata from public.onboarding_events where session_id = $1 and event_type = 'first_site_created'", [state.session.id],
    )).rows[0].safe_metadata;
    expect(JSON.stringify(metadata)).not.toMatch(/northstar|example|email|phone|address|postcode|token|secret|pin/i);
    expect(created.commandResult.resultReference).toHaveProperty("siteId");
  });

  it("denies direct browser creation of partial site and default rows", async () => {
    const state = await organisationReady(db);
    await expect(db.query(`insert into public.organisation_sites (organisation_id, name, slug)
      values ($1, 'Bypass Site', 'bypass-site')`, [state.session.organisationId])).rejects.toThrow();
    await expect(db.query(`insert into public.site_settings (organisation_id, site_id)
      values ($1, '62000000-0000-4000-8000-000000000099')`, [state.session.organisationId])).rejects.toThrow();
  });
});
