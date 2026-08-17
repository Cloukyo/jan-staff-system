import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBillingLifecycleDatabase } from "./helpers/onboarding-persistence-db";
import { MEMBERSHIP_A_OWNER, ORG_A, USER_A_OWNER, resetTenantDatabaseRole, setTenantAuthUser } from "./helpers/tenant-primitives-db";

async function seedSubscription(db: PGlite, state: "trial_active" | "active" = "trial_active", expiredTrial = true) {
  await resetTenantDatabaseRole(db);
  await db.exec(`
    insert into public.plans(plan_key,plan_version,display_name,summary,country_code,pricing_status,feature_highlights,active)
    values('billing_test',1,'Billing Test','Fictional billing test plan','GB','commercially_approved','["Core attendance"]',true);
    insert into public.plan_entitlements values
      ('billing_test',1,'attendance.core','boolean',true,null,now()),
      ('billing_test',1,'attendance.offline','boolean',false,null,now()),
      ('billing_test',1,'staff.active.limit','integer',null,5,now()),
      ('billing_test',1,'exports.advanced','boolean',true,null,now());
  `);
  const trial = state === "trial_active"
    ? expiredTrial ? "true,60,now()-interval '61 days',now()-interval '1 day'" : "true,60,now(),now()+interval '1440 hours'"
    : "false,null,null,null";
  const subscription = (await db.query<{ id: string }>(`insert into public.organisation_subscriptions
    (organisation_id,plan_key,plan_version,state,is_current,ordinary_initial_trial,trial_duration_days,trial_started_at,trial_ends_at,created_by_membership_id)
    values($1,'billing_test',1,$2,true,${trial},$3) returning id`, [ORG_A, state, MEMBERSHIP_A_OWNER])).rows[0];
  await db.query(`insert into public.organisation_entitlements(organisation_id,subscription_id,capability_key,value_type,boolean_value,integer_value,source_plan_key,source_plan_version)
    select $1,$2,capability_key,value_type,boolean_value,integer_value,plan_key,plan_version from public.plan_entitlements where plan_key='billing_test'`, [ORG_A, subscription.id]);
  return subscription.id;
}

