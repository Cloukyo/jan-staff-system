import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  USER_A_OWNER,
  USER_B_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";
import { createStaffInvitationsOnboardingDatabase } from "./helpers/onboarding-persistence-db";
import { createHash } from "node:crypto";

type Snapshot = {
  session: { id: string; organisationId: string | null; revision: string };
  legalDocuments: Array<{
    documentType: string;
    documentVersion: string;
    locale: string;
  }>;
  siteSummary: { siteId: string } | null;
  staffInvitations: {
    skipped: boolean;
    staff: Array<{
      staffId: string;
      accountState: string;
      siteIds: string[];
      invitationId: string | null;
    }>;
  };
};
const key = (n: number) =>
  `67000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reviewed = (ids: string[]) =>
  createHash("sha256").update(ids.toSorted().join("\n")).digest("hex");
async function exec(
  db: PGlite,
  s: Snapshot,
  type: string,
  n: number,
  payload: unknown,
) {
  return (
    await db.query<{
      x: {
        commandResult: {
          outcome: string;
          resultCode: string;
          resultReference: { invitationIds?: string[] };
        };
        bootstrap: Snapshot;
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
async function ready(db: PGlite) {
  let s = (
    await db.query<{ x: Snapshot }>(
      "select public.get_or_create_onboarding_bootstrap()x",
    )
  ).rows[0].x;
  s = (
    await exec(db, s, "accept_legal_documents", 1, {
      acceptances: s.legalDocuments.map((d) => ({
        documentType: d.documentType,
        documentVersion: d.documentVersion,
        locale: d.locale,
      })),
      safeRequestMetadata: { source: "commercial_onboarding" },
    })
  ).bootstrap;
  s = (
    await exec(db, s, "create_organisation", 2, {
      displayName: "Cedar Demo",
      legalName: "Cedar Demo Limited",
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
    await exec(db, s, "create_first_site", 3, {
      siteName: "Cedar Central",
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
    await exec(db, s, "select_plan", 4, {
      planKey: "preview_standard",
      planVersion: 1,
      selection: "free_trial",
    })
  ).bootstrap;
  return (
    await exec(db, s, "skip_staffing", 5, {
      acknowledgement: "staffing_not_ready",
    })
  ).bootstrap;
}

describe("commercial staff invitations database", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createStaffInvitationsOnboardingDatabase();
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  }, 30000);
  afterEach(async () => db?.close());
  it("creates reviewed fixed-role invitations from same-organisation staff and authoritative assignments", async () => {
    let s = await ready(db);
    await resetTenantDatabaseRole(db);
    await db.query(
      `insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,email,active) values('staff-invite-1',$1,'Taylor Example','Taylor','staff','taylor@example.invalid',true)`,
      [s.session.organisationId],
    );
    await db.query(
      `insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary) values($1,'staff-invite-1',$2,current_date,true)`,
      [s.session.organisationId, s.siteSummary!.siteId],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    s = (
      await db.query<{ x: Snapshot }>(
        "select public.get_or_create_onboarding_bootstrap()x",
      )
    ).rows[0].x;
    const command = {
      staffIds: ["staff-invite-1"],
      reviewedSetHash: reviewed(["staff-invite-1"]),
    };
    const first = await exec(db, s, "create_staff_invitations", 10, command);
    const replay = await exec(db, s, "create_staff_invitations", 10, command);
    expect(first.commandResult.resultCode).toBe("staff_invitation_created");
    expect(replay.commandResult.outcome).toBe("replayed");
    expect(
      first.bootstrap.staffInvitations.staff.find(
        (x) => x.staffId === "staff-invite-1",
      ),
    ).toMatchObject({
      accountState: "invitation_pending",
      siteIds: [s.siteSummary!.siteId],
    });
    await resetTenantDatabaseRole(db);
    const rows = (
      await db.query<{
        role: string;
        staff_id: string;
        message_type: string;
        raw: number;
      }>(
        `select r.role::text,i.staff_id,o.message_type,(select count(*)::int from public.message_outbox where payload::text ilike '%token%') raw from public.organisation_invitations i join public.organisation_invitation_roles r on r.invitation_id=i.id join public.message_outbox o on o.invitation_id=i.id where i.staff_id='staff-invite-1'`,
      )
    ).rows[0];
    expect(rows).toMatchObject({
      role: "staff",
      staff_id: "staff-invite-1",
      message_type: "staff_invitation",
      raw: 0,
    });
  });
  it("fails closed for cross-organisation, missing-email and client role/site payloads", async () => {
    const s = await ready(db);
    const foreign = await exec(db, s, "create_staff_invitations", 20, {
      staffIds: ["tenant-staff-b"],
      reviewedSetHash: reviewed(["tenant-staff-b"]),
    });
    expect(foreign.commandResult.resultCode).toBe("staff_not_eligible");
    const escalation = await exec(db, s, "create_staff_invitations", 21, {
      staffIds: ["tenant-staff-a"],
      reviewedSetHash: reviewed(["tenant-staff-a"]),
      role: "organisation_owner",
      siteIds: [s.siteSummary!.siteId],
    });
    expect(escalation.commandResult.resultCode).toBe(
      "invalid_staff_invitation_payload",
    );
    await setTenantAuthUser(db, USER_B_OWNER, "aal2");
    expect(
      (
        await exec(db, s, "skip_staff_invitation_step", 22, {
          acknowledgement: "invite_staff_later",
        })
      ).commandResult.resultCode,
    ).toBe("permission_denied");
  });
  it("skips without creating memberships or fake invitations and remains revisitable", async () => {
    const s = await ready(db);
    const skipped = await exec(db, s, "skip_staff_invitation_step", 30, {
      acknowledgement: "invite_staff_later",
    });
    expect(skipped.bootstrap.staffInvitations.skipped).toBe(true);
    await resetTenantDatabaseRole(db);
    const counts = (
      await db.query<{ i: number; m: number }>(
        `select (select count(*)::int from public.organisation_invitations where invitation_kind='staff')i,(select count(*)::int from public.organisation_memberships where organisation_id=$1 and staff_id is not null)m`,
        [s.session.organisationId],
      )
    ).rows[0];
    expect(counts).toEqual({ i: 0, m: 0 });
  });
  it("keeps delivery durable across a retry and restricts token claims to service role", async () => {
    let s = await ready(db);
    await resetTenantDatabaseRole(db);
    await db.query(`insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,email,active) values('staff-delivery-1',$1,'Casey Example','Casey','staff','casey@example.invalid',true)`,[s.session.organisationId]);
    await db.query(`insert into public.staff_site_assignments(organisation_id,staff_id,site_id,effective_from,is_primary) values($1,'staff-delivery-1',$2,current_date,true)`,[s.session.organisationId,s.siteSummary!.siteId]);
    await setTenantAuthUser(db,USER_A_OWNER,"aal2");
    s=(await db.query<{x:Snapshot}>("select public.get_or_create_onboarding_bootstrap()x")).rows[0].x;
    const made=await exec(db,s,"create_staff_invitations",40,{staffIds:["staff-delivery-1"],reviewedSetHash:reviewed(["staff-delivery-1"])});
    const invitationId=made.commandResult.resultReference.invitationIds![0];
    await expect(db.query("select public.claim_staff_invitation_delivery($1)",[invitationId])).rejects.toThrow();
    await resetTenantDatabaseRole(db);await db.query("select set_config('request.jwt.claim.role','service_role',false)");await db.exec("set role service_role");
    expect((await db.query<{x:{outcome:string;invitationToken:string}}>("select public.claim_staff_invitation_delivery($1)x",[invitationId])).rows[0].x).toMatchObject({outcome:"claimed",invitationToken:expect.any(String)});
    expect((await db.query<{x:{outcome:string}}>("select public.record_staff_invitation_delivery($1,'retryable_failure','preview_transport')x",[invitationId])).rows[0].x.outcome).toBe("retryable_failure");
    await resetTenantDatabaseRole(db);const row=(await db.query<{delivery_status:string;invitations:number}>(`select delivery_status,(select count(*)::int from public.organisation_invitations where id=$1)invitations from public.message_outbox where invitation_id=$1`,[invitationId])).rows[0];expect(row).toEqual({delivery_status:"retryable_failure",invitations:1});
  });
});
