import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  USER_A_OWNER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import { createPilotReadinessKioskDatabase } from "./helpers/onboarding-persistence-db";

type Snapshot = {
  session: { id: string; organisationId: string | null; revision: string };
  legalDocuments: Array<{
    documentType: string;
    documentVersion: string;
    locale: string;
  }>;
  steps: Array<{ stepKey: string; status: string }>;
  siteSummary: { siteId: string } | null;
  managerInvitations: {
    soleManagerAcknowledged: boolean;
    invitations: Array<{
      id: string;
      status: string;
      deliveryStatus: string;
      role: string;
      siteIds: string[];
    }>;
  };
};
const key = (n: number) =>
  `65000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function load(db: PGlite) {
  return (
    await db.query<{ x: Snapshot }>(
      "select public.get_or_create_onboarding_bootstrap() x",
    )
  ).rows[0].x;
}
function env(s: Snapshot, type: string, n: number, payload: unknown) {
  return {
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: s.session.id,
    commandType: type,
    idempotencyKey: key(n),
    expectedSessionRevision: s.session.revision,
    payload,
  };
}
async function exec(db: PGlite, e: unknown) {
  return (
    await db.query<{
      x: {
        commandResult: {
          outcome: string;
          resultCode: string;
          resultReference: Record<string, unknown>;
        };
        bootstrap: Snapshot;
      };
    }>("select public.execute_onboarding_bootstrap_command($1::jsonb) x", [
      JSON.stringify(e),
    ])
  ).rows[0].x;
}
async function ready(db: PGlite) {
  let s = await load(db);
  s = (
    await exec(
      db,
      env(s, "accept_legal_documents", 1, {
        acceptances: s.legalDocuments.map((d) => ({
          documentType: d.documentType,
          documentVersion: d.documentVersion,
          locale: d.locale,
        })),
        safeRequestMetadata: { source: "commercial_onboarding" },
      }),
    )
  ).bootstrap;
  s = (
    await exec(
      db,
      env(s, "create_organisation", 2, {
        displayName: "Atlas Demo",
        legalName: "Atlas Demo Limited",
        contactEmail: "owner@example.invalid",
        country: "GB",
        timezone: "Europe/London",
        postalAddress: {
          line1: "1 Fictional Way",
          locality: "Exampleton",
          postcode: "ZZ1 1ZZ",
        },
      }),
    )
  ).bootstrap;
  s = (
    await exec(
      db,
      env(s, "create_first_site", 3, {
        siteName: "Atlas Central",
        contactPhone: "+44 20 7946 0999",
        country: "GB",
        timezone: "Europe/London",
        postalAddress: {
          line1: "2 Fictional Way",
          locality: "Exampleton",
          postcode: "ZZ1 1ZZ",
        },
        openingHours: Array.from({ length: 7 }, (_, i) => ({
          dayOfWeek: i + 1,
          intervals: i < 5 ? [{ opensAt: "08:00", closesAt: "18:00" }] : [],
        })),
        workWeekStarts: 1,
        operationalDayBoundary: "04:00",
      }),
    )
  ).bootstrap;
  s = (
    await exec(
      db,
      env(s, "select_plan", 4, {
        planKey: "preview_standard",
        planVersion: 1,
        selection: "free_trial",
      }),
    )
  ).bootstrap;
  return (
    await exec(
      db,
      env(s, "skip_staffing", 5, { acknowledgement: "staffing_not_ready" }),
    )
  ).bootstrap;
}
async function previewToken(db: PGlite, invitationId: string) {
  await resetTenantDatabaseRole(db);
  await db.query(
    "select set_config('request.jwt.claim.role','service_role',false)",
  );
  await db.exec("set role service_role");
  const result = (
    await db.query<{ x: { outcome: string; invitationToken: string } }>(
      "select public.preview_manager_invitation_token($1)x",
      [invitationId],
    )
  ).rows[0].x;
  await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  expect(result.outcome).toBe("available");
  return result.invitationToken;
}

describe("commercial manager invitations database", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createPilotReadinessKioskDatabase();
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  }, 30000);
  afterEach(async () => db?.close());
  it("creates invitation, grants and outbox atomically without persisting the raw token", async () => {
    const s = await ready(db);
    const command = env(s, "create_manager_invitation", 10, {
      email: "manager.preview@example.invalid",
      role: "site_manager",
      scopeType: "site",
      siteIds: [s.siteSummary!.siteId],
    });
    const first = await exec(db, command);
    const replay = await exec(db, command);
    expect(first.commandResult.resultCode).toBe("manager_invitation_created");
    expect(replay.commandResult.outcome).toBe("replayed");
    expect(first.bootstrap.managerInvitations.invitations[0]).toMatchObject({
      status: "pending",
      deliveryStatus: "queued",
      role: "site_manager",
    });
    await resetTenantDatabaseRole(db);
    const row = (
      await db.query<{
        invitations: number;
        roles: number;
        access: number;
        outbox: number;
        raw_tokens: number;
      }>(
        `select (select count(*)::int from public.organisation_invitations where organisation_id=$1) invitations,(select count(*)::int from public.organisation_invitation_roles where organisation_id=$1) roles,(select count(*)::int from public.organisation_invitation_site_access where organisation_id=$1) access,(select count(*)::int from public.message_outbox where organisation_id=$1) outbox,(select count(*)::int from public.message_outbox where payload::text ilike '%token%') raw_tokens`,
        [s.session.organisationId],
      )
    ).rows[0];
    expect(row).toEqual({
      invitations: 1,
      roles: 1,
      access: 1,
      outbox: 1,
      raw_tokens: 0,
    });
  });
  it("rejects owner escalation, cross-organisation sites, AAL1 and stale revisions", async () => {
    const s = await ready(db);
    expect(
      (
        await exec(
          db,
          env(s, "create_manager_invitation", 20, {
            email: "x@example.invalid",
            role: "organisation_owner",
            scopeType: "organisation",
            siteIds: [],
          }),
        )
      ).commandResult.resultCode,
    ).toBe("ungrantable_role");
    expect(
      (
        await exec(
          db,
          env(s, "create_manager_invitation", 21, {
            email: "x@example.invalid",
            role: "site_manager",
            scopeType: "site",
            siteIds: ["21000000-0000-0000-0000-000000000001"],
          }),
        )
      ).commandResult.resultCode,
    ).toBe("invalid_site_scope");
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    expect(
      (
        await exec(
          db,
          env(s, "create_manager_invitation", 22, {
            email: "x@example.invalid",
            role: "organisation_admin",
            scopeType: "organisation",
            siteIds: [],
          }),
        )
      ).commandResult.resultCode,
    ).toBe("mfa_required");
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    expect(
      (
        await exec(db, {
          ...env(s, "create_manager_invitation", 23, {
            email: "x@example.invalid",
            role: "organisation_admin",
            scopeType: "organisation",
            siteIds: [],
          }),
          expectedSessionRevision: "0",
        })
      ).commandResult.resultCode,
    ).toBe("stale_session_revision");
  });
  it("supersedes on resend, invalidates the old token and keeps sole-manager acknowledgement warning-only", async () => {
    const s = await ready(db);
    const created = await exec(
      db,
      env(s, "create_manager_invitation", 30, {
        email: "manager@example.invalid",
        role: "organisation_admin",
        scopeType: "organisation",
        siteIds: [],
      }),
    );
    const id = created.bootstrap.managerInvitations.invitations[0].id;
    const originalToken = await previewToken(db, id);
    const resent = await exec(
      db,
      env(created.bootstrap, "resend_manager_invitation", 31, {
        invitationId: id,
      }),
    );
    expect(
      resent.bootstrap.managerInvitations.invitations.some(
        (i) => i.status === "superseded",
      ),
    ).toBe(true);
    const replacement = resent.bootstrap.managerInvitations.invitations.find(
      (invitation) => invitation.status === "pending",
    )!;
    const replacementToken = await previewToken(db, replacement.id);
    expect(
      (
        await db.query<{ x: { state: string } }>(
          "select public.inspect_manager_invitation($1)x",
          [originalToken],
        )
      ).rows[0].x.state,
    ).toBe("superseded");
    expect(
      (
        await db.query<{ x: { state: string } }>(
          "select public.inspect_manager_invitation($1)x",
          [replacementToken],
        )
      ).rows[0].x.state,
    ).toBe("pending");
    const active = resent.bootstrap.managerInvitations.invitations.find(
      (i) => i.status === "pending",
    )!;
    const revoked = await exec(
      db,
      env(resent.bootstrap, "revoke_manager_invitation", 32, {
        invitationId: active.id,
      }),
    );
    const again = await exec(
      db,
      env(revoked.bootstrap, "revoke_manager_invitation", 33, {
        invitationId: active.id,
      }),
    );
    expect(again.commandResult.resultCode).toBe("manager_invitation_revoked");
    const acknowledged = await exec(
      db,
      env(again.bootstrap, "acknowledge_sole_manager", 34, {
        acknowledgement: "sole_manager_for_now",
      }),
    );
    expect(
      acknowledged.bootstrap.managerInvitations.soleManagerAcknowledged,
    ).toBe(true);
    await resetTenantDatabaseRole(db);
    expect(
      (
        await db.query<{ count: number }>(
          `select count(*)::int count from public.organisation_memberships where organisation_id=$1`,
          [s.session.organisationId],
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it("supports multiple authorised sites and an organisation-configured lifetime", async () => {
    const s = await ready(db);
    const secondSite = "65000000-0000-4000-8000-000000000099";
    await resetTenantDatabaseRole(db);
    await db.query(
      "insert into public.organisation_sites(id,organisation_id,name,slug,timezone,active) values($1,$2,'Atlas Riverside','atlas-riverside','Europe/London',true)",
      [secondSite, s.session.organisationId],
    );
    await db.query(
      "update public.organisation_settings set manager_invitation_lifetime_days=2 where organisation_id=$1",
      [s.session.organisationId],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const created = await exec(
      db,
      env(s, "create_manager_invitation", 35, {
        email: "multisite@example.invalid",
        role: "site_manager",
        scopeType: "site",
        siteIds: [s.siteSummary!.siteId, secondSite],
      }),
    );
    expect(
      created.bootstrap.managerInvitations.invitations[0].siteIds,
    ).toHaveLength(2);
    await resetTenantDatabaseRole(db);
    const hours = (
      await db.query<{ hours: number }>(
        "select extract(epoch from (expires_at-created_at))/3600 hours from public.organisation_invitations where id=$1",
        [created.bootstrap.managerInvitations.invitations[0].id],
      )
    ).rows[0].hours;
    expect(Number(hours)).toBeCloseTo(48, 1);
  });
  it("prevents another organisation from listing or mutating invitations and hides outbox", async () => {
    const s = await ready(db);
    const created = await exec(
      db,
      env(s, "create_manager_invitation", 40, {
        email: "private@example.invalid",
        role: "site_manager",
        scopeType: "site",
        siteIds: [s.siteSummary!.siteId],
      }),
    );
    const id = created.bootstrap.managerInvitations.invitations[0].id;
    await setTenantAuthUser(db, USER_B_OWNER, "aal2");
    expect(
      (
        await db.query(
          `select id from public.organisation_invitations where id=$1`,
          [id],
        )
      ).rows,
    ).toEqual([]);
    await expect(
      db.query(`select id from public.message_outbox`),
    ).rejects.toThrow(/permission denied/);
    expect(
      (
        await exec(
          db,
          env(s, "revoke_manager_invitation", 41, { invitationId: id }),
        )
      ).commandResult.resultCode,
    ).toBe("permission_denied");
  });
  it("rejects malformed direct-RPC identifiers without aborting the command", async () => {
    const s = await ready(db);
    const malformedSite = await exec(
      db,
      env(s, "create_manager_invitation", 50, {
        email: "safe@example.invalid",
        role: "site_manager",
        scopeType: "site",
        siteIds: ["not-a-uuid"],
      }),
    );
    expect(malformedSite.commandResult.resultCode).toBe("invalid_site_scope");
    const malformedInvitation = await exec(
      db,
      env(malformedSite.bootstrap, "resend_manager_invitation", 51, {
        invitationId: "not-a-uuid",
      }),
    );
    expect(malformedInvitation.commandResult.resultCode).toBe(
      "invalid_invitation_payload",
    );
  });
  it("records delivery outcomes through a service-only boundary without duplicating the invitation", async () => {
    const s = await ready(db);
    const created = await exec(
      db,
      env(s, "create_manager_invitation", 60, {
        email: "delivery@example.invalid",
        role: "site_manager",
        scopeType: "site",
        siteIds: [s.siteSummary!.siteId],
      }),
    );
    const id = created.bootstrap.managerInvitations.invitations[0].id;
    await resetTenantDatabaseRole(db);
    await db.query(
      "select set_config('request.jwt.claim.role','service_role',false)",
    );
    await db.exec("set role service_role");
    const claim = (
      await db.query<{ x: { outcome: string; invitationToken: string } }>(
        "select public.claim_manager_invitation_delivery($1)x",
        [id],
      )
    ).rows[0].x;
    expect(claim.outcome).toBe("claimed");
    expect(claim.invitationToken).toMatch(/^[a-f0-9]{64}$/);
    const result = (
      await db.query<{ x: { outcome: string; attemptCount: number } }>(
        "select public.record_manager_invitation_delivery($1,'retryable_failure','preview_transport')x",
        [id],
      )
    ).rows[0].x;
    expect(result).toEqual({ outcome: "retryable_failure", attemptCount: 1 });
    await db.exec("reset role");
    expect(
      (
        await db.query<{ audit: number; invitations: number }>(
          "select (select count(*)::int from public.manager_invitation_audit_events where invitation_id=$1 and event_type='delivery_failed') audit,(select count(*)::int from public.organisation_invitations where id=$1) invitations",
          [id],
        )
      ).rows[0],
    ).toEqual({ audit: 1, invitations: 1 });
  });

  it("claims the next delivery with an outbox identity and never persists an acceptance URL", async () => {
    const s = await ready(db);
    await exec(db, env(s, "create_manager_invitation", 65, {
      email: "worker@example.invalid",
      role: "site_manager",
      scopeType: "site",
      siteIds: [s.siteSummary!.siteId],
    }));
    await resetTenantDatabaseRole(db);
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    await db.exec("set role service_role");
    const claim = (await db.query<{ x: { outcome: string; outboxId: string; invitationToken: string } }>("select public.claim_next_notification_delivery()x")).rows[0].x;
    expect(claim).toMatchObject({ outcome: "claimed", outboxId: expect.any(String), invitationToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(claim)).not.toContain("acceptanceUrl");
    expect((await db.query<{ x: { outcome: string } }>("select public.record_notification_delivery($1,'accepted','email_test_worker',null)x", [claim.outboxId])).rows[0].x.outcome).toBe("recorded");
    await db.exec("reset role");
    const stored = (await db.query<{ provider_message_reference: string; delivery_status: string; rendered_urls: number }>("select provider_message_reference,delivery_status,(select count(*)::int from public.message_outbox where payload::text like '%token=%') rendered_urls from public.message_outbox where id=$1", [claim.outboxId])).rows[0];
    expect(stored).toEqual({ provider_message_reference: "email_test_worker", delivery_status: "sent", rendered_urls: 0 });
  });

  it("reserves privileged capacity for pending invitations", async () => {
    let s = await ready(db);
    for (let index = 0; index < 9; index += 1) {
      const created = await exec(db, env(s, "create_manager_invitation", 70 + index, {
        email: `reserved-${index}@example.invalid`,
        role: "site_manager",
        scopeType: "site",
        siteIds: [s.siteSummary!.siteId],
      }));
      expect(created.commandResult.resultCode).toBe("manager_invitation_created");
      s = created.bootstrap;
    }
    const blocked = await exec(db, env(s, "create_manager_invitation", 79, {
      email: "reserved-over-limit@example.invalid",
      role: "site_manager",
      scopeType: "site",
      siteIds: [s.siteSummary!.siteId],
    }));
    expect(blocked.commandResult.resultCode).toBe("privileged_capacity_reached");
    await resetTenantDatabaseRole(db);
    expect((await db.query<{ count: number }>("select count(*)::int count from public.organisation_invitations where organisation_id=$1 and invitation_kind='manager' and status='pending'", [s.session.organisationId])).rows[0].count).toBe(9);
  });
});
