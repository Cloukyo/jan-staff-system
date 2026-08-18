import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPilotReadinessCommercialDatabase } from "./helpers/onboarding-persistence-db";
import {
  MEMBERSHIP_A_OWNER,
  ORG_A,
  SITE_A1,
  USER_A_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";

describe("pilot-ready post-live invitations", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createPilotReadinessCommercialDatabase();
    await resetTenantDatabaseRole(db);
    await db.exec(`
      insert into public.plans(plan_key,plan_version,display_name,summary,country_code,pricing_status,feature_highlights,active)
      values('admin_pilot',1,'Admin Pilot','Fictional post-live plan','GB','commercially_approved','["Manager access"]',true);
      insert into public.plan_entitlements values
        ('admin_pilot',1,'attendance.core','boolean',true,null,now()),
        ('admin_pilot',1,'attendance.offline','boolean',false,null,now()),
        ('admin_pilot',1,'members.privileged.limit','integer',null,10,now());
    `);
    const subscription = (
      await db.query<{ id: string }>(
        "insert into public.organisation_subscriptions(organisation_id,plan_key,plan_version,state,is_current,ordinary_initial_trial,created_by_membership_id) values($1,'admin_pilot',1,'active',true,false,$2) returning id",
        [ORG_A, MEMBERSHIP_A_OWNER],
      )
    ).rows[0];
    await db.query(
      "insert into public.organisation_entitlements(organisation_id,subscription_id,capability_key,value_type,boolean_value,integer_value,source_plan_key,source_plan_version) select $1,$2,capability_key,value_type,boolean_value,integer_value,plan_key,plan_version from public.plan_entitlements where plan_key='admin_pilot'",
      [ORG_A, subscription.id],
    );
    await db.query(
      "with guard as (select set_config('app.commercial_go_live',$1::text,true)) update public.organisations set operational_state='live',went_live_at=now() from guard where id=$1::uuid",
      [ORG_A],
    );
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
  }, 60_000);
  afterEach(async () => db?.close());

  it("atomically creates an invitation and queued delivery without returning a token", async () => {
    const revision = (
      await db.query<{ revision: string }>("select admin_revision::text revision from public.organisations where id=$1", [ORG_A])
    ).rows[0].revision;
    const created = (
      await db.query<{ value: Record<string, unknown> }>(
        "select public.execute_commercial_admin_command($1,'create_manager_invitation',$2::jsonb,$3,$4) value",
        [ORG_A, JSON.stringify({ email: "manager@example.test", role: "site_manager", siteId: SITE_A1 }), "78000000-0000-4000-8000-000000000001", revision],
      )
    ).rows[0].value;
    expect(created).toMatchObject({ outcome: "success", code: "invitation_created" });
    expect(JSON.stringify(created)).not.toMatch(/token|acceptanceUrl/i);
    await resetTenantDatabaseRole(db);
    const evidence = (
      await db.query<{ invitations: number; outbox: number; vault: number; rawPayload: number }>(
        `select
          (select count(*)::int from public.organisation_invitations where organisation_id=$1 and invited_email='manager@example.test') invitations,
          (select count(*)::int from public.message_outbox where organisation_id=$1 and delivery_status='queued') outbox,
          (select count(*)::int from vault.secrets where name like 'commercial-invitation-%') vault,
          (select count(*)::int from public.message_outbox where payload::text~*'token|acceptanceUrl') "rawPayload"`,
        [ORG_A],
      )
    ).rows[0];
    expect(evidence).toEqual({ invitations: 1, outbox: 1, vault: 1, rawPayload: 0 });

  });

  it("throttles resend independently while preserving the original invitation", async () => {
    const revision = (
      await db.query<{ revision: string }>("select admin_revision::text revision from public.organisations where id=$1", [ORG_A])
    ).rows[0].revision;
    const created = (
      await db.query<{ value: { resourceId: string; revision: string } }>(
        "select public.execute_commercial_admin_command($1,'create_manager_invitation',$2::jsonb,$3,$4) value",
        [ORG_A, JSON.stringify({ email: "resend@example.test", role: "site_manager", siteId: SITE_A1 }), "78000000-0000-4000-8000-000000000002", revision],
      )
    ).rows[0].value;
    const resent = (
      await db.query<{ value: { outcome: string; code: string } }>(
        "select public.execute_commercial_admin_command($1,'resend_invitation',$2::jsonb,$3,$4) value",
        [ORG_A, JSON.stringify({ invitationId: created.resourceId }), "78000000-0000-4000-8000-000000000003", created.revision],
      )
    ).rows[0].value;
    expect(resent).toMatchObject({ outcome: "conflict", code: "delivery_retry_throttled" });
    await resetTenantDatabaseRole(db);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from public.organisation_invitations where organisation_id=$1 and invited_email='resend@example.test'",
          [ORG_A],
        )
      ).rows[0].count,
    ).toBe(1);
  });
});
