import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  USER_A_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import { createManagerInvitationsOnboardingDatabase } from "./helpers/onboarding-persistence-db";

const INVITEE = "c0000000-0000-0000-0000-000000000001";
const TOKEN = "fictional-manager-invitation-token-0000000000000001";
type Snapshot = {
  session: { id: string; organisationId: string | null; revision: string };
  legalDocuments: Array<{
    documentType: string;
    documentVersion: string;
    locale: string;
  }>;
  siteSummary: { siteId: string } | null;
};
const key = (n: number) =>
  `66000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function call(
  db: PGlite,
  s: Snapshot,
  type: string,
  n: number,
  payload: unknown,
) {
  return (
    await db.query<{
      x: {
        bootstrap: Snapshot;
        commandResult: {
          resultCode: string;
          resultReference: { invitationIds?: string[] };
        };
      };
    }>("select public.execute_onboarding_bootstrap_command($1::jsonb)x", [
      JSON.stringify({
        schemaVersion: 1,
        workflowKey: "commercial_customer_v1",
        workflowVersion: 1,
        sessionId: s.session.id,
        commandType: type,
        idempotencyKey: key(n),
        expectedSessionRevision: s.session.revision,
        payload,
      }),
    ])
  ).rows[0].x;
}
async function invitation(db: PGlite) {
  let s = (
    await db.query<{ x: Snapshot }>(
      "select public.get_or_create_onboarding_bootstrap()x",
    )
  ).rows[0].x;
  s = (
    await call(db, s, "accept_legal_documents", 1, {
      acceptances: s.legalDocuments.map((d) => ({
        documentType: d.documentType,
        documentVersion: d.documentVersion,
        locale: d.locale,
      })),
      safeRequestMetadata: { source: "commercial_onboarding" },
    })
  ).bootstrap;
  s = (
    await call(db, s, "create_organisation", 2, {
      displayName: "Beacon Demo",
      legalName: "Beacon Demo Limited",
      contactEmail: "owner@example.invalid",
      country: "GB",
      timezone: "Europe/London",
      postalAddress: {
        line1: "1 Fictional Way",
        locality: "Exampleton",
        postcode: "ZZ1 1ZZ",
      },
    })
  ).bootstrap;
  s = (
    await call(db, s, "create_first_site", 3, {
      siteName: "Beacon Central",
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
    })
  ).bootstrap;
  s = (
    await call(db, s, "select_plan", 4, {
      planKey: "preview_standard",
      planVersion: 1,
      selection: "free_trial",
    })
  ).bootstrap;
  s = (
    await call(db, s, "skip_staffing", 5, {
      acknowledgement: "staffing_not_ready",
    })
  ).bootstrap;
  const created = await call(db, s, "create_manager_invitation", 6, {
    email: "invitee@example.test",
    role: "site_manager",
    scopeType: "site",
    siteIds: [s.siteSummary!.siteId],
  });
  const id = created.commandResult.resultReference.invitationIds![0];
  await resetTenantDatabaseRole(db);
  await db.query(
    "update public.organisation_invitations set token_hash=sha256(convert_to($1,'UTF8')) where id=$2",
    [TOKEN, id],
  );
  return {
    id,
    organisationId: s.session.organisationId!,
    siteId: s.siteSummary!.siteId,
  };
}

describe("manager invitation acceptance", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createManagerInvitationsOnboardingDatabase();
    await resetTenantDatabaseRole(db);
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at)values($1,'invitee@example.test',now())",
      [INVITEE],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  }, 30000);
  afterEach(async () => db?.close());
  it("requires matching identity and AAL2 then creates membership, role and site access transactionally", async () => {
    const target = await invitation(db);
    await setTenantAuthUser(db, INVITEE, "aal1");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("mfa_required");
    await setTenantAuthUser(db, INVITEE, "aal2");
    const accepted = (
      await db.query<{ x: { outcome: string; membershipId: string } }>(
        "select public.accept_manager_invitation($1)x",
        [TOKEN],
      )
    ).rows[0].x;
    expect(accepted.outcome).toBe("accepted");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("already_accepted");
    await resetTenantDatabaseRole(db);
    expect(
      (
        await db.query<{
          roles: number;
          sites: number;
          deliverySecrets: number;
        }>(
          `select (select count(*)::int from public.membership_role_assignments where membership_id=$1 and role='site_manager')roles,(select count(*)::int from public.membership_site_access where membership_id=$1 and site_id=$2)sites,(select count(*)::int from vault.secrets) "deliverySecrets"`,
          [accepted.membershipId, target.siteId],
        )
      ).rows[0],
    ).toEqual({ roles: 1, sites: 1, deliverySecrets: 0 });
  });
  it("rejects email mismatch, expiry, revocation and inviter authority loss without membership", async () => {
    const target = await invitation(db);
    await setTenantAuthUser(db, "a0000000-0000-0000-0000-000000000002", "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("unavailable");
    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.organisation_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 minute' where id=$1",
      [target.id],
    );
    await setTenantAuthUser(db, INVITEE, "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("expired");
    await resetTenantDatabaseRole(db);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from public.organisation_memberships where auth_user_id=$1",
          [INVITEE],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("requires verified email and preserves a zero-membership result", async () => {
    await resetTenantDatabaseRole(db);
    await db.query(
      "update auth.users set email_confirmed_at=null where id=$1",
      [INVITEE],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await invitation(db);
    await setTenantAuthUser(db, INVITEE, "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("email_verification_required");
    await resetTenantDatabaseRole(db);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from public.organisation_memberships where auth_user_id=$1",
          [INVITEE],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("returns safe states for revoked, superseded, authority-changed and archived-site invitations", async () => {
    const target = await invitation(db);
    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.organisation_invitations set status='revoked',revoked_at=now() where id=$1",
      [target.id],
    );
    await setTenantAuthUser(db, INVITEE, "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("revoked");
    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.organisation_invitations set status='superseded',superseded_at=now() where id=$1",
      [target.id],
    );
    await setTenantAuthUser(db, INVITEE, "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("superseded");
    await resetTenantDatabaseRole(db);
    const formerUser = "c0000000-0000-0000-0000-000000000099";
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'former@example.test',now())",
      [formerUser],
    );
    const former = (
      await db.query<{ id: string }>(
        "insert into public.organisation_memberships(organisation_id,auth_user_id,status,revoked_at) values($1,$2,'revoked',now()) returning id",
        [target.organisationId, formerUser],
      )
    ).rows[0];
    await db.query(
      "update public.organisation_invitations set status='pending',superseded_at=null,invited_by_membership_id=$1 where id=$2",
      [former.id, target.id],
    );
    await setTenantAuthUser(db, INVITEE, "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("authority_changed");
    await resetTenantDatabaseRole(db);
    const owner = (
      await db.query<{ id: string }>(
        "select id from public.organisation_memberships where organisation_id=$1 and auth_user_id=$2",
        [target.organisationId, USER_A_OWNER],
      )
    ).rows[0];
    await db.query(
      "update public.organisation_invitations set invited_by_membership_id=$1 where id=$2",
      [owner.id, target.id],
    );
    await db.query(
      "update public.organisation_sites set active=false,archived_at=now() where id=$1",
      [target.siteId],
    );
    await setTenantAuthUser(db, INVITEE, "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("scope_changed");
    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.organisation_sites set active=true,archived_at=null where id=$1",
      [target.siteId],
    );
    await db.query(
      "insert into public.organisation_memberships(organisation_id,auth_user_id,status,joined_at) values($1,$2,'active',now())",
      [target.organisationId, INVITEE],
    );
    await setTenantAuthUser(db, INVITEE, "aal2");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_manager_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("membership_already_exists");
  });
});