describe("commercial billing lifecycle persistence", () => {
  let db: PGlite;
  beforeEach(async () => { db = await createBillingLifecycleDatabase(); }, 40_000);
  afterEach(async () => { await db?.close(); });

  it("moves an expired trial through exact conversion grace then restricted mode without changing tenant visibility", async () => {
    const subscriptionId = await seedSubscription(db);
    const before = (await db.query<{ staff: number; sites: number }>("select (select count(*)::int from public.staff_profiles where organisation_id=$1) staff,(select count(*)::int from public.organisation_sites where organisation_id=$1) sites", [ORG_A])).rows[0];
    expect((await db.query<{ changed: number }>("select private.reconcile_commercial_billing(now()) changed")).rows[0].changed).toBe(1);
    let row = (await db.query<{ state: string; seconds: number }>("select state,extract(epoch from(grace_ends_at-grace_started_at))::int seconds from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0];
    expect(row).toEqual({ state: "past_due", seconds: 604800 });
    expect((await db.query<{ changed: number }>("select private.reconcile_commercial_billing(now()+interval '8 days') changed")).rows[0].changed).toBe(1);
    row = (await db.query<{ state: string; seconds: number }>("select state,extract(epoch from(grace_ends_at-grace_started_at))::int seconds from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0];
    expect(row.state).toBe("billing_suspended");
    expect((await db.query("select (select count(*)::int from public.staff_profiles where organisation_id=$1) staff,(select count(*)::int from public.organisation_sites where organisation_id=$1) sites", [ORG_A])).rows[0]).toEqual(before);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    expect((await db.query("select id from public.organisations where id=$1", [ORG_A])).rows).toHaveLength(1);
  });

  it("enforces the restricted continuity and growth matrix with offline always disabled", async () => {
    await seedSubscription(db);
    await db.query("select private.reconcile_commercial_billing(now()+interval '8 days')");
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    const decision = async (key: string) => (await db.query<{ value: { allowed: boolean; decisionCode: string } }>("select public.commercial_capability_decision($1,$2,'{}') value", [ORG_A, key])).rows[0].value;
    await expect(decision("attendance.core")).resolves.toMatchObject({ allowed: true, decisionCode: "allowed_continuity" });
    await expect(decision("attendance.clock_out")).resolves.toMatchObject({ allowed: true });
    await expect(decision("staff.active.limit")).resolves.toMatchObject({ allowed: false, decisionCode: "restricted_mode" });
    await expect(decision("exports.advanced")).resolves.toMatchObject({ allowed: false });
    await expect(decision("attendance.offline")).resolves.toMatchObject({ allowed: false, decisionCode: "offline_disabled" });
  });

  it("keeps a historically live kiosk operational while cancellation is scheduled", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await resetTenantDatabaseRole(db);
    await db.query("with guard as (select set_config('app.commercial_go_live',$1::text,true)) update public.organisations set operational_state='live',went_live_at=now() from guard where id=$1::uuid", [ORG_A]);
    await db.query("with guard as (select set_config('app.commercial_subscription_transition',$1::text,true)) update public.organisation_subscriptions set state='cancelled_at_period_end',cancel_at_period_end=true,current_period_started_at=now(),current_period_ends_at=now()+interval '20 days' from guard where id=$1::uuid", [subscriptionId]);
    await db.query(`insert into public.kiosk_devices(device_name,token_hash,active,expires_at,organisation_id,site_id,activated_by_membership_id,offline_enabled)
      select 'Cancellation-safe kiosk',sha256(convert_to('fictional-cancellation-kiosk-token','UTF8')),true,now()+interval '30 days',$1,s.id,m.id,false
      from public.organisation_sites s join public.organisation_memberships m on m.organisation_id=s.organisation_id
      where s.organisation_id=$1 and m.auth_user_id=$2 order by s.created_at limit 1`, [ORG_A, USER_A_OWNER]);
    const heartbeat = (await db.query<{ result: { outcome: string; preLive: boolean } }>(
      "select public.record_commercial_kiosk_heartbeat('fictional-cancellation-kiosk-token','0.1.0',1,'tablet') result",
    )).rows[0].result;
    expect(heartbeat).toMatchObject({ outcome: "connected", preLive: false });
  });

  it("records duplicate and stale provider events once and recovers payment idempotently", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_fictional')", [ORG_A, MEMBERSHIP_A_OWNER]);
    const event = { id: "evt_test_paid", type: "invoice.paid", created: 1786723200, livemode: false, objectId: "in_test_1", customerId: "cus_test_fictional", subscriptionId: "sub_test_1", providerState: null, periodStart: 1786723200, periodEnd: 1789401600, cancelAtPeriodEnd: null, priceId: "price_test_1" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(event)])).rows[0].result).toBe("renewal_succeeded");
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(event)])).rows[0].result).toBe("duplicate");
    const stale = { ...event, id: "evt_test_old_failure", type: "invoice.payment_failed", created: event.created - 60 };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(stale)])).rows[0].result).toBe("stale_provider_event");
    expect((await db.query<{ state: string; events: number }>("select state,(select count(*)::int from public.billing_lifecycle_events where subscription_id=$1 and event_type='renewal_succeeded') events from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0]).toEqual({ state: "active", events: 1 });
  });

  it("activates a preserved trial only after a verified positive paid invoice", async () => {
    const subscriptionId = await seedSubscription(db, "trial_active", false);
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_trial_conversion')", [ORG_A, MEMBERSHIP_A_OWNER]);
    const before = (await db.query<{ started: string; ends: string }>(
      "select trial_started_at::text started,trial_ends_at::text ends from public.organisation_subscriptions where id=$1",
      [subscriptionId],
    )).rows[0];
    const paid = {
      id: "evt_test_trial_conversion_paid",
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      objectId: "in_test_trial_conversion_paid",
      customerId: "cus_test_trial_conversion",
      subscriptionId: "sub_test_trial_conversion",
      providerState: null,
      periodStart: Math.floor(Date.now() / 1000),
      periodEnd: Math.floor(Date.now() / 1000) + 31 * 86_400,
      cancelAtPeriodEnd: null,
      priceId: "price_test_1",
      amountPaid: 4900,
    };

    expect((await db.query<{ result: string }>(
      "select public.commercial_process_billing_event('preview',$1::jsonb) result",
      [JSON.stringify(paid)],
    )).rows[0].result).toBe("subscription_activated");
    expect((await db.query<{ state: string; started: string; ends: string; ordinary: boolean }>(
      "select state,trial_started_at::text started,trial_ends_at::text ends,ordinary_initial_trial ordinary from public.organisation_subscriptions where id=$1",
      [subscriptionId],
    )).rows[0]).toEqual({ state: "active", ...before, ordinary: true });
  });

  it("uses a 14-day paid-payment grace and restores active service without restarting trial", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_recovery')", [ORG_A, MEMBERSHIP_A_OWNER]);
    const failed = { id: "evt_test_failure", type: "invoice.payment_failed", created: 1786723200, livemode: false, objectId: "in_test_fail", customerId: "cus_test_recovery", subscriptionId: "sub_test_recovery", providerState: null, periodStart: null, periodEnd: null, cancelAtPeriodEnd: null, priceId: "price_test_1" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(failed)])).rows[0].result).toBe("payment_failed");
    expect((await db.query<{ state: string; seconds: number }>("select state,extract(epoch from(grace_ends_at-grace_started_at))::int seconds from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0]).toEqual({ state: "past_due", seconds: 1209600 });
    const recovered = { ...failed, id: "evt_test_recovered", type: "invoice.paid", created: failed.created + 120 };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(recovered)])).rows[0].result).toBe("payment_recovered");
    expect((await db.query<{ state: string; grace: string | null; ordinary: boolean }>("select state,grace_ends_at::text grace,ordinary_initial_trial ordinary from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0]).toEqual({ state: "active", grace: null, ordinary: false });
  });

  it("does not extend payment grace when later failure events arrive", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_grace_once')", [ORG_A, MEMBERSHIP_A_OWNER]);
    const first = { id: "evt_test_failure_first", type: "invoice.payment_failed", created: 1786723200, livemode: false, objectId: "in_test_first", customerId: "cus_test_grace_once", subscriptionId: "sub_test_grace_once", providerState: null, periodStart: null, periodEnd: null, cancelAtPeriodEnd: null, priceId: null };
    await db.query("select public.commercial_process_billing_event('preview',$1::jsonb)", [JSON.stringify(first)]);
    const initial = (await db.query<{ started: string; ended: string }>("select grace_started_at::text started,grace_ends_at::text ended from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0];
    const later = { ...first, id: "evt_test_failure_later", objectId: "in_test_later", created: first.created + 5 * 86_400 };
    await db.query("select public.commercial_process_billing_event('preview',$1::jsonb)", [JSON.stringify(later)]);
    expect((await db.query<{ started: string; ended: string }>("select grace_started_at::text started,grace_ends_at::text ended from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0]).toEqual(initial);
  });

  it("prioritises failure and cancellation over changed-price materialisation and preserves active trials", async () => {
    const subscriptionId = await seedSubscription(db, "trial_active", false);
    await db.exec(`
      insert into public.plans(plan_key,plan_version,display_name,summary,country_code,pricing_status,feature_highlights,active)
      values('billing_changed',1,'Billing Changed','Fictional changed plan','GB','commercially_approved','["Core attendance"]',true);
      insert into public.plan_entitlements values
        ('billing_changed',1,'attendance.core','boolean',true,null,now()),
        ('billing_changed',1,'attendance.offline','boolean',false,null,now());
    `);
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_changed_price')", [ORG_A, MEMBERSHIP_A_OWNER]);
    await db.query("select public.commercial_record_provider_price('preview','billing_changed',1,'price_test_changed')");
    const update = { id: "evt_test_trial_plan_update", type: "customer.subscription.updated", created: Math.floor(Date.now() / 1000), livemode: false, objectId: "sub_test_changed", customerId: "cus_test_changed_price", subscriptionId: "sub_test_changed", providerState: "active", periodStart: null, periodEnd: null, cancelAtPeriodEnd: false, priceId: "price_test_changed" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(update)])).rows[0].result).toBe("provider_subscription_observed");
    expect((await db.query<{ state: string; plan: string; current: number }>("select state,plan_key plan,(select count(*)::int from public.organisation_subscriptions where organisation_id=$1 and is_current) current from public.organisation_subscriptions where id=$2", [ORG_A, subscriptionId])).rows[0]).toEqual({ state: "trial_active", plan: "billing_test", current: 1 });
    const failed = { ...update, id: "evt_test_changed_failure", type: "invoice.payment_failed", created: update.created + 61 * 86_400 };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(failed)])).rows[0].result).toBe("payment_failed");
    expect((await db.query<{ state: string; plan: string }>("select state,plan_key plan from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0]).toEqual({ state: "past_due", plan: "billing_test" });
    const deleted = { ...update, id: "evt_test_changed_deleted", type: "customer.subscription.deleted", created: update.created + 61 * 86_400 + 60 };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(deleted)])).rows[0].result).toBe("cancellation_effective");
    expect((await db.query<{ state: string; plan: string }>("select state,plan_key plan from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0]).toEqual({ state: "cancelled", plan: "billing_test" });
  });

  it("maps a later subscription failure before an older invoice and rejects foreign subscription IDs", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_ordering')", [ORG_A, MEMBERSHIP_A_OWNER]);
    await db.query("with configured as (select set_config('app.commercial_subscription_transition',$1::text,true)) update public.organisation_subscriptions set provider='stripe',provider_subscription_id='sub_test_ordering' from configured where id=$1::uuid", [subscriptionId]);
    const updated = { id: "evt_test_updated_past_due", type: "customer.subscription.updated", created: 1786723300, livemode: false, objectId: "sub_test_ordering", customerId: "cus_test_ordering", subscriptionId: "sub_test_ordering", providerState: "past_due", periodStart: null, periodEnd: null, cancelAtPeriodEnd: false, priceId: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(updated)])).rows[0].result).toBe("payment_failed");
    const olderInvoice = { ...updated, id: "evt_test_older_invoice", type: "invoice.payment_failed", created: updated.created - 60, objectId: "in_test_ordering", providerState: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(olderInvoice)])).rows[0].result).toBe("stale_provider_event");
    const foreign = { ...updated, id: "evt_test_foreign_subscription", created: updated.created + 60, subscriptionId: "sub_test_foreign", objectId: "sub_test_foreign" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(foreign)])).rows[0].result).toBe("subscription_mismatch");
    expect((await db.query<{ state: string }>("select state from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0].state).toBe("past_due");
  });

  it("uses newer active subscription evidence to reject an older delayed failure without treating it as payment", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_active_ordering')", [ORG_A, MEMBERSHIP_A_OWNER]);
    await db.query("with configured as (select set_config('app.commercial_subscription_transition',$1::text,true)) update public.organisation_subscriptions set provider='stripe',provider_subscription_id='sub_test_active_ordering' from configured where id=$1::uuid", [subscriptionId]);
    const active = { id: "evt_test_newer_active", type: "customer.subscription.updated", created: 1786723400, livemode: false, objectId: "sub_test_active_ordering", customerId: "cus_test_active_ordering", subscriptionId: "sub_test_active_ordering", providerState: "active", periodStart: null, periodEnd: null, cancelAtPeriodEnd: false, priceId: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(active)])).rows[0].result).toBe("provider_subscription_observed");
    const olderFailure = { ...active, id: "evt_test_delayed_failure", type: "invoice.payment_failed", objectId: "in_test_delayed_failure", providerState: null, created: active.created - 60 };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(olderFailure)])).rows[0].result).toBe("stale_provider_event");
    expect((await db.query<{ state: string }>("select state from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0].state).toBe("active");
  });

  it("uses deterministic same-second precedence for payment success over failure", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_same_second_payment')", [ORG_A, MEMBERSHIP_A_OWNER]);
    const failure = { id: "evt_test_same_second_failure", type: "invoice.payment_failed", created: 1786723450, livemode: false, objectId: "in_test_same_second_failure", customerId: "cus_test_same_second_payment", subscriptionId: "sub_test_same_second_payment", providerState: null, periodStart: null, periodEnd: null, cancelAtPeriodEnd: null, priceId: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(failure)])).rows[0].result).toBe("payment_failed");
    const success = { ...failure, id: "evt_test_same_second_success", type: "invoice.paid", objectId: "in_test_same_second_success" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(success)])).rows[0].result).toBe("payment_recovered");
    expect((await db.query<{ state: string }>("select state from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0].state).toBe("active");
  });

  it("keeps cancellation effective when a same-second paid invoice arrives later", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_same_second_cancel')", [ORG_A, MEMBERSHIP_A_OWNER]);
    await db.query("with configured as (select set_config('app.commercial_subscription_transition',$1::text,true)) update public.organisation_subscriptions set provider='stripe',provider_subscription_id='sub_test_same_second_cancel' from configured where id=$1::uuid", [subscriptionId]);
    const deleted = { id: "evt_test_same_second_deleted", type: "customer.subscription.deleted", created: 1786723460, livemode: false, objectId: "sub_test_same_second_cancel", customerId: "cus_test_same_second_cancel", subscriptionId: "sub_test_same_second_cancel", providerState: "canceled", periodStart: null, periodEnd: null, cancelAtPeriodEnd: false, priceId: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(deleted)])).rows[0].result).toBe("cancellation_effective");
    const paid = { ...deleted, id: "evt_test_same_second_paid", type: "invoice.paid", objectId: "in_test_same_second_cancel", providerState: null, cancelAtPeriodEnd: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(paid)])).rows[0].result).toBe("stale_provider_event");
    expect((await db.query<{ state: string }>("select state from public.organisation_subscriptions where id=$1", [subscriptionId])).rows[0].state).toBe("cancelled");
  });

  it("prevents duplicate subscription checkout and keeps failed webhook evidence retryable", async () => {
    const subscriptionId = await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_checkout_guard')", [ORG_A, MEMBERSHIP_A_OWNER]);
    await db.query("select public.commercial_record_provider_price('preview','billing_test',1,'price_test_checkout_guard')");
    await db.query("with configured as (select set_config('app.commercial_subscription_transition',$1::text,true)) update public.organisation_subscriptions set provider='stripe',provider_subscription_id='sub_test_checkout_guard' from configured where id=$1::uuid", [subscriptionId]);
    await expect(db.query("select public.commercial_prepare_checkout_intent($1,$2,'preview','billing_test',1,'price_test_checkout_guard',$3,$4)", [ORG_A, MEMBERSHIP_A_OWNER, crypto.randomUUID(), "a".repeat(64)])).rejects.toThrow(/existing provider subscription/i);

    const broken = { id: "evt_test_processing_failure", type: "invoice.paid", created: 1786723500, livemode: false, objectId: "in_test_broken", customerId: "cus_test_checkout_guard", subscriptionId: "sub_test_checkout_guard", providerState: null, periodStart: 1789401600, periodEnd: 1786723200, cancelAtPeriodEnd: null, priceId: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(broken)])).rows[0].result).toBe("processing_failed");
    expect((await db.query<{ status: string }>("select processing_status status from public.billing_webhook_events where provider_event_id=$1", [broken.id])).rows[0].status).toBe("failed");
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(broken)])).rows[0].result).toBe("processing_failed");
  });

  it("reconciles one live Checkout intent and rejects a changed concurrent request", async () => {
    await seedSubscription(db, "active");
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_single_checkout')", [ORG_A, MEMBERSHIP_A_OWNER]);
    await db.query("select public.commercial_record_provider_price('preview','billing_test',1,'price_test_single_checkout')");
    const firstKey = crypto.randomUUID();
    const requestHash = "b".repeat(64);
    const first = (await db.query<{ result: { intentId: string } }>("select public.commercial_prepare_checkout_intent($1,$2,'preview','billing_test',1,'price_test_single_checkout',$3,$4) result", [ORG_A, MEMBERSHIP_A_OWNER, firstKey, requestHash])).rows[0].result;
    const replay = (await db.query<{ result: { intentId: string } }>("select public.commercial_prepare_checkout_intent($1,$2,'preview','billing_test',1,'price_test_single_checkout',$3,$4) result", [ORG_A, MEMBERSHIP_A_OWNER, crypto.randomUUID(), requestHash])).rows[0].result;
    expect(replay.intentId).toBe(first.intentId);
    await expect(db.query("select public.commercial_prepare_checkout_intent($1,$2,'preview','billing_test',1,'price_test_single_checkout',$3,$4)", [ORG_A, MEMBERSHIP_A_OWNER, crypto.randomUUID(), "c".repeat(64)])).rejects.toThrow(/already in progress/i);
    expect((await db.query<{ count: number }>("select count(*)::int count from public.billing_checkout_intents where organisation_id=$1 and status in ('processing','ready')", [ORG_A])).rows[0].count).toBe(1);
  });

  it("changes plan versions without deleting an over-limit existing footprint and cancels at period end", async () => {
    const original = await seedSubscription(db, "active");
    await db.exec(`
      insert into public.plans(plan_key,plan_version,display_name,summary,country_code,pricing_status,feature_highlights,active)
      values('billing_small',1,'Billing Small','Fictional lower-limit plan','GB','commercially_approved','["Core attendance"]',true);
      insert into public.plan_entitlements values
        ('billing_small',1,'attendance.core','boolean',true,null,now()),
        ('billing_small',1,'attendance.offline','boolean',false,null,now()),
        ('billing_small',1,'staff.active.limit','integer',null,0,now()),
        ('billing_small',1,'exports.advanced','boolean',false,null,now());
    `);
    await db.query("select public.commercial_record_provider_customer($1,$2,'preview','cus_test_plan_change')", [ORG_A, MEMBERSHIP_A_OWNER]);
    await db.query("select public.commercial_record_provider_price('preview','billing_small',1,'price_test_small')");
    const changed = { id: "evt_test_plan_change", type: "invoice.paid", created: 1786723200, livemode: false, objectId: "in_test_change", customerId: "cus_test_plan_change", subscriptionId: "sub_test_change", providerState: null, periodStart: 1786723200, periodEnd: 1789401600, cancelAtPeriodEnd: false, priceId: "price_test_small" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(changed)])).rows[0].result).toBe("plan_changed");
    const state = (await db.query<{ plan: string; over_limit: boolean; staff: number; prior_current: boolean }>(`select current.plan_key plan,current.over_limit,
      (select count(*)::int from public.staff_profiles where organisation_id=$1) staff,
      (select is_current from public.organisation_subscriptions where id=$2) prior_current
      from public.organisation_subscriptions current where current.organisation_id=$1 and current.is_current`, [ORG_A, original])).rows[0];
    expect(state).toEqual({ plan: "billing_small", over_limit: true, staff: 1, prior_current: false });
    const cancelled = { ...changed, id: "evt_test_cancel", type: "customer.subscription.updated", objectId: "sub_test_change", created: changed.created + 60, cancelAtPeriodEnd: true, priceId: "price_test_small" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(cancelled)])).rows[0].result).toBe("cancellation_requested");
    expect((await db.query<{ state: string; cancel_at_period_end: boolean }>("select state,cancel_at_period_end from public.organisation_subscriptions where organisation_id=$1 and is_current", [ORG_A])).rows[0]).toEqual({ state: "cancelled_at_period_end", cancel_at_period_end: true });
    const adjustment = { ...cancelled, id: "evt_test_paid_adjustment", type: "invoice.paid", objectId: "in_test_paid_adjustment", created: cancelled.created + 30, cancelAtPeriodEnd: null, providerState: null };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(adjustment)])).rows[0].result).toBe("renewal_succeeded");
    expect((await db.query<{ state: string; cancel_at_period_end: boolean }>("select state,cancel_at_period_end from public.organisation_subscriptions where organisation_id=$1 and is_current", [ORG_A])).rows[0]).toEqual({ state: "cancelled_at_period_end", cancel_at_period_end: true });
    const resumed = { ...cancelled, id: "evt_test_resume", created: cancelled.created + 60, cancelAtPeriodEnd: false, providerState: "active" };
    expect((await db.query<{ result: string }>("select public.commercial_process_billing_event('preview',$1::jsonb) result", [JSON.stringify(resumed)])).rows[0].result).toBe("cancellation_resumed");
    expect((await db.query<{ state: string; cancel_at_period_end: boolean }>("select state,cancel_at_period_end from public.organisation_subscriptions where organisation_id=$1 and is_current", [ORG_A])).rows[0]).toEqual({ state: "active", cancel_at_period_end: false });
    expect((await db.query<{ changed: number }>("select private.reconcile_commercial_billing(to_timestamp($1)+interval '1 second') changed", [changed.periodEnd])).rows[0].changed).toBe(0);
  });

  it("exposes billing snapshots through an invoker wrapper while retaining the guarded private implementation", async () => {
    const functions = (await db.query<{ schema: string; securityDefiner: boolean; configuration: string[] | null }>(`
      select namespace.nspname as schema, procedure.prosecdef as "securityDefiner",
        procedure.proconfig as configuration
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where procedure.proname = 'commercial_billing_snapshot'
      order by namespace.nspname
    `)).rows;

    expect(functions).toEqual([
      { schema: "commercial_api_private", securityDefiner: true, configuration: ['search_path=""'] },
      { schema: "public", securityDefiner: false, configuration: ['search_path=""'] },
    ]);
    expect((await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','public.commercial_billing_snapshot(uuid)','EXECUTE') allowed",
    )).rows[0].allowed).toBe(true);
    expect((await db.query<{ allowed: boolean }>(
      "select has_function_privilege('anon','public.commercial_billing_snapshot(uuid)','EXECUTE') allowed",
    )).rows[0].allowed).toBe(false);
  });

  it("limits anonymous definer execution to explicit token-authenticated public workflows", async () => {
    const unexpectedAnonymous = (await db.query<{ signature: string }>(`
      select namespace.nspname || '.' || procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || ')' signature
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where procedure.prosecdef
        and namespace.nspname in ('public', 'private')
        and has_function_privilege('anon', procedure.oid, 'execute')
        and procedure.proname not in (
          'claim_commercial_kiosk',
          'change_tenant_aware_device_kiosk_pin',
          'get_tenant_aware_device_kiosk_roster',
          'inspect_manager_invitation',
          'inspect_staff_invitation',
          'perform_commercial_kiosk_attendance_action',
          'perform_tenant_aware_kiosk_attendance_action',
          'record_commercial_kiosk_heartbeat',
          'verify_commercial_device_kiosk_pin',
          'verify_commercial_kiosk_roster',
          'verify_tenant_aware_device_kiosk_pin'
        )
      order by signature
    `)).rows;
    expect(unexpectedAnonymous).toEqual([]);

    const unexpectedPrivateExecution = (await db.query<{ role_name: string; function_name: string }>(`
      select role_name, procedure.proname function_name
      from unnest(array['public','anon','authenticated']) role_name
      cross join pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'private'
        and has_function_privilege(role_name, procedure.oid, 'execute')
        and not (
          role_name = 'authenticated'
          and procedure.proname in (
            'attendance_row_is_readable', 'can_access_staff', 'can_read_onboarding_session',
            'current_membership', 'current_membership_id', 'has_permission',
            'has_site_permission', 'is_active_member', 'is_linked_staff'
          )
        )
      order by role_name, function_name
    `)).rows;
    expect(unexpectedPrivateExecution).toEqual([]);
    expect((await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','private.is_active_member(uuid)','EXECUTE') allowed",
    )).rows[0].allowed).toBe(true);

    const updateTriggers = (await db.query<{ configuration: string[] | null }>(`
      select proconfig configuration
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public' and procedure.proname = 'set_updated_at'
    `)).rows;
    expect(updateTriggers.every((trigger) => trigger.configuration?.includes('search_path=""'))).toBe(true);
  });

  it("denies cross-organisation billing reads and direct audit mutation", async () => {
    await seedSubscription(db);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await expect(db.query("select public.commercial_billing_snapshot('20000000-0000-0000-0000-000000000001')")).rejects.toThrow(/billing authority/i);
    await expect(db.query("insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source) select organisation_id,id,'payment_failed','customer' from public.organisation_subscriptions where organisation_id=$1", [ORG_A])).rejects.toThrow();
  });
});
