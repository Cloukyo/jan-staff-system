begin;

select plan(25);

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
select has_function('commercial_api_private','commercial_billing_snapshot',array['uuid'],'privileged billing snapshot implementation is outside the exposed schema');
select ok(
  not (select prosecdef from pg_proc where oid='public.commercial_billing_snapshot(uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid='commercial_api_private.commercial_billing_snapshot(uuid)'::regprocedure),
  'public billing snapshot is invoker-only while its guarded implementation retains required privilege'
);
select ok(
  (select coalesce(proconfig,array[]::text[]) @> array['search_path=""']
   from pg_proc where oid='commercial_api_private.commercial_billing_snapshot(uuid)'::regprocedure),
  'private billing snapshot implementation keeps an empty search path'
);
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

select is((
  select count(*)::bigint
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where procedure.prosecdef and namespace.nspname in('public','private')
    and has_function_privilege('anon',procedure.oid,'EXECUTE')
    and procedure.proname not in(
      'claim_commercial_kiosk','change_tenant_aware_device_kiosk_pin','get_tenant_aware_device_kiosk_roster',
      'inspect_manager_invitation','inspect_staff_invitation','perform_commercial_kiosk_attendance_action',
      'perform_tenant_aware_kiosk_attendance_action','record_commercial_kiosk_heartbeat',
      'verify_commercial_device_kiosk_pin','verify_commercial_kiosk_roster','verify_tenant_aware_device_kiosk_pin'
    )
),0::bigint,'anonymous definer execution is limited to explicit token-authenticated workflows');
select is((
  select count(*)::bigint from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='private'
    and (
      has_function_privilege('anon',procedure.oid,'EXECUTE')
      or (
        has_function_privilege('authenticated',procedure.oid,'EXECUTE')
        and procedure.proname not in(
          'attendance_row_is_readable','can_access_staff','can_read_onboarding_session','current_membership',
          'current_membership_id','has_permission','has_site_permission','is_active_member','is_linked_staff'
        )
      )
    )
),0::bigint,'private execution is limited to guarded RLS policy helpers');
select ok(has_function_privilege('authenticated','private.is_active_member(uuid)','EXECUTE'),'guarded membership helper remains available to RLS policies');
select ok((select coalesce(proconfig,array[]::text[]) @> array['search_path=""'] from pg_proc where oid='public.set_updated_at()'::regprocedure),'generic update trigger has an immutable empty search path');

select * from finish();
rollback;
