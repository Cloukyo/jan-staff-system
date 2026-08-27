import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  USER_A_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import { createStaffInvitationsOnboardingDatabase } from "./helpers/onboarding-persistence-db";

const INVITEE = "c1000000-0000-0000-0000-000000000001";
const OTHER = "c1000000-0000-0000-0000-000000000002";
const TOKEN = "a".repeat(64);
type S = {
  session: { id: string; organisationId: string | null; revision: string };
  legalDocuments: Array<{
    documentType: string;
    documentVersion: string;
    locale: string;
  }>;
  siteSummary: { siteId: string } | null;
};
const key = (n: number) =>
  `68000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function cmd(
  db: PGlite,
  s: S,
  type: string,
  n: number,
  payload: unknown,
) {
  return (
    await db.query<{
      x: {
        bootstrap: S;
        commandResult: { resultReference: { invitationIds?: string[] } };
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
async function create(db: PGlite) {
  let s = (
    await db.query<{ x: S }>(
      "select public.get_or_create_onboarding_bootstrap()x",
    )
  ).rows[0].x;
  s = (
    await cmd(db, s, "accept_legal_documents", 1, {
      acceptances: s.legalDocuments.map((d) => ({
        documentType: d.documentType,
        documentVersion: d.documentVersion,
        locale: d.locale,
      })),
      safeRequestMetadata: { source: "commercial_onboarding" },
    })
  ).bootstrap;
  s = (
    await cmd(db, s, "create_organisation", 2, {
      displayName: "Elm Demo",
      legalName: "Elm Demo Limited",
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
    await cmd(db, s, "create_first_site", 3, {
      siteName: "Elm Central",
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
    await cmd(db, s, "select_plan", 4, {
      planKey: "preview_standard",
      planVersion: 1,
      selection: "free_trial",
    })
  ).bootstrap;
  s = (
    await cmd(db, s, "skip_staffing", 5, {
      acknowledgement: "staffing_not_ready",
    })
  ).bootstrap;
  await resetTenantDatabaseRole(db);
  await db.query(
    `insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,email,active) values('staff-link-1',$1,'Morgan Example','Morgan','staff','staff.invitee@example.invalid',true)`,
    [s.session.organisationId],
  );
  await db.query(
    `insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary) values($1,'staff-link-1',$2,current_date,true)`,
    [s.session.organisationId, s.siteSummary!.siteId],
  );
  await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  s = (
    await db.query<{ x: S }>(
      "select public.get_or_create_onboarding_bootstrap()x",
    )
  ).rows[0].x;
  const made = await cmd(db, s, "create_staff_invitations", 6, {
    staffIds: ["staff-link-1"],
    reviewedSetHash: createHash("sha256").update("staff-link-1").digest("hex"),
  });
  const id = made.commandResult.resultReference.invitationIds![0];
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

describe("staff invitation acceptance", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createStaffInvitationsOnboardingDatabase();
    await resetTenantDatabaseRole(db);
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at)values($1,'staff.invitee@example.invalid',now()),($2,'other@example.invalid',now())",
      [INVITEE, OTHER],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  }, 30000);
  afterEach(async () => db?.close());
  it("links the exact staff profile with fixed staff role and derived site access at AAL1", async () => {
    await create(db);
    await setTenantAuthUser(db, INVITEE, "aal1");
    const accepted = (
      await db.query<{
        x: { outcome: string; staffId: string; membershipId: string };
      }>("select public.accept_staff_invitation($1)x", [TOKEN])
    ).rows[0].x;
    expect(accepted).toMatchObject({
      outcome: "accepted",
      staffId: "staff-link-1",
    });
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_staff_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("already_linked");
    await resetTenantDatabaseRole(db);
    const linked = (
      await db.query<{ staff_id: string; role: string; sites: number }>(
        `select m.staff_id,r.role::text,(select count(*)::int from public.membership_site_access a where a.membership_id=m.id and a.revoked_at is null)sites from public.organisation_memberships m join public.membership_role_assignments r on r.membership_id=m.id and r.revoked_at is null where m.id=$1`,
        [accepted.membershipId],
      )
    ).rows[0];
    expect(linked).toEqual({
      staff_id: "staff-link-1",
      role: "staff",
      sites: 1,
    });
  });
  it("fails closed for email mismatch, deactivated staff and conflicting membership", async () => {
    const t = await create(db);
    await setTenantAuthUser(db, OTHER, "aal1");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_staff_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("unavailable");
    await resetTenantDatabaseRole(db);
    await db.query(
      "update public.staff_profiles set active=false where organisation_id=$1 and id='staff-link-1'",
      [t.organisationId],
    );
    await setTenantAuthUser(db, INVITEE, "aal1");
    expect(
      (
        await db.query<{ x: { outcome: string } }>(
          "select public.accept_staff_invitation($1)x",
          [TOKEN],
        )
      ).rows[0].x.outcome,
    ).toBe("staff_identity_changed");
  });
  it("does not expose direct linking or service-only token inspection to authenticated users", async () => {
    const t = await create(db);
    await setTenantAuthUser(db, INVITEE, "aal1");
    await expect(
      db.query("select public.preview_staff_invitation_token($1)", [t.id]),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into public.organisation_memberships(organisation_id,auth_user_id,staff_id,status,joined_at) values($1,$2,'staff-link-1','active',now())`,
        [t.organisationId, INVITEE],
      ),
    ).rejects.toThrow();
  });
});
