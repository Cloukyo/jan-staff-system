begin;

select plan(33);

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

select ok(
  (select count(*) = 6 from information_schema.columns
   where table_schema = 'public' and table_name = 'staff_import_batches'
     and column_name in ('onboarding_session_id','safe_filename','file_digest','expires_at','reviewed_set_hash','excluded_rows')),
  'staff import batches retain bounded resumable review evidence without raw files'
);

select ok(
  (select count(*) = 4 from information_schema.columns
   where table_schema = 'public' and table_name = 'staff_import_rows'
     and column_name in ('source_row_number','row_decision','warning_codes','attendance_eligible_requested')),
  'staff import rows retain explicit review and attendance-eligibility decisions'
);

select ok(
  not has_table_privilege('authenticated', 'public.staff_import_batches', 'INSERT')
  and not has_table_privilege('authenticated', 'public.staff_import_rows', 'INSERT'),
  'browser clients cannot bypass guarded staffing import commands'
);

select ok(
  not has_function_privilege('authenticated', 'private.execute_commercial_staffing_command(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.execute_commercial_staffing_command(jsonb)', 'EXECUTE'),
  'the staffing mutation implementation remains private'
);

select ok(
  exists(select 1 from pg_trigger where tgname='staff_profiles_commercial_capacity' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgname='staff_profiles_commercial_secure_defaults' and not tgisinternal),
  'all commercial staff mutation paths enforce plan capacity and secure kiosk defaults'
);

select ok(
  not exists (select 1 from public.staff_kiosk_settings where kiosk_enabled or pin_hash is not null),
  'initial staffing creates no enabled kiosk access or PIN authority'
);

select ok(
  to_regclass('public.message_outbox') is not null
  and to_regclass('public.manager_invitation_audit_events') is not null,
  'manager invitation delivery and append-only audit tables exist'
);

select ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='message_outbox' and column_name='delivery_secret_id')
  and to_regclass('vault.secrets') is not null,
  'retryable delivery material is referenced through encrypted Supabase Vault storage'
);

select ok(
  not has_table_privilege('authenticated', 'public.message_outbox', 'SELECT')
  and not has_table_privilege('authenticated', 'public.message_outbox', 'INSERT')
  and not has_table_privilege('authenticated', 'public.manager_invitation_audit_events', 'INSERT'),
  'browser roles cannot read delivery internals or append manager invitation audit evidence'
);

select ok(
  not has_table_privilege('authenticated', 'public.organisation_invitations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organisation_invitations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.organisation_invitation_roles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organisation_invitation_site_access', 'INSERT'),
  'manager invitation intent and grants cannot be written directly by browser roles'
);

select ok(
  has_function_privilege('anon', 'public.inspect_manager_invitation(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.accept_manager_invitation(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.accept_manager_invitation(text)', 'EXECUTE'),
  'safe inspection and authenticated acceptance use separate boundaries'
);

select ok(
  has_function_privilege('service_role', 'public.record_manager_invitation_delivery(uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_manager_invitation_delivery(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.preview_manager_invitation_token(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_manager_invitation_delivery(uuid,text,text)', 'EXECUTE'),
  'only the delivery worker role can record provider outcomes'
);

select ok(
  not has_function_privilege('authenticated', 'private.execute_manager_invitation_command(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.execute_manager_invitation_command(jsonb)', 'EXECUTE'),
  'manager invitation command implementation remains private'
);

select ok(
  not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name in('message_outbox','manager_invitation_audit_events')
      and column_name in('token','raw_token','invitation_token')),
  'delivery and audit tables contain no raw invitation-token column'
);

select ok(
  not has_function_privilege('authenticated', 'public.accept_organisation_invitation(text)', 'EXECUTE'),
  'the legacy invitation acceptance boundary is unavailable to browser roles'
);

select * from finish();
rollback;
