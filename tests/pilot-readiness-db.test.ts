import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPilotReadinessBillingDatabase } from "./helpers/onboarding-persistence-db";
import {
  MEMBERSHIP_A_OWNER,
  ORG_A,
  USER_A_ADMIN,
  USER_A_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";

async function seedEndingTrial(db: PGlite) {
  await resetTenantDatabaseRole(db);
  await db.query("update public.organisations set contact_email='billing@example.test' where id=$1", [ORG_A]);
  await db.exec(`
    insert into public.plans(plan_key,plan_version,display_name,summary,country_code,pricing_status,feature_highlights,active)
    values('pilot_test',1,'Pilot Test','Fictional pilot test plan','GB','commercially_approved','["Core attendance"]',true);
    insert into public.plan_entitlements values
      ('pilot_test',1,'attendance.core','boolean',true,null,now()),
      ('pilot_test',1,'attendance.offline','boolean',false,null,now()),
      ('pilot_test',1,'members.privileged.limit','integer',null,10,now()),
      ('pilot_test',1,'exports.customer','boolean',true,null,now());
  `);
  const subscription = (
    await db.query<{ id: string }>(
      `insert into public.organisation_subscriptions
        (organisation_id,plan_key,plan_version,state,is_current,ordinary_initial_trial,trial_duration_days,trial_started_at,trial_ends_at,created_by_membership_id)
       values($1,'pilot_test',1,'trial_active',true,true,60,now()-interval '47 days',now()+interval '13 days',$2) returning id`,
      [ORG_A, MEMBERSHIP_A_OWNER],
    )
  ).rows[0];
  await db.query(
    `insert into public.organisation_entitlements(organisation_id,subscription_id,capability_key,value_type,boolean_value,integer_value,source_plan_key,source_plan_version)
     select $1,$2,capability_key,value_type,boolean_value,integer_value,plan_key,plan_version from public.plan_entitlements where plan_key='pilot_test'`,
    [ORG_A, subscription.id],
  );
}

describe("pilot readiness database boundaries", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await createPilotReadinessBillingDatabase();
  }, 40_000);
  afterEach(async () => db?.close());

  it("enqueues each authoritative billing milestone once and claims only through service role", async () => {
    await seedEndingTrial(db);
    await expect(db.query("select public.claim_next_notification_delivery()"))
      .rejects.toThrow(/service role required|permission denied/i);
    await resetTenantDatabaseRole(db);
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    await db.exec("set role service_role");
    const first = (
      await db.query<{ value: { outcome: string; messageType: string; invitationToken?: string | null } }>(
        "select public.claim_next_notification_delivery() value",
      )
    ).rows[0].value;
    expect(first).toMatchObject({ outcome: "claimed", messageType: "trial_ending" });
    expect(first.invitationToken).toBeNull();
    await resetTenantDatabaseRole(db);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from public.message_outbox where organisation_id=$1 and message_type='trial_ending'",
          [ORG_A],
        )
      ).rows[0].count,
    ).toBe(1);
    await db.query("select private.enqueue_commercial_billing_notifications()");
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from public.message_outbox where organisation_id=$1 and message_type='trial_ending'",
          [ORG_A],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("allows only an AAL2 organisation owner to record a completed export", async () => {
    await seedEndingTrial(db);
    const query = "select public.record_customer_export_audit($1,'commercial_customer_export_v1','workforce-platform-export-2026-08-18.json',repeat('b',64),'{}') value";
    await setTenantAuthUser(db, USER_A_ADMIN, "aal2");
    await expect(db.query(query, [ORG_A]))
      .rejects.toThrow(/not authorised|permission denied/i);
    await setTenantAuthUser(db, USER_A_OWNER, "aal1");
    await expect(db.query(query, [ORG_A]))
      .rejects.toThrow(/AAL2|permission denied/i);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const result = (
      await db.query<{ value: { outcome: string; auditId: string } }>(query, [ORG_A])
    ).rows[0].value;
    expect(result).toMatchObject({ outcome: "recorded", auditId: expect.any(String) });
  });

  it("keeps customer export audit evidence append-only", async () => {
    await resetTenantDatabaseRole(db);
    const id = (
      await db.query<{ id: string }>(
        "insert into public.customer_export_audits(organisation_id,actor_membership_id,schema_version,file_name,digest,category_counts) values($1,$2,'commercial_customer_export_v1','workforce-platform-export-2026-08-18.json',repeat('a',64),'{}') returning id",
        [ORG_A, MEMBERSHIP_A_OWNER],
      )
    ).rows[0].id;
    await expect(db.query("update public.customer_export_audits set file_name='changed.json' where id=$1", [id]))
      .rejects.toThrow(/immutable/i);
    await expect(db.query("delete from public.customer_export_audits where id=$1", [id]))
      .rejects.toThrow(/immutable/i);
  });

  it("keeps the renamed kiosk attendance implementation self-qualified", async () => {
    const definition = (
      await db.query<{ definition: string }>(
        `select pg_get_functiondef(
          'public.perform_commercial_kiosk_attendance_action_pre_pin_guard(text,text,text,text,text,uuid)'::regprocedure
        ) definition`,
      )
    ).rows[0].definition;

    expect(definition).toContain(
      "perform_commercial_kiosk_attendance_action_pre_pin_guard.idempotency_key",
    );
    expect(definition).not.toContain(
      "perform_commercial_kiosk_attendance_action_7g.idempotency_key",
    );
  });
});
