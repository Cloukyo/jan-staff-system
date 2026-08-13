begin;

select plan(18);

select ok(
  to_regclass('public.legal_document_versions') is not null
  and to_regclass('public.legal_acceptances') is not null,
  'versioned legal document and immutable acceptance tables exist'
);

select is(
  (select count(*)::bigint from public.legal_document_versions where is_current and locale = 'en-GB'),
  3::bigint,
  'all three required en-GB legal documents have one current version'
);

select ok(
  has_function_privilege('authenticated', 'public.get_or_create_onboarding_bootstrap()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_or_create_onboarding_bootstrap()', 'EXECUTE'),
  'only authenticated callers can create or resume a bootstrap session'
);

select ok(
  has_function_privilege('authenticated', 'public.execute_onboarding_bootstrap_command(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.execute_onboarding_bootstrap_command(jsonb)', 'EXECUTE'),
  'only authenticated callers can use the guarded bootstrap command boundary'
);

select ok(
  has_table_privilege('authenticated', 'public.legal_acceptances', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_acceptances', 'INSERT')
  and not has_table_privilege('authenticated', 'public.legal_acceptances', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.legal_acceptances', 'DELETE'),
  'customer legal acceptance access is read-only outside guarded commands'
);

select ok(
  (select count(*) = 8 from information_schema.columns column_info
   where column_info.table_schema = 'public'
     and column_info.table_name = 'organisations'
     and column_info.column_name in (
       'contact_email', 'contact_phone', 'address_line_1', 'address_line_2',
       'locality', 'region', 'postcode', 'logo_metadata'
     )),
  'organisation bootstrap fields are present without a site dependency'
);

select ok(
  not exists (
    select 1 from information_schema.routine_privileges privilege
    where privilege.specific_schema = 'private'
      and privilege.grantee in ('anon', 'authenticated')
      and privilege.routine_name like 'commercial_onboarding_%'
  ),
  'private bootstrap helpers are not executable by browser roles'
);

select ok(
  not has_function_privilege('authenticated', 'private.execute_onboarding_bootstrap_command_7a(jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.commercial_allocate_site_slug(uuid,text)', 'EXECUTE'),
  'first-site implementation helpers are unavailable to browser roles'
);

select ok(
  not has_table_privilege('authenticated', 'public.onboarding_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.onboarding_command_receipts', 'INSERT'),
  'first-site audit evidence and command receipts remain RPC-only'
);

select ok(
  not has_table_privilege('authenticated', 'public.membership_site_access', 'INSERT'),
  'owner site access cannot be granted directly by a browser client'
);

select ok(
  not has_table_privilege('authenticated', 'public.organisation_sites', 'INSERT')
  and not has_table_privilege('authenticated', 'public.site_settings', 'INSERT'),
  'site and site-default creation are restricted to guarded server boundaries'
);

select ok(
  to_regclass('public.plans') is not null
  and to_regclass('public.plan_entitlements') is not null
  and to_regclass('public.organisation_subscriptions') is not null
  and to_regclass('public.organisation_entitlements') is not null
  and to_regclass('public.organisation_usage') is not null,
  'provider-neutral plan, subscription, entitlement and usage tables exist'
);

select is(
  (select count(*)::bigint from public.plans where active and plan_key = 'preview_standard'),
  1::bigint,
  'one fictional active Preview plan is available'
);

select ok(
  not exists (select 1 from public.plan_entitlements
    where capability_key = 'attendance.offline' and boolean_value),
  'no plan can enable offline attendance'
);

select ok(
  not has_table_privilege('authenticated', 'public.organisation_subscriptions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organisation_entitlements', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organisation_usage', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.organisation_subscription_state_events', 'INSERT'),
  'subscription, entitlement and usage mutations are denied outside guarded boundaries'
);

select ok(
  to_regclass('public.organisation_subscription_state_events') is not null,
  'subscription lifecycle transitions have an append-only audit table'
);

select ok(
  not has_function_privilege('authenticated',
    'private.transition_commercial_subscription(uuid,text,text,boolean,timestamptz,timestamptz,timestamptz,text,uuid)', 'EXECUTE'),
  'subscription lifecycle transitions remain behind a private audited boundary'
);

select ok(
  has_function_privilege('authenticated', 'public.commercial_capability_decision(uuid,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commercial_capability_decision(uuid,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.commercial_capability_decision(uuid,text,jsonb)', 'EXECUTE'),
  'capability decisions use an authenticated guarded boundary with a private evaluator'
);

select * from finish();
rollback;
