begin;

select plan(18);

select has_table('public','billing_provider_customers','provider customer mappings exist');
select has_table('public','billing_provider_prices','environment-scoped provider prices exist');
select has_table('public','billing_checkout_intents','durable Checkout intents exist');
select has_table('public','billing_webhook_events','idempotent webhook ledger exists');
select has_table('public','billing_lifecycle_events','immutable billing lifecycle evidence exists');
select has_column('public','organisation_subscriptions','grace_ends_at','subscriptions record an authoritative grace deadline');
select has_column('public','organisation_subscriptions','last_provider_event_created_at','subscriptions fence stale provider events');
select has_column('public','organisation_subscriptions','last_provider_event_priority','equal-second provider event precedence is durable');
select has_column('public','organisation_subscriptions','last_provider_subscription_event_created_at','subscription-object revisions are tracked independently');
select has_column('public','organisation_subscriptions','last_provider_subscription_state','subscription-object state supports contradictory-event fencing');
select has_column('public','organisation_subscriptions','over_limit','downgrades preserve and identify excess footprint');
select has_function('public','commercial_billing_snapshot',array['uuid'],'billing status uses a guarded customer snapshot');
select ok(has_function_privilege('authenticated','public.commercial_billing_snapshot(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.commercial_billing_snapshot(uuid)','EXECUTE'),'billing snapshot is authenticated only');
select ok(not has_function_privilege('authenticated','public.commercial_process_billing_event(text,jsonb)','EXECUTE')
  and has_function_privilege('service_role','public.commercial_process_billing_event(text,jsonb)','EXECUTE'),'webhook reconciliation is service-only');
select ok(not has_table_privilege('authenticated','public.billing_webhook_events','INSERT')
  and not has_table_privilege('authenticated','public.billing_lifecycle_events','UPDATE')
  and not has_table_privilege('authenticated','public.billing_lifecycle_events','DELETE'),'customers cannot forge or rewrite billing evidence');
select ok((select relrowsecurity from pg_class where oid='public.billing_provider_customers'::regclass),'provider customer mappings have RLS');
select ok((select relrowsecurity from pg_class where oid='public.billing_webhook_events'::regclass),'webhook ledger has RLS');
select is((select boolean_value from public.plan_entitlements where plan_key='preview_standard' and plan_version=1 and capability_key='attendance.offline'),false,'billing preserves the offline-disabled entitlement');

select * from finish();
rollback;
