import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPilotReadinessBillingDatabase } from "./helpers/onboarding-persistence-db";
import { ORG_A, resetTenantDatabaseRole } from "./helpers/tenant-primitives-db";

const migration = readFileSync(
  resolve("supabase/migrations/20260904011238_notification_delivery_lifecycle.sql"),
  "utf8",
);

async function useServiceRole(db: PGlite) {
  await resetTenantDatabaseRole(db);
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.exec("set role service_role");
}

async function insertAcceptedMessage(db: PGlite, providerReference: string, recipient: string) {
  return (
    await db.query<{ id: string }>(
      `insert into public.message_outbox(
         organisation_id,message_type,recipient_address,template_version,payload,
         delivery_status,provider_message_reference,provider_accepted_at,sent_at,notification_key
       ) values($1,'trial_ending',$2,'trial_ending_v1','{}','sent',$3,now(),now(),$4)
       returning id`,
      [ORG_A, recipient, providerReference, `test/${providerReference}`],
    )
  ).rows[0].id;
}

describe("notification delivery lifecycle", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createPilotReadinessBillingDatabase();
    await db.exec(migration);
  }, 40_000);

  afterEach(async () => db?.close());

  it("records delivered provider events idempotently through service role only", async () => {
    const outboxId = await insertAcceptedMessage(db, "provider_message_1", "owner@example.test");
    await expect(
      db.query(
        "select public.record_notification_provider_event($1,$2,'delivered',now(),null)",
        ["provider_event_1", "provider_message_1"],
      ),
    ).rejects.toThrow(/service role required|permission denied/i);

    await useServiceRole(db);
    const first = (
      await db.query<{ value: { outcome: string; deliveryStatus: string } }>(
        "select public.record_notification_provider_event($1,$2,'delivered',now(),null) value",
        ["provider_event_1", "provider_message_1"],
      )
    ).rows[0].value;
    const replay = (
      await db.query<{ value: { outcome: string } }>(
        "select public.record_notification_provider_event($1,$2,'delivered',now(),null) value",
        ["provider_event_1", "provider_message_1"],
      )
    ).rows[0].value;

    expect(first).toEqual({ outcome: "recorded", deliveryStatus: "delivered" });
    expect(replay).toEqual({ outcome: "already_recorded" });
    await resetTenantDatabaseRole(db);
    expect(
      (
        await db.query<{ status: string; count: number }>(
          `select provider_delivery_status status,
             (select count(*)::int from public.notification_delivery_events where outbox_id=$1) count
           from public.message_outbox where id=$1`,
          [outboxId],
        )
      ).rows[0],
    ).toEqual({ status: "delivered", count: 1 });
  });

  it.each(["bounced", "complained", "suppressed"] as const)(
    "suppresses future delivery after a %s event",
    async (eventType) => {
      await insertAcceptedMessage(db, `provider_${eventType}`, "blocked@example.test");
      await useServiceRole(db);
      const result = (
        await db.query<{ value: { outcome: string; deliveryStatus: string } }>(
          "select public.record_notification_provider_event($1,$2,$3,now(),'provider_rejected') value",
          [`event_${eventType}`, `provider_${eventType}`, eventType],
        )
      ).rows[0].value;
      expect(result).toEqual({ outcome: "recorded", deliveryStatus: eventType });

      await resetTenantDatabaseRole(db);
      const queued = (
        await db.query<{ delivery_status: string; last_error_code: string }>(
          `insert into public.message_outbox(
             organisation_id,message_type,recipient_address,template_version,payload,next_attempt_at,notification_key
           ) values($1,'trial_ending','blocked@example.test','trial_ending_v1','{}',now(),$2)
           returning delivery_status,last_error_code`,
          [ORG_A, `test/blocked/${eventType}`],
        )
      ).rows[0];
      const suppressions = (
        await db.query<{ count: number }>(
          `select count(*)::int count from public.notification_recipient_suppressions
           where organisation_id=$1 and recipient_address='blocked@example.test' and cleared_at is null`,
          [ORG_A],
        )
      ).rows[0].count;

      expect(queued).toEqual({
        delivery_status: "permanent_failure",
        last_error_code: "recipient_suppressed",
      });
      expect(suppressions).toBe(1);
    },
  );

  it("keeps provider event evidence append-only and supports audited suppression clearing", async () => {
    await insertAcceptedMessage(db, "provider_message_2", "recovered@example.test");
    await useServiceRole(db);
    await db.query(
      "select public.record_notification_provider_event('provider_event_2','provider_message_2','bounced',now(),'hard_bounce')",
    );
    const cleared = (
      await db.query<{ value: { outcome: string } }>(
        "select public.clear_notification_recipient_suppression($1,$2,$3) value",
        [ORG_A, " RECOVERED@example.test ", "address_confirmed_by_operator"],
      )
    ).rows[0].value;
    expect(cleared).toEqual({ outcome: "cleared" });

    await resetTenantDatabaseRole(db);
    await expect(db.query("update public.notification_delivery_events set failure_code=null"))
      .rejects.toThrow(/immutable/i);
    await expect(db.query("delete from public.notification_delivery_events"))
      .rejects.toThrow(/immutable/i);
    expect(
      (
        await db.query<{ cleared: boolean }>(
          `select (cleared_at is not null and cleared_reason='address_confirmed_by_operator') cleared
           from public.notification_recipient_suppressions
           where organisation_id=$1 and recipient_address='recovered@example.test'`,
          [ORG_A],
        )
      ).rows[0].cleared,
    ).toBe(true);
  });
});
